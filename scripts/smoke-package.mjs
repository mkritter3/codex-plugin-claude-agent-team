#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function main() {
  const packageJson = readJson("package.json");
  const mcpJson = readJson(".mcp.json");

  assert(
    packageJson.bin?.["agent-team-mcp"] === "./dist/index.js",
    'package bin "agent-team-mcp" must point at "./dist/index.js".'
  );
  assert(
    mcpJson.mcpServers?.["agent-team"]?.command === "node",
    '.mcp.json server "agent-team" must launch with node.'
  );
  assert(
    JSON.stringify(mcpJson.mcpServers?.["agent-team"]?.args) ===
      JSON.stringify(["./dist/index.js"]),
    '.mcp.json server "agent-team" must point at "./dist/index.js".'
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
    "dist/index.js",
    ".mcp.json",
    ".codex-plugin/plugin.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "docs/runbooks/claude-team-session.md",
    "scripts/install-check.mjs",
    "scripts/lib/install-preflight.mjs",
    "scripts/live-smoke-claude-team.mjs",
    "scripts/live-smoke-readonly-providers.mjs"
  ]) {
    assert(packedFiles.has(requiredPath), `packed artifact is missing ${requiredPath}.`);
  }

  console.log("Package smoke passed.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
