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

function assertToolRequires(tools, toolName, requiredFields) {
  const tool = tools.find((candidate) => candidate.name === toolName);
  assert(tool !== undefined, `${toolName} not listed.`);
  const required = tool.inputSchema?.required;
  assert(Array.isArray(required), `${toolName} does not expose required fields.`);
  for (const field of requiredFields) {
    assert(required.includes(field), `${toolName} does not require ${field}.`);
  }
}

function assertObjectSchema(tools, toolName) {
  const tool = tools.find((candidate) => candidate.name === toolName);
  assert(tool !== undefined, `${toolName} not listed.`);
  assert(tool.inputSchema?.type === "object", `${toolName} does not expose an object schema.`);
}

async function assertValidationError(client, toolName, args) {
  const result = await client.callTool({
    name: toolName,
    arguments: args
  });
  assert(
    result.structuredContent?.status === "validation_error",
    `${toolName} did not reject invalid smoke arguments.`
  );
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
    assertToolRequires(tools.tools, "agent_team_dispatch", ["role", "task"]);
    assertToolRequires(tools.tools, "agent_team_start", ["role", "task"]);
    assertToolRequires(tools.tools, "agent_team_start_parallel", ["runs"]);
    assertToolRequires(tools.tools, "agent_team_message", ["runId", "message"]);
    assertToolRequires(tools.tools, "agent_team_message_many", ["messages"]);
    assertToolRequires(tools.tools, "agent_team_status", ["runId"]);
    assertToolRequires(tools.tools, "agent_team_status_many", ["runs"]);
    assertToolRequires(tools.tools, "agent_team_summary", ["runs"]);
    assertToolRequires(tools.tools, "agent_team_create_team", ["runs"]);
    assertToolRequires(tools.tools, "agent_team_get_team", ["teamId"]);
    assertObjectSchema(tools.tools, "agent_team_list_teams");
    assertToolRequires(tools.tools, "agent_team_create_workflow", ["goal", "slices"]);
    assertToolRequires(tools.tools, "agent_team_get_workflow", ["workflowId"]);
    assertObjectSchema(tools.tools, "agent_team_list_workflows");
    assertToolRequires(tools.tools, "agent_team_plan_consensus", [
      "workflowId",
      "codexDecision",
      "verdicts"
    ]);
    assertToolRequires(tools.tools, "agent_team_start_slices", ["workflowId"]);
    assertToolRequires(tools.tools, "agent_team_unblock_slice", [
      "workflowId",
      "sliceId",
      "dependencyEvidence"
    ]);
    assertToolRequires(tools.tools, "agent_team_review_slice", [
      "workflowId",
      "sliceId",
      "codexDecision",
      "verdicts"
    ]);
    assertToolRequires(tools.tools, "agent_team_integration_queue", ["workflowId"]);
    assertToolRequires(tools.tools, "agent_team_record_integration", [
      "workflowId",
      "sliceId",
      "integrationMethod",
      "summary",
      "changedFiles",
      "verification"
    ]);
    assertObjectSchema(tools.tools, "agent_team_dashboard");
    assertToolRequires(tools.tools, "agent_team_cancel_many", ["runs"]);
    assertToolRequires(tools.tools, "agent_team_wind_down_many", ["runs"]);
    assertObjectSchema(tools.tools, "agent_team_list_roles");

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

    await assertValidationError(client, "agent_team_dashboard", {});
    await assertValidationError(client, "agent_team_dashboard", {
      teamId: "team_smoke",
      runs: [{ runId: "run_smoke" }]
    });
    await assertValidationError(client, "agent_team_create_workflow", {
      goal: {
        title: "Smoke",
        successCriteria: ["reject missing slices"],
        constraints: ["provider neutral"],
        nonGoals: ["live calls"]
      },
      slices: []
    });

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
