import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertString(value, message) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function readArgs(value) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Native MCP stdio args must be an array of strings.");
  }
  return value;
}

function resolveCwd(input) {
  if (input.cwd === undefined) {
    return input.hostCwd;
  }
  const cwd = assertString(input.cwd, "Native MCP stdio cwd must be a string.");
  return isAbsolute(cwd) ? cwd : resolve(input.pluginRoot, cwd);
}

function readStartupTimeoutSec(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Native MCP stdio startup_timeout_sec must be a positive number.");
  }
  return value;
}

export async function readNativeMcpServerConfig(input) {
  const pluginRoot = resolve(input.pluginRoot);
  const hostCwd = resolve(input.hostCwd);
  const mcpConfig = await readJsonFile(resolve(pluginRoot, ".mcp.json"));
  const server = mcpConfig?.mcpServers?.[input.serverName];
  if (server === undefined || typeof server !== "object" || server === null) {
    throw new Error(`Native MCP server ${input.serverName} is not declared.`);
  }
  const command = assertString(
    server.command,
    `Native MCP server ${input.serverName} must declare a stdio command.`
  );
  return {
    command,
    args: readArgs(server.args),
    cwd: resolveCwd({ pluginRoot, hostCwd, cwd: server.cwd }),
    startup_timeout_sec: readStartupTimeoutSec(server.startup_timeout_sec)
  };
}
