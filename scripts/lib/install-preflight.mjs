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
    return parseAgentTeamServerProcessList(stdout);
  } catch {
    return [];
  }
}

function commandLooksLikeNode(command) {
  const executable = command.trim().split(/\s+/, 1)[0] ?? "";
  return executable === "node" || executable.endsWith("/node");
}

function commandLooksLikeAgentTeamMcp(command) {
  return /codex-plugin-claude-agent-team(?:\/[^/\s]+)?\/dist\/index\.js(?:\s|$)/.test(
    command
  );
}

export function parseAgentTeamServerProcessList(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      return {
        pid: match === null ? 0 : Number(match[1]),
        command: match === null ? line : match[2]
      };
    })
    .filter(
      (process) =>
        Number.isFinite(process.pid) &&
        process.pid > 0 &&
        commandLooksLikeNode(process.command) &&
        commandLooksLikeAgentTeamMcp(process.command)
    );
}

export function buildMcpConfig(input) {
  const packageRoot = resolve(input.packageRoot);
  const serverName = input.serverName ?? DEFAULT_SERVER_NAME;
  assertServerName(serverName);
  return {
    mcpServers: {
      [serverName]: {
        command: "sh",
        args: [join(packageRoot, "scripts", "start-mcp.sh")],
        startup_timeout_sec: 120
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
  const mcpLauncherPath = join(packageRoot, "scripts", "start-mcp.sh");
  const installCheckScriptPath = join(packageRoot, "scripts", "install-check.mjs");
  const tsconfigBuildPath = join(packageRoot, "tsconfig.build.json");
  const srcIndexPath = join(packageRoot, "src", "index.ts");
  const packageLockPath = join(packageRoot, "package-lock.json");
  const npmShrinkwrapPath = join(packageRoot, "npm-shrinkwrap.json");
  const runningProcesses = await (input.listServerProcesses ??
    listAgentTeamServerProcesses)();

  const packageJson = await readJsonFile(packageJsonPath);
  const pluginManifest = await readJsonFile(pluginManifestPath);
  const localMcpConfig = await readJsonFile(localMcpConfigPath);
  const packageLock = await readJsonFile(packageLockPath);
  const npmShrinkwrap = await readJsonFile(npmShrinkwrapPath);
  const validFirstRunLockfile =
    (npmShrinkwrap.exists &&
      !npmShrinkwrap.malformed &&
      npmShrinkwrap.value?.lockfileVersion === 3) ||
    (packageLock.exists && !packageLock.malformed && packageLock.value?.lockfileVersion === 3);
  const builtRuntimePresent = await pathExists(runtimePath);
  const buildInputsPresent =
    (await pathExists(tsconfigBuildPath)) &&
    (await pathExists(srcIndexPath)) &&
    validFirstRunLockfile;

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
      localMcpConfig.value?.mcpServers?.["agent-team"]?.command === "sh" &&
        JSON.stringify(localMcpConfig.value?.mcpServers?.["agent-team"]?.args) ===
          JSON.stringify(["./scripts/start-mcp.sh"]) &&
        localMcpConfig.value?.mcpServers?.["agent-team"]?.cwd === "." &&
        localMcpConfig.value?.mcpServers?.["agent-team"]?.startup_timeout_sec === 120,
      localMcpConfig.malformed
        ? ".mcp.json must be valid JSON."
        : '.mcp.json must launch sh ./scripts/start-mcp.sh with cwd "." and startup_timeout_sec 120 for the agent-team server.'
    ),
    check(
      "first-run-launcher",
      mcpLauncherPath,
      await pathExists(mcpLauncherPath),
      "MCP first-run launcher is missing from the package surface."
    ),
    check(
      "first-run-lockfile",
      npmShrinkwrapPath,
      validFirstRunLockfile,
      npmShrinkwrap.malformed || packageLock.malformed
        ? "First-run npm install lockfile must be valid JSON."
        : "First-run npm install requires npm-shrinkwrap.json or package-lock.json with lockfileVersion 3."
    ),
    check(
      "runtime-build-cache",
      runtimePath,
      builtRuntimePresent || buildInputsPresent,
      "dist/index.js is missing and this package surface does not include the TypeScript build inputs needed by scripts/start-mcp.sh.",
      {
        builtRuntimePresent,
        buildInputsPresent,
        message:
          builtRuntimePresent
            ? "Built runtime is present."
            : "Missing dist/index.js is acceptable for source checkouts because scripts/start-mcp.sh can build it on demand."
      }
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
      "Install or update codex-plugin-claude-agent-team through the local-plugins marketplace, then run /reload-plugins or start a fresh Codex session.",
      "Run agent_team_doctor for the target workspace before starting live runs.",
      "After rebuilds, reload or restart Codex and confirm doctor mcp-runtime.workflowWriteScopeAllowsEmpty is true before direct workflow operations.",
      "Use mcpConfig only as a fallback for MCP hosts that do not support Codex plugins."
    ]
  };
}
