import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { workflowRecordPath } from "../../src/core/state/paths.js";
import { readWorkflowRecord, writeWorkflowRecord } from "../../src/core/state/workflow-store.js";
import { reserveWorkflowContinuation } from "../../src/core/workflow-continuation.js";
import type { RunSidecar } from "../../src/core/types.js";
import type { WorkflowRecord } from "../../src/core/workflow-types.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function parent(): RunSidecar { return { runId: "run_parent", role: "slice-implementer", provider: "agy", model: "gemini-3.8-flash-high", status: "failed", createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", capabilitiesUsed: ["sessionResume"], evidencePaths: [], providerSessionId: "conversation", executionCwd: "/worktree", workflowId: "workflow_resume", sliceId: "slice", writeScope: ["src"] }; }
function record(root: string): WorkflowRecord { return { workflowId: "workflow_resume", name: "Resume", createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", planningStatus: "approved", goal: { title: "x", successCriteria: ["x"], constraints: ["x"], nonGoals: ["x"] }, seniorReview: { opusPlanning: { mode: "disabled" }, opusImplementation: { mode: "disabled" } }, orchestration: { planning: { members: [{ id: "p", target: { kind: "provider", provider: "agy", model: "gemini-3.8-flash-high" } }] }, review: { members: [{ id: "r", target: { kind: "provider", provider: "agy", model: "gemini-3.8-flash-high" } }] }, implementation: { kind: "provider", provider: "agy", model: "gemini-3.8-flash-high" } }, slices: [{ sliceId: "slice", title: "x", state: "running", ownerRole: "slice-implementer", dependencies: [], writeScope: ["src"], acceptanceTests: ["test"], runIds: ["run_parent"], implementationTarget: { kind: "provider", provider: "agy", model: "gemini-3.8-flash-high" } }], consensusRounds: [], userEscalations: [], opusReviewEvidence: [], integrationQueue: [], codexRationale: [], evidencePath: workflowRecordPath(root, "workflow_resume") }; }

describe("workflow reply continuation", () => {
  it("links the child before launch and blocks duplicate crash-window retries", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-team-resume-workflow-")); roots.push(root); await writeWorkflowRecord(root, record(root));
    const input = { workspaceRoot: root, workflowId: "workflow_resume", sliceId: "slice", parent: parent(), childRunId: "run_child", createdAt: "2026-09-18T00:01:00.000Z" };
    await reserveWorkflowContinuation(input);
    await expect(readWorkflowRecord(root, "workflow_resume")).resolves.toMatchObject({ slices: [{ runIds: ["run_parent", "run_child"], runEvidence: [{ runId: "run_child", parentRunId: "run_parent" }] }] });
    await expect(reserveWorkflowContinuation({ ...input, childRunId: "run_retry" })).rejects.toThrow("already reserved");
    await expect(reserveWorkflowContinuation({ ...input, parent: { ...parent(), model: "wrong" } })).rejects.toThrow("provider/model");
  });

  it("rejects a stale workflow write after a continuation reservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-team-resume-workflow-stale-")); roots.push(root); await writeWorkflowRecord(root, record(root));
    const stale = await readWorkflowRecord(root, "workflow_resume");
    await reserveWorkflowContinuation({ workspaceRoot: root, workflowId: "workflow_resume", sliceId: "slice", parent: parent(), childRunId: "run_child", createdAt: "2026-09-18T00:01:00.000Z" });
    await expect(writeWorkflowRecord(root, { ...stale, updatedAt: "2026-09-18T00:02:00.000Z" })).rejects.toThrow("changed concurrently");
    await expect(readWorkflowRecord(root, "workflow_resume")).resolves.toMatchObject({ slices: [{ runIds: ["run_parent", "run_child"] }] });
  });

  it("rejects a legacy undefined-revision writer after a reservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-team-resume-workflow-legacy-"));
    roots.push(root);
    await writeWorkflowRecord(root, record(root));
    const { revision: _revision, ...legacyStale } = await readWorkflowRecord(root, "workflow_resume");
    await reserveWorkflowContinuation({ workspaceRoot: root, workflowId: "workflow_resume", sliceId: "slice", parent: parent(), childRunId: "run_child", createdAt: "2026-09-18T00:01:00.000Z" });
    await expect(writeWorkflowRecord(root, legacyStale)).rejects.toThrow("changed concurrently");
  });

  it("requires the parent to retain the exact approved write scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-team-resume-workflow-scope-"));
    roots.push(root);
    await writeWorkflowRecord(root, record(root));
    const { writeScope: _missingScope, ...legacyParent } = parent();
    await expect(reserveWorkflowContinuation({
      workspaceRoot: root,
      workflowId: "workflow_resume",
      sliceId: "slice",
      parent: { ...parent(), writeScope: ["src/other"] },
      childRunId: "run_child",
      createdAt: "2026-09-18T00:01:00.000Z"
    })).rejects.toThrow("scope changed");
    await expect(reserveWorkflowContinuation({
      workspaceRoot: root,
      workflowId: "workflow_resume",
      sliceId: "slice",
      parent: legacyParent,
      childRunId: "run_child",
      createdAt: "2026-09-18T00:01:00.000Z"
    })).rejects.toThrow("lacks preserved scope");
  });
});

