import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createToolHandlers, type ToolName } from "../../src/mcp/tools.js";
import { readWorkflowRecord } from "../../src/core/state/workflow-store.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import { deriveWorkflowGuidance } from "../../src/core/workflow-guidance.js";
import { writeRunSidecar } from "../../src/core/state/run-store.js";
import { startWorkflowSlices } from "../../src/core/workflow-slices.js";

let workspace: string;
let call: (name: string, args: Record<string, unknown>) => Promise<any>;
const astra = { kind: "native", model: "gpt-6-astra", reasoningEffort: "xhigh" };
const sol = { kind: "native", model: "gpt-5.6-sol", reasoningEffort: "medium" };
const policy = { planning: { members: [{ id: "astra", target: astra }] }, review: { members: [{ id: "astra", target: astra }] }, implementation: sol };
const codexDecision = { status: "approve", category: "technical", summary: "Coordinator records the selected authority's decision" };
const verdicts = [{ reviewerRole: "architect", status: "approve", summary: "Supporting role evidence" }];
function authority(artifact = "commit:revision1", executionId = "reviewer", status = "approve") {
  return { artifact, votes: [{ memberId: "astra", artifact, status, summary: "Selected authority's finding", execution: { kind: "native-agent", id: executionId, target: astra } }] };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "team-orchestration-"));
  const handlers = createToolHandlers({ config: DEFAULT_AGENT_TEAM_CONFIG, cwd: () => workspace });
  call = async (name, args) => handlers.handleToolCall(name as ToolName, { workflowId: "workflow_native", ...args }).catch(error => ({ isError: true, error: error.message }));
  await call("agent_team_create_workflow", { goal: { title: "Native and external coordination", successCriteria: ["One authority gate"], constraints: ["Keep costs low"], nonGoals: ["Live providers"] }, slices: [{ sliceId: "slice_native", title: "Implementation", ownerRole: "slice-implementer", state: "ready", dependencies: [], writeScope: ["src/"], acceptanceTests: ["focused tests"], expectedEvidence: ["test output"] }] });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(workspace, { recursive: true, force: true }); });

it("routes active planning and native execution, records evidence, then passes through normal review/integration", async () => {
  expect((await call("agent_team_configure_orchestration", { policy })).isError).not.toBe(true);
  const routes = await call("agent_team_prepare_assignments", { phase: "planning", coordinator: { source: "runtime", sessionId: "main", model: "gpt-6-astra", reasoningEffort: "xhigh" } });
  expect(routes.structuredContent.assignments[0].route.kind).toBe("active-session");
  expect((await call("agent_team_plan_consensus", { codexDecision, verdicts, authority: authority("plan:digest") })).isError).not.toBe(true);
  expect((await call("agent_team_record_native_implementation", { sliceId: "slice_native", evidence: {
    execution: { kind: "native-agent", id: "implementer", target: sol }, artifact: "commit:revision1", summary: "Implemented bounded slice", changedFiles: ["src/feature.ts"], testsRun: ["focused tests passed"], evidencePaths: ["test-output.txt"], worktreePath: join(workspace, "worktrees/native")
  } })).isError).not.toBe(true);
  expect((await readWorkflowRecord(workspace, "workflow_native")).slices[0]?.state).toBe("awaiting-review");
  expect((await call("agent_team_review_slice", { sliceId: "slice_native", codexDecision, verdicts, authority: authority() })).isError).not.toBe(true);
  expect((await call("agent_team_integration_queue", {})).structuredContent.queue).toHaveLength(1);
  const saved = await readWorkflowRecord(workspace, "workflow_native");
  expect(saved.slices[0]?.state).toBe("approved");
  expect(saved.consensusRounds.at(-1)?.authority?.artifact).toBe("commit:revision1");
  expect(saved.orchestration).toEqual(policy);
  const guidance = deriveWorkflowGuidance(saved);
  expect(guidance.phase).toBe("awaiting_integration");
  expect(guidance.orchestration).toEqual(policy);
  expect(guidance.delegation).toEqual([]);
});

it("cannot approve through the old coordinator field without authority, or replace the panel after voting", async () => {
  await call("agent_team_configure_orchestration", { policy });
  expect((await call("agent_team_plan_consensus", { codexDecision, verdicts })).isError).toBe(true);
  await call("agent_team_plan_consensus", { codexDecision, verdicts, authority: authority("plan:digest", "reviewer", "revise") });
  expect((await readWorkflowRecord(workspace, "workflow_native")).planningStatus).toBe("in-consensus");
  expect((await call("agent_team_configure_orchestration", { policy })).isError).toBe(true);
});

