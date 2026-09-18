#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Package smoke failed: ${message}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
}

function normalizePackagePath(path) {
  return path.replace(/^package\//, "");
}

async function assertColdPackagedInstallStartsMcp() {
  const packRoot = mkdtempSync(resolve(tmpdir(), "agent-team-pack-install-"));
  const npmCache = mkdtempSync(resolve(tmpdir(), "agent-team-pack-install-cache-"));
  let client;
  try {
    const output = execFileSync(
      "npm",
      ["pack", "--json", "--pack-destination", packRoot],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          npm_config_cache: npmCache
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    const packResult = JSON.parse(output);
    assert(Array.isArray(packResult) && packResult.length === 1, "unexpected npm pack shape.");
    const tarballPath = resolve(packRoot, packResult[0].filename);
    execFileSync("tar", ["-xzf", tarballPath, "-C", packRoot], {
      cwd: packRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const packageRoot = resolve(packRoot, "package");
    assert(existsSync(resolve(packageRoot, "package.json")), "packed package was not extracted.");
    assert(
      !existsSync(resolve(packageRoot, "node_modules")),
      "packed cold install must start without node_modules."
    );

    const transport = new StdioClientTransport({
      command: "sh",
      args: ["./scripts/start-mcp.sh"],
      cwd: packageRoot,
      env: {
        ...process.env,
        npm_config_cache: npmCache
      },
      stderr: "pipe"
    });
    client = new Client({
      name: "agent-team-packaged-install-smoke",
      version: "0.1.5"
    });
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert(
      toolNames.includes("agent_team_doctor"),
      `first-run packaged MCP connection did not list agent_team_doctor. Listed tools: ${toolNames.join(", ")}`
    );
    assert(
      existsSync(resolve(packageRoot, "node_modules")),
      "first-run packaged MCP connection did not install node_modules."
    );
  } finally {
    await client?.close();
    rmSync(packRoot, { force: true, recursive: true });
    rmSync(npmCache, { force: true, recursive: true });
  }
}

async function main() {
  const packageJson = readJson("package.json");
  const mcpJson = readJson(".mcp.json");

  assert(
    packageJson.bin?.["agent-team-mcp"] === "./dist/index.js",
    'package bin "agent-team-mcp" must point at "./dist/index.js".'
  );
  assert(
    mcpJson.mcpServers?.["agent-team"]?.command === "sh",
    '.mcp.json server "agent-team" must launch with sh.'
  );
  assert(
    JSON.stringify(mcpJson.mcpServers?.["agent-team"]?.args) ===
      JSON.stringify(["./scripts/start-mcp.sh"]),
    '.mcp.json server "agent-team" must point at "./scripts/start-mcp.sh".'
  );
  assert(
    mcpJson.mcpServers?.["agent-team"]?.cwd === ".",
    '.mcp.json server "agent-team" must set cwd to "." so Codex resolves relative launch paths from the installed plugin root.'
  );
  assert(
    mcpJson.mcpServers?.["agent-team"]?.startup_timeout_sec === 120,
    '.mcp.json server "agent-team" must allow 120 seconds for first-run install/build startup.'
  );

  const npmCache = mkdtempSync(resolve(tmpdir(), "agent-team-npm-pack-cache-"));
  let output;
  try {
    output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: npmCache
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } finally {
    rmSync(npmCache, { force: true, recursive: true });
  }
  const packResult = JSON.parse(output);
  assert(Array.isArray(packResult) && packResult.length === 1, "unexpected npm pack shape.");

  const packedFiles = new Set(
    packResult[0].files.map((file) => normalizePackagePath(file.path))
  );
  for (const requiredPath of [
    "package.json",
    "npm-shrinkwrap.json",
    "dist/index.js",
    ".mcp.json",
    ".codex-plugin/plugin.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "docs/runbooks/claude-team-session.md",
    "skills/codex-agent-team-orchestrator/SKILL.md",
    "scripts/install-check.mjs",
    "scripts/verify-distribution.mjs",
    "scripts/start-mcp.sh",
    "scripts/lib/install-preflight.mjs",
    "scripts/smoke-workflow-orchestrator.mjs",
    "scripts/live-smoke-claude-team.mjs",
    "scripts/live-smoke-claude-utils.mjs",
    "scripts/live-smoke-readonly-providers.mjs"
  ]) {
    assert(packedFiles.has(requiredPath), `packed artifact is missing ${requiredPath}.`);
  }

  await assertColdPackagedInstallStartsMcp();

  console.log("Package smoke passed.");
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
