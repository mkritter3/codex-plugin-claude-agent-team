#!/usr/bin/env node
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(
      `Missing ${runtimePath}. Run npm run build before npm run smoke:mcp-stdio.`
    );
  }
}

async function main() {
  await assertRuntimeExists();

  const transport = new StdioClientTransport({
    command: "node",
    args: [runtimePath],
    cwd: repoRoot,
    stderr: "pipe"
  });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString("utf8"));
  });

  const client = new Client({
    name: "agent-team-smoke",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert(
      toolNames.includes("agent_team_list_roles"),
      `agent_team_list_roles not listed. Listed tools: ${toolNames.join(", ")}`
    );

    const result = await client.callTool({
      name: "agent_team_list_roles",
      arguments: {}
    });
    const roles = result.structuredContent?.roles;
    assert(Array.isArray(roles), "agent_team_list_roles did not return roles.");
    assert(
      roles.some((role) => role?.id === "planner"),
      "agent_team_list_roles did not include planner."
    );

    console.log("MCP stdio smoke passed.");
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr.length === 0 ? message : `${message}\nServer stderr:\n${stderr}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
