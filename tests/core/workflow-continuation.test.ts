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