it("keeps model overrides local to an implementation assignment and rejects missing slices", async () => {
  await call("agent_team_configure_orchestration", { policy });
  expect((await call("agent_team_prepare_assignments", { phase: "implementation", sliceId: "missing" })).isError).toBe(true);
  expect((await call("agent_team_prepare_assignments", { phase: "planning", target: sol })).isError).toBe(true);
});

it("shows planning before execution and rejects stale implementation review", async () => {
  await call("agent_team_configure_orchestration", { policy });
  expect(deriveWorkflowGuidance(await readWorkflowRecord(workspace, "workflow_native")).phase).toBe("planning");
  await call("agent_team_plan_consensus", { codexDecision, verdicts, authority: authority("plan:digest") });
  await call("agent_team_record_native_implementation", { sliceId: "slice_native", evidence: {
    execution: { kind: "native-agent", id: "implementer", target: sol }, artifact: "commit:new", summary: "Implemented", changedFiles: ["src/feature.ts"], testsRun: ["tests passed"], evidencePaths: ["test-output.txt"], worktreePath: join(workspace, "worktrees/native")
  } });
  expect((await call("agent_team_review_slice", { sliceId: "slice_native", codexDecision, verdicts, authority: authority("commit:old") })).isError).toBe(true);
  expect((await readWorkflowRecord(workspace, "workflow_native")).slices[0]?.state).toBe("awaiting-review");
});

it("requires real completed provider evidence alongside native panel votes", async () => {
  const mixed = { ...policy, planning: { members: [...policy.planning.members, { id: "opus", target: { kind: "provider", provider: "claude-code-cli:opus" } }] } };
  expect((await call("agent_team_configure_orchestration", { policy: mixed })).isError).not.toBe(true);
  const ballot = authority("plan:mixed");
  const mixedAuthority = { ...ballot, votes: [...ballot.votes, { memberId: "opus", artifact: "plan:mixed", status: "approve", summary: "Opus findings", execution: { kind: "provider-run", id: "run_opus", target: { kind: "provider", provider: "claude-code-cli:opus", model: "opus" } } }] };
  expect((await call("agent_team_plan_consensus", { codexDecision, verdicts, authority: mixedAuthority })).isError).toBe(true);
  await writeRunSidecar(workspace, { runId: "run_opus", role: "architect", provider: "claude-code-cli:opus", model: "opus", status: "completed", createdAt: "2026-09-18T00:00:00Z", updatedAt: "2026-09-18T00:00:01Z", capabilitiesUsed: ["structuredOutput"], evidencePaths: ["opus-verdict.txt"], cleanup: "complete" });
  expect((await call("agent_team_plan_consensus", { codexDecision, verdicts, authority: mixedAuthority })).isError).not.toBe(true);
  expect((await readWorkflowRecord(workspace, "workflow_native")).planningStatus).toBe("approved");
});

it("does not send a selected native implementation to the external provider fallback", async () => {
  await call("agent_team_configure_orchestration", { policy });
  await call("agent_team_plan_consensus", { codexDecision, verdicts, authority: authority("plan:digest") });
  let calls = 0;
  await expect(startWorkflowSlices({ workspaceRoot: workspace, workflowId: "workflow_native", concurrency: 1 }, { startRun: async () => { calls++; throw new Error("Must not spawn an external run"); } })).rejects.toThrow(/native/i);
  expect(calls).toBe(0);
});

it("routes a chat-only API reviewer through durable dispatch", async () => {
  vi.stubEnv("OLLAMA_API_KEY", "offline-fixture");
  const apiPolicy = { ...policy, planning: { members: [{ id: "glm", target: { kind: "provider", provider: "ollama-cloud:glm-5.2" } }] } };
  const configured = await call("agent_team_configure_orchestration", { policy: apiPolicy });
  expect(configured.isError).not.toBe(true);
  const prepared = await call("agent_team_prepare_assignments", { phase: "planning" });
  expect(prepared.structuredContent.assignments[0].route.tool).toBe("agent_team_dispatch");
});

it("reuses active Astra for a chosen visual implementation without changing review authority", async () => {
  await call("agent_team_configure_orchestration", { policy });
  await call("agent_team_plan_consensus", { codexDecision, verdicts, authority: authority("plan:digest") });
  const prepared = await call("agent_team_prepare_assignments", { phase: "implementation", sliceId: "slice_native", target: astra,
    coordinator: { source: "runtime", sessionId: "visual-session", model: "gpt-6-astra", reasoningEffort: "xhigh" } });
  expect(prepared.structuredContent.assignments[0].route.kind).toBe("active-session");
  const saved = await readWorkflowRecord(workspace, "workflow_native");
  expect(saved.slices[0]?.implementationTarget).toEqual(astra);
  expect(saved.orchestration?.review).toEqual(policy.review);
});
