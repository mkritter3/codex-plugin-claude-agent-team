import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const DEFAULT_SERVER_NAME = "agent-team";
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const execFileAsync = promisify(execFile);

function assertServerName(serverName) {
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error("MCP server name must contain only letters, numbers, underscores, or hyphens.");
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path) {
  if (!(await pathExists(path))) {
    return { exists: false, value: undefined };
  }
  try {
    return { exists: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return { exists: true, value: undefined, malformed: true };
  }
}

function check(id, path, passed, message, details) {
  return {
    id,
    status: passed ? "pass" : "fail",
    path,
    ...(passed || message === undefined ? {} : { message }),
    ...(details === undefined ? {} : { details })
  };
}

export async function listAgentTeamServerProcesses() {
  if (process.platform === "win32") {
    return [];
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("codex-plugin-claude-agent-team/dist/index.js"))
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.*)$/);
        return {
          pid: match === null ? 0 : Number(match[1]),
          command: match === null ? line : match[2]
        };
      });
  } catch {
    return [];
  }
}

export function buildMcpConfig(input) {
  const packageRoot = resolve(input.packageRoot);
  const serverName = input.serverName ?? DEFAULT_SERVER_NAME;
  assertServerName(serverName);
  return {
    mcpServers: {
      [serverName]: {
        command: "node",
        args: [join(packageRoot, "dist", "index.js")]
      }
    }
  };
}

export async function buildInstallPreflightReport(input) {
  const packageRoot = resolve(input.packageRoot);
  const serverName = input.serverName ?? DEFAULT_SERVER_NAME;
  assertServerName(serverName);

  const packageJsonPath = join(packageRoot, "package.json");
  const pluginManifestPath = join(packageRoot, ".codex-plugin", "plugin.json");
  const localMcpConfigPath = join(packageRoot, ".mcp.json");
  const runtimePath = join(packageRoot, "dist", "index.js");
  const installCheckScriptPath = join(packageRoot, "scripts", "install-check.mjs");
  const runningProcesses = await (input.listServerProcesses ??
    listAgentTeamServerProcesses)();

  const packageJson = await readJsonFile(packageJsonPath);
  const pluginManifest = await readJsonFile(pluginManifestPath);
  const localMcpConfig = await readJsonFile(localMcpConfigPath);

  const checks = [
    check(
      "package-json",
      packageJsonPath,
      packageJson.value?.bin?.["agent-team-mcp"] === "./dist/index.js",
      packageJson.malformed
        ? "package.json must be valid JSON."
        : 'package.json bin "agent-team-mcp" must point at "./dist/index.js".'
    ),
    check(
      "plugin-manifest",
      pluginManifestPath,
      pluginManifest.value?.mcpServers === "./.mcp.json",
      pluginManifest.malformed
        ? ".codex-plugin/plugin.json must be valid JSON."
        : '.codex-plugin/plugin.json must point mcpServers at "./.mcp.json".'
    ),
    check(
      "local-mcp-config",
      localMcpConfigPath,
      localMcpConfig.value?.mcpServers?.["agent-team"]?.command === "node" &&
        JSON.stringify(localMcpConfig.value?.mcpServers?.["agent-team"]?.args) ===
          JSON.stringify(["./dist/index.js"]),
      localMcpConfig.malformed
        ? ".mcp.json must be valid JSON."
        : ".mcp.json must launch node ./dist/index.js for the agent-team server."
    ),
    check(
      "runtime-entrypoint",
      runtimePath,
      await pathExists(runtimePath),
      "Built runtime is missing. Run npm run build before install handoff."
    ),
    check(
      "install-check-script",
      installCheckScriptPath,
      await pathExists(installCheckScriptPath),
      "Install check script is missing from the package surface."
    ),
    check(
      "running-mcp-processes",
      runtimePath,
      true,
      undefined,
      {
        runningProcessCount: runningProcesses.length,
        ...(runningProcesses.length === 0
          ? {}
          : {
              message:
                "Existing Agent Team MCP server processes may keep serving old schemas until Codex reloads or restarts them."
            })
      }
    )
  ];

  return {
    status: checks.every((item) => item.status === "pass") ? "ready" : "blocked",
    packageRoot,
    serverName,
    mcpConfig: buildMcpConfig({ packageRoot, serverName }),
    checks,
    nextSteps: [
      `Add mcpConfig.mcpServers.${serverName} to the Codex MCP client configuration.`,
      "Run agent_team_doctor for the target workspace before starting live runs.",
      "After rebuilds, reload or restart Codex and confirm doctor mcp-runtime.workflowWriteScopeAllowsEmpty is true before direct workflow operations."
    ]
  };
}