import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { AgentLifecycleManager } from "../../src/core/lifecycle.js";
import { startWorkflowSlices } from "../../src/core/workflow-slices.js";
import { reviewWorkflowSlice } from "../../src/core/workflow-review.js";
import { readRunSidecar } from "../../src/core/state/run-store.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import type { AgentProviderDescriptor } from "../../src/core/types.js";
import type { ProviderSessionDoneStatus, ProviderSessionHandle, ProviderSessionSnapshot } from "../../src/providers/types.js";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((inner) => { resolve = inner; }); return { promise, resolve }; }
function handle(done: Promise<ProviderSessionDoneStatus>, sessionId: string): ProviderSessionHandle {
  const snapshot: ProviderSessionSnapshot = { providerSessionId: sessionId, text: "<<<VERDICT>>>\nstatus: SHIP\nsummary: done\nrequired_changes:\n- none\nevidence:\n- test\nrisks:\n- none\n<<<END_VERDICT>>>", warnings: [], recentActivities: [], currentActivity: null, pendingOutboxRequests: [], lastStderr: [], transcriptPath: undefined, logPath: undefined };
  return { providerSessionId: sessionId, done, recentActivities: [], currentActivity: null, lastStderr: [], transcriptPath: undefined, logPath: undefined, supportsStdin: false, kill() {}, forceKill() {}, snapshot: () => snapshot };
}

it("runs a linked AGY workflow continuation through exact-artifact independent approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-team-e2e-workflow-"));
  roots.push(root);
  await writeFile(join(root, "tracked.txt"), "base\n");
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", root, "add", "."]); execFileSync("git", ["-C", root, "commit", "-qm", "base"]);
  const initialWorkflow = record(root);
  const workflow = { ...initialWorkflow, slices: initialWorkflow.slices.map((item) => { const { runIds: _runIds, ...rest } = item; return { ...rest, state: "ready" as const }; }) };
  await writeWorkflowRecord(root, workflow);
  const provider: AgentProviderDescriptor = { id: "agy", displayName: "AGY", authMode: "oauth", model: "gemini-3.8-flash-high", capabilities: ["structuredOutput", "sessionResume", "cancellation", "tools", "edits", "workspaceIsolation"], available: true };
  const parentDone = deferred<ProviderSessionDoneStatus>(); const childDone = deferred<ProviderSessionDoneStatus>();
  const started: ProviderSessionHandle[] = [handle(parentDone.promise, "conversation-e2e"), handle(childDone.promise, "conversation-e2e")];
  const manager = new AgentLifecycleManager({ providers: [provider], config: { ...DEFAULT_AGENT_TEAM_CONFIG, writeMode: { enabled: true, requireIsolatedWorktree: true }, policy: { ...DEFAULT_AGENT_TEAM_CONFIG.policy, allowWriteMode: true } }, createRunId: (() => { const ids = ["run_parent_e2e", "run_child_e2e"]; return () => ids.shift()!; })(), startSession: () => started.shift()! });
  const startedSlices = await startWorkflowSlices({ workspaceRoot: root, workflowId: "workflow_resume", concurrency: 1 }, { startRun: (request) => manager.startRun(request) });
  const parentId = startedSlices.slices[0]!.status === "started" ? startedSlices.slices[0]!.run.runId : "";
  expect(parentId).toBe("run_parent_e2e");
  parentDone.resolve("failed");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await readRunSidecar(root, parentId)).status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const child = await manager.replyRun({ cwd: root, runId: parentId, message: "continue exact scope", workflowId: "workflow_resume", sliceId: "slice" });
  expect(child).toMatchObject({ runId: "run_child_e2e", providerSessionId: "conversation-e2e" });
  const childCwd = child.executionCwd!;
  await writeFile(join(childCwd, "tracked.txt"), "child change\n");
  childDone.resolve("completed");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await readRunSidecar(root, child.runId)).status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const childSidecar = await readRunSidecar(root, child.runId);
  expect(childSidecar).toMatchObject({ status: "completed", workflowId: "workflow_resume", sliceId: "slice", writeScope: ["src"] });
  const artifact = `sha256:${childSidecar.artifactFingerprint!}`;
  await (await import("../../src/core/state/run-store.js")).writeRunSidecar(root, { runId: "run_review_independent", role: "code-reviewer", provider: "agy", model: "gemini-3.8-flash-high", status: "completed", createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z", capabilitiesUsed: [], evidencePaths: [] });
  const approved = await reviewWorkflowSlice({ workspaceRoot: root, workflowId: "workflow_resume", sliceId: "slice", implementationEvidence: { artifact, summary: "completed child", changedFiles: ["tracked.txt"], testsRun: ["test"], evidencePaths: [child.sidecarPath], sourceRunId: child.runId, worktreePath: childCwd }, authority: { artifact, votes: [{ memberId: "r", status: "approve", artifact, summary: "independent", execution: { kind: "provider-run", id: "run_review_independent", target: { kind: "provider", provider: "agy", model: "gemini-3.8-flash-high" } } }] }, codexDecision: { status: "approve", category: "technical", summary: "approved" }, verdicts: [{ reviewerRole: "code-reviewer", status: "approve", summary: "approved" }] });
  expect(approved.workflow.slices).toEqual(expect.arrayContaining([expect.objectContaining({ state: "approved" })]));
});
