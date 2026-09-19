import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import { dispatchReadOnlyAgent } from "../../src/core/dispatch.js";
import { AgentLifecycleManager } from "../../src/core/lifecycle.js";
import { verifyProviderVotes } from "../../src/core/orchestration/provider-evidence.js";
import type { AuthorityEvidence } from "../../src/core/orchestration/contract.js";
import { readMailboxRecords } from "../../src/core/state/mailbox-store.js";
import { readRunSidecar, writeRunSidecar } from "../../src/core/state/run-store.js";
import { readWorkflowRecord } from "../../src/core/state/workflow-store.js";
import { createToolHandlers, type ToolName } from "../../src/mcp/tools.js";
import { claudeCodeCliProfileDescriptor } from "../../src/providers/claude-code-cli/config.js";
import { createClaudeCodeCliRuntime } from "../../src/providers/claude-code-cli/runtime.js";
import type { ProviderSessionSnapshot } from "../../src/providers/types.js";

const model = "claude-fable-5-1";
const profile = { ...DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli.profiles[0]!, id: "fable", model };
const provider = claudeCodeCliProfileDescriptor(profile);
const config = { ...DEFAULT_AGENT_TEAM_CONFIG, providers: { ...DEFAULT_AGENT_TEAM_CONFIG.providers,
  claudeCodeCli: { ...DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli, profiles: [profile] }
} };
const target = { kind: "provider", provider: provider.id, model } as const;
const text = "<<<VERDICT>>>\nstatus: SHIP\nsummary: Reviewed the plan\nrequired_changes:\n- none\nevidence:\n- plan:revision1\nrisks:\n- none\n<<<END_VERDICT>>>";
let workspace: string;
beforeEach(async () => { workspace = await mkdtemp(join(tmpdir(), "team-model-evidence-")); });
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });

it.each(["dispatch", "background", "resume"] as const)("retains the selected model through %s completion and exact-model approval", async mode => {
  const launchedModels: Array<string | undefined> = [];
  let nextRun = 0;
  const createRunId = () => `run_model_${++nextRun}`;
  const runtime = createClaudeCodeCliRuntime({ config,
    runClaudePrint: async input => {
      launchedModels.push(input.model);
      return { ok: true, text, stdout: text, stderr: "", exitCode: 0, sessionId: "recorded-session" };
    },
    startClaudeBackgroundSession: input => {
      launchedModels.push(input.model);
      const snapshot: ProviderSessionSnapshot = {
        providerSessionId: "recorded-session", text, warnings: [], recentActivities: [],
        currentActivity: null, pendingOutboxRequests: [], lastStderr: [],
        transcriptPath: undefined, logPath: undefined
      };
      return { ...snapshot, done: Promise.resolve("completed"), supportsStdin: false,
        kill() {}, forceKill() {}, snapshot: () => snapshot };
    }
  });
  const lifecycle = new AgentLifecycleManager({ config, providers: [provider], runtimes: [runtime], createRunId });
  const handlers = createToolHandlers({ config, cwd: () => workspace, lifecycle,
    dispatch: request => dispatchReadOnlyAgent(request, { config, providers: [provider], runtimes: [runtime], createRunId })
  });
  const call = async (name: ToolName, args: Record<string, unknown>) => {
    const result = await handlers.handleToolCall(name, {cwd: workspace, ...args});
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
    expect(result.structuredContent).not.toMatchObject({ status: "validation_error" });
    return result;
  };
  const workflowId = "workflow_model_evidence";
  await call("agent_team_create_workflow", { workflowId,
    goal: { title: "Verify a selected reviewer", successCriteria: ["Exact model approves"], constraints: ["Preserve exact model identity"], nonGoals: ["Live provider usage"] },
    slices: [{ sliceId: "slice_review", title: "Review", ownerRole: "debugger", state: "ready", dependencies: [], writeScope: [], acceptanceTests: ["Check evidence"], expectedEvidence: ["Findings"] }]
  });
  await call("agent_team_configure_orchestration", { workflowId, policy: {
    planning: { members: [{ id: "fable", target }] }, review: { members: [{ id: "fable", target }] }, implementation: target
  } });
  const request = { role: "architect", task: "Review plan:revision1", provider: provider.id };
  const first = await call(mode === "dispatch" ? "agent_team_dispatch" : "agent_team_start", request);
  let runId = (first.structuredContent as { runId: string }).runId;
  const waitForCompletion = async (id: string) => {
    await vi.waitFor(async () => {
      expect((await readMailboxRecords(workspace, id, "events")).some(r => r.messageType === "completed")).toBe(true);
    });
  };
  await waitForCompletion(runId);
  if (mode === "resume") {
    const reply = await call("agent_team_reply", { runId, message: "Recheck the same plan" });
    runId = (reply.structuredContent as { runId: string }).runId;
    await waitForCompletion(runId);
  }
  expect(launchedModels).toEqual(mode === "resume" ? [model, model] : [model]);
  const completed = await readRunSidecar(workspace, runId);
  expect(completed).toMatchObject({ provider: provider.id, model, status: "completed" });
  const authority: AuthorityEvidence = { artifact: "plan:revision1", votes: [{ memberId: "fable", status: "approve",
    artifact: "plan:revision1", summary: "Reviewed", execution: { kind: "provider-run", id: runId, target }
  }] };
  // Missing, substituted, and incomplete evidence must still fail closed.
  const { model: _model, ...missingModel } = completed;
  for (const invalid of [missingModel, { ...completed, model: "claude-sonnet-other" }, { ...completed, provider: "claude-code-cli:other" }, { ...completed, status: "failed" as const }]) {
    await writeRunSidecar(workspace, invalid);
    await expect(verifyProviderVotes(workspace, authority)).rejects.toThrow();
  }
  await writeRunSidecar(workspace, completed);
  await call("agent_team_plan_consensus", { workflowId, authority,
    verdicts: [{ reviewerRole: "architect", status: "approve", summary: "Reviewed" }],
    codexDecision: { status: "approve", category: "technical", summary: "Record selected reviewer's decision" }
  });
  expect((await readWorkflowRecord(workspace, workflowId)).planningStatus).toBe("approved");
});
