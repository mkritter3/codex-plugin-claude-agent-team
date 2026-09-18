#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const MARKETPLACE_RELATIVE_PATH = "../.agents/plugins/marketplace.json";
const EXPECTED_PLUGIN_MARKETPLACE_PATH = "./codex-plugin-claude-agent-team";

const errors = [];

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function readText(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function assertArrayIncludes(array, value, owner) {
  assert(Array.isArray(array) && array.includes(value), `${owner} must include ${value}.`);
}

function main() {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const shrinkwrap = readJson("npm-shrinkwrap.json");
  const codexPlugin = readJson(".codex-plugin/plugin.json");
  const claudePlugin = readJson(".claude-plugin/plugin.json");
  const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
  const mcpJson = readJson(".mcp.json");
  const marketplacePath = resolve(repoRoot, MARKETPLACE_RELATIVE_PATH);
  const marketplace = existsSync(marketplacePath)
    ? JSON.parse(readFileSync(marketplacePath, "utf8"))
    : undefined;
  const readme = readText("README.md");
  const sourceVersion = readText("src/version.ts");

  assert(packageJson.name === "codex-plugin-claude-agent-team", "package name changed.");
  assert(
    packageJson.codexPlugin === ".codex-plugin/plugin.json",
    "package.json must point codexPlugin at .codex-plugin/plugin.json."
  );
  assert(
    packageJson.bin?.["agent-team-mcp"] === "./dist/index.js",
    'package bin "agent-team-mcp" must point at ./dist/index.js.'
  );

  const version = packageJson.version;
  for (const [owner, value] of [
    ["package-lock.json root", packageLock.version],
    ["package-lock.json packages root", packageLock.packages?.[""]?.version],
    ["npm-shrinkwrap.json root", shrinkwrap.version],
    ["npm-shrinkwrap.json packages root", shrinkwrap.packages?.[""]?.version],
    [".codex-plugin/plugin.json", codexPlugin.version],
    [".claude-plugin/plugin.json", claudePlugin.version],
    [".claude-plugin/marketplace.json", claudeMarketplace.plugins?.[0]?.version]
  ]) {
    const comparable = owner === ".codex-plugin/plugin.json" && typeof value === "string" ? value.replace(/\+codex\.[A-Za-z0-9.-]+$/, "") : value;
    assert(comparable === version, `${owner} version ${value ?? "<missing>"} must match ${version}.`);
  }
  assert(
    JSON.stringify(packageLock) === JSON.stringify(shrinkwrap),
    "package-lock.json and npm-shrinkwrap.json must match exactly so first-run installs use the same dependency graph as source verification."
  );
  assert(
    sourceVersion.includes(`"${version}"`),
    "src/version.ts must export the same package version."
  );

  for (const requiredFile of [
    "dist",
    "npm-shrinkwrap.json",
    ".codex-plugin",
    ".mcp.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "docs/releases",
    "docs/runbooks",
    "skills",
    "scripts"
  ]) {
    assertArrayIncludes(packageJson.files, requiredFile, "package files");
  }

  assert(
    packageJson.scripts?.["verify:distribution"] === "node scripts/verify-distribution.mjs",
    "package.json must expose npm run verify:distribution."
  );
  assert(
    packageJson.scripts?.ci?.includes("npm run verify:distribution"),
    "npm run ci must include npm run verify:distribution."
  );
  assert(
    !Object.values(packageJson.scripts ?? {}).join(" ").includes("codex mcp add"),
    "package scripts must not rely on manual MCP registration."
  );

  const server = mcpJson.mcpServers?.["agent-team"];
  assert(server?.command === "sh", '.mcp.json agent-team server must use "sh".');
  assert(
    JSON.stringify(server?.args) === JSON.stringify(["./scripts/start-mcp.sh"]),
    '.mcp.json agent-team server must launch ./scripts/start-mcp.sh.'
  );
  assert(server?.cwd === ".", '.mcp.json agent-team server must set cwd to ".".');
  assert(
    server?.startup_timeout_sec === 120,
    ".mcp.json agent-team server startup_timeout_sec must be 120."
  );

  assert(
    codexPlugin.mcpServers === "./.mcp.json",
    ".codex-plugin/plugin.json must expose the bundled MCP config."
  );
  assert(
    codexPlugin.skills === "./skills/",
    ".codex-plugin/plugin.json must expose the bundled skill directory."
  );

  if (process.argv.includes("--require-local-marketplace")) {
    assert(marketplace !== undefined, "workspace marketplace file must exist.");
  }
  // A standalone checkout has no personal marketplace. Validate it when present
  // without making local installation layout a prerequisite for repository CI.
  if (marketplace !== undefined) {
    const expectedSourcePath = EXPECTED_PLUGIN_MARKETPLACE_PATH;
    assert(
      `./${toPosixPath(relative(resolve(repoRoot, ".."), repoRoot))}` === expectedSourcePath,
      `plugin checkout must live at ${expectedSourcePath} relative to the marketplace root.`
    );
    const marketplaceEntry = marketplace.plugins?.find(
      (plugin) => plugin.name === "codex-plugin-claude-agent-team"
    );
    assert(marketplace.name === "local-plugins", "workspace marketplace name must be local-plugins.");
    assert(
      marketplaceEntry?.source?.source === "local",
      "workspace marketplace entry must use a local source."
    );
    assert(
      marketplaceEntry?.source?.path === expectedSourcePath,
      `workspace marketplace entry path must be ${expectedSourcePath}.`
    );
    assert(
      marketplaceEntry?.policy?.installation === "AVAILABLE",
      "workspace marketplace entry must be installable."
    );
    assert(
      marketplaceEntry?.policy?.authentication === "ON_INSTALL",
      "workspace marketplace entry must request auth on install."
    );
    assert(
      marketplaceEntry?.category === "Productivity",
      "workspace marketplace entry must stay in the Productivity category."
    );
  }

  for (const fragment of [
    "Native Codex Install",
    "Install `codex-plugin-claude-agent-team` from the `local-plugins` marketplace",
    "/reload-plugins",
    "agent_team_doctor",
    "agent_team_list_providers",
    "Do not run `codex mcp add`",
    "the plugin ships its MCP server through `.codex-plugin/plugin.json` and `.mcp.json`",
    "npm run verify:distribution"
  ]) {
    assert(readme.includes(fragment), `README.md must document: ${fragment}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Distribution verification failed: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Distribution verification passed: plugin manifest, MCP config, package scripts, and operator docs are aligned. Local marketplace: ${marketplace === undefined ? "not present (standalone checkout)" : "verified"}.`
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
