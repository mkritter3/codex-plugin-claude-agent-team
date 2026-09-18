#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readNativeMcpServerConfig } from "./lib/native-mcp-config.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

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

async function callTool(client, toolName, args) {
  const result = await client.callTool({
    name: toolName,
    arguments: args
  });
  if (result.isError) {
    throw new Error(`${toolName} returned an MCP error: ${JSON.stringify(result)}`);
  }
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text === "string") {
    return JSON.parse(text);
  }
  throw new Error(`${toolName} did not return structured or JSON text content.`);
}

function assertDoctorRuntimeMetadata(report) {
  const checks = report.checks;
  assert(Array.isArray(checks), "agent_team_doctor did not return ordered checks.");
  const runtime = checks.find((check) => check?.id === "mcp-runtime");
  assert(runtime !== undefined, "agent_team_doctor did not return mcp-runtime evidence.");
  assert(runtime.status === "pass", "agent_team_doctor mcp-runtime check did not pass.");
  assert(
    runtime.details?.workflowWriteScopeAllowsEmpty === true,
    "agent_team_doctor mcp-runtime did not prove workflowWriteScopeAllowsEmpty."
  );
}

async function assertReadOnlyWorkflowCreation(client, workspaceRoot) {
  const created = await callTool(client, "agent_team_create_workflow", {
    cwd: workspaceRoot,
    workflowId: "workflow_stdio_readonly",
    name: "Packaged stdio read-only workflow proof",
    goal: {
      title: "Prove packaged read-only workflow schema",
      successCriteria: ["read-only workflow slices cross the MCP boundary"],
      constraints: ["no provider calls"],
      nonGoals: ["source edits"]
    },
    slices: [
      {
        sliceId: "slice_readonly",
        title: "Read-only workflow slice",
        ownerRole: "planner",
        state: "ready",
        dependencies: [],
        writeScope: [],
        acceptanceTests: ["agent_team_workflow_report"],
        expectedEvidence: ["packaged stdio schema evidence"],
        riskLevel: "low"
      }
    ]
  });
  const createdSlice = created.workflow?.slices?.find(
    (slice) => slice?.sliceId === "slice_readonly"
  );
  assert(createdSlice !== undefined, "read-only workflow slice was not created.");
  assert(Array.isArray(createdSlice.dependencies), "read-only slice dependencies missing.");
  assert(createdSlice.dependencies.length === 0, "read-only slice dependencies changed.");
  assert(Array.isArray(createdSlice.writeScope), "read-only slice writeScope missing.");
  assert(createdSlice.writeScope.length === 0, "read-only slice writeScope changed.");

  const readBack = await callTool(client, "agent_team_get_workflow", {
    cwd: workspaceRoot,
    workflowId: "workflow_stdio_readonly"
  });
  const readBackSlice = readBack.workflow?.slices?.find(
    (slice) => slice?.sliceId === "slice_readonly"
  );
  assert(readBackSlice !== undefined, "read-only workflow slice was not persisted.");
  assert(readBackSlice.dependencies.length === 0, "persisted dependencies changed.");
  assert(readBackSlice.writeScope.length === 0, "persisted writeScope changed.");
}

async function main() {
  const hostCwd = await mkdtemp(join(tmpdir(), "agent-team-stdio-host-cwd-"));
  const nativeServer = await readNativeMcpServerConfig({
    pluginRoot: repoRoot,
    serverName: "agent-team",
    hostCwd
  });
  assert(
    nativeServer.startup_timeout_sec === 120,
    "native MCP config must preserve startup_timeout_sec 120."
  );
  const transport = new StdioClientTransport({
    command: nativeServer.command,
    args: nativeServer.args,
    cwd: nativeServer.cwd,
    stderr: "pipe"
  });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString("utf8"));
  });

  const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-team-stdio-smoke-"));
  const client = new Client({
    name: "agent-team-smoke",
    version: "0.1.5"
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
    assertToolRequires(tools.tools, "agent_team_configure_orchestration", ["workflowId", "policy"]);
    assertToolRequires(tools.tools, "agent_team_prepare_assignments", ["workflowId", "phase"]);
    assertToolRequires(tools.tools, "agent_team_record_native_implementation", ["workflowId", "sliceId", "evidence"]);
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
    assertToolRequires(tools.tools, "agent_team_workflow_report", ["workflowId"]);
    assertToolRequires(tools.tools, "agent_team_workflow_next", ["workflowId"]);
    assertToolRequires(tools.tools, "agent_team_record_user_decision", [
      "workflowId",
      "category",
      "decision",
      "summary",
      "practicalEffect"
    ]);
    assertObjectSchema(tools.tools, "agent_team_dashboard");
    assertToolRequires(tools.tools, "agent_team_cancel_many", ["runs"]);
    assertToolRequires(tools.tools, "agent_team_wind_down_many", ["runs"]);
    assertObjectSchema(tools.tools, "agent_team_list_roles");

    const result = await callTool(client, "agent_team_list_roles", {});
    const roles = result.roles;
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

    const doctor = await callTool(client, "agent_team_doctor", {
      cwd: workspaceRoot
    });
    assertDoctorRuntimeMetadata(doctor);
    await assertReadOnlyWorkflowCreation(client, workspaceRoot);
    const target = { kind: "native", model: "gpt-6-astra", reasoningEffort: "xhigh" };
    const base = { cwd: workspaceRoot, workflowId: "workflow_stdio_readonly" };
    await callTool(client, "agent_team_configure_orchestration", { ...base, policy: {
      planning: { members: [{ id: "astra", target }] }, review: { members: [{ id: "astra", target }] },
      implementation: { kind: "native", model: "gpt-5.6-sol", reasoningEffort: "medium" }
    } });
    const routed = await callTool(client, "agent_team_prepare_assignments", { ...base, phase: "planning", coordinator: {
      source: "runtime", sessionId: "fixture-session", model: "gpt-6-astra", reasoningEffort: "xhigh"
    } });
    assert(routed.assignments?.[0]?.route?.kind === "active-session", "Matching native planning was not reused across MCP stdio.");
    const decided = await callTool(client, "agent_team_plan_consensus", { ...base,
      codexDecision: { status: "approve", category: "technical", summary: "Fixture authority records the result" },
      verdicts: [{ reviewerRole: "architect", status: "approve", summary: "Fixture plan evidence" }],
      authority: { artifact: "fixture:plan-v1", votes: [{ memberId: "astra", status: "approve", artifact: "fixture:plan-v1", summary: "Offline host attestation fixture", execution: { kind: "active-session", id: "fixture-session", target } }] }
    });
    assert(decided.workflow?.planningStatus === "approved", "Native authority evidence did not survive MCP validation.");

    console.log("MCP stdio smoke passed.");
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr.length === 0 ? message : `${message}\nServer stderr:\n${stderr}`);
  } finally {
    await client.close();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(hostCwd, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
