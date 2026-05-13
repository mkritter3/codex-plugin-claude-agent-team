import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflowRecordPath } from "../../src/core/state/paths.js";
import { writeWorkflowRecord } from "../../src/core/state/workflow-store.js";
import { buildWorkflowReport } from "../../src/core/workflow-report.js";
import type { WorkflowRecord, WorkflowSlice } from "../../src/core/workflow-types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-workflow-report-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function integratedSlice(overrides: Partial<WorkflowSlice> = {}): WorkflowSlice {
  const sliceId = overrides.sliceId ?? "slice_done";
  return {
    sliceId,
    title: `Slice ${sliceId}`,
    state: "integrated",
    ownerRole: "slice-implementer",
    dependencies: [],
    writeScope: [`src/${sliceId}`],
    acceptanceTests: [`npm test -- ${sliceId}`],
    implementationEvidence: {
      recordedAt: "2026-05-13T12:00:00.000Z",
      summary: `${sliceId} implementation complete.`,
      changedFiles: [`src/${sliceId}/index.ts`],
      testsRun: [`npm test -- tests/${sliceId}.test.ts`],
      evidencePaths: [`/repo/.agent-team/runs/run_${sliceId}.json`],
      sourceRunId: `run_${sliceId}`,
      worktreePath: `/repo/.worktrees/${sliceId}`
    },
    integrationEvidence: [
      {
        integratedAt: "2026-05-13T14:00:00.000Z",
        integrationMethod: "manual-patch",
        summary: `${sliceId} integrated by Codex.`,
        changedFiles: [`src/${sliceId}/index.ts`],
        verification: [
          {
            command: `npm test -- tests/${sliceId}.test.ts`,
            status: "passed",
            summary: "Focused tests passed.",
            evidencePath: `/repo/.agent-team/evidence/${sliceId}-focused.log`
          }
        ],
        evidencePaths: [`/repo/.agent-team/evidence/${sliceId}-integration.json`],
        retainedWorktreePath: `/repo/.worktrees/${sliceId}`,
        cleanupRecommendation: "eligible-after-evidence-saved"
      }
    ],
    ...overrides
  };
}

function approvedSlice(overrides: Partial<WorkflowSlice> = {}): WorkflowSlice {
  const sliceId = overrides.sliceId ?? "slice_ready";
  return {
    sliceId,
    title: `Slice ${sliceId}`,
    state: "approved",
    ownerRole: "slice-implementer",
    dependencies: [],
    writeScope: [`src/${sliceId}`],
    acceptanceTests: [`npm test -- ${sliceId}`],
    implementationEvidence: {
      recordedAt: "2026-05-13T12:00:00.000Z",
      summary: `${sliceId} implementation complete.`,
      changedFiles: [`src/${sliceId}/index.ts`],
      testsRun: [`npm test -- tests/${sliceId}.test.ts`],
      evidencePaths: [`/repo/.agent-team/runs/run_${sliceId}.json`],
      sourceRunId: `run_${sliceId}`,
      worktreePath: `/repo/.worktrees/${sliceId}`
    },
    ...overrides
  };
}

function workflowRecord(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  const workflowId = overrides.workflowId ?? "workflow_report";
  const createdAt = overrides.createdAt ?? "2026-05-13T10:00:00.000Z";
  return {
    workflowId,
    name: "Workflow Report",
    createdAt,
    updatedAt: createdAt,
    planningStatus: "approved",
    goal: {
      title: "Report workflow completion",
      successCriteria: ["Completion claims are evidence-gated"],
      constraints: ["No merge or cleanup execution"],
      nonGoals: ["Provider quality claims"]
    },
    seniorReview: {
      opusPlanning: { mode: "required-when-available" },
      opusImplementation: { mode: "required-when-available" }
    },
    slices: [integratedSlice({ sliceId: "slice_done" })],
    consensusRounds: [],
    userEscalations: [],
    opusReviewEvidence: [],
    integrationQueue: [
      {
        queuePosition: 1,
        sliceId: "slice_done",
        state: "integrated",
        worktreePath: "/repo/.worktrees/slice_done",
        branchName: "codex/workflow_report/slice_done",
        reviewRunIds: ["run_review_slice_done"],
        changedFiles: ["src/slice_done/index.ts"],
        focusedTests: ["npm test -- tests/slice_done.test.ts"],
        queuedAt: "2026-05-13T13:00:00.000Z",
        integratedAt: "2026-05-13T14:00:00.000Z",
        finalGateStatus: "passed",
        integrationEvidencePaths: ["/repo/.agent-team/evidence/slice_done-integration.json"],
        cleanupRecommendation: "eligible-after-evidence-saved"
      }
    ],
    codexRationale: [],
    evidencePath: workflowRecordPath(workspace, workflowId),
    ...overrides
  };
}

async function seed(record: WorkflowRecord = workflowRecord()): Promise<void> {
  await writeWorkflowRecord(workspace, record);
}

describe("workflow report", () => {
  it("reports complete only when every slice is integrated with passing final verification", async () => {
    await seed();

    const result = await buildWorkflowReport({
      workspaceRoot: workspace,
      workflowId: "workflow_report"
    });

    expect(result.completionStatus).toBe("complete");
    expect(result.counts).toMatchObject({
      total: 1,
      integrated: 1,
      cleanupReady: 1
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        sliceId: "slice_done",
        state: "integrated",
        category: "cleanup-ready",
        completionReady: true,
        retainedWorktreePath: "/repo/.worktrees/slice_done",
        cleanupRecommendation: "eligible-after-evidence-saved",
        evidencePaths: ["/repo/.agent-team/evidence/slice_done-integration.json"]
      })
    ]);
    expect(result.report).toContain("Workflow workflow_report is complete");
    expect(result.workflow?.workflowId).toBe("workflow_report");
    expect(JSON.stringify(result)).not.toMatch(
      /internalPrompt|rawProviderPayload|providerSessionId|commandArgs|secret/i
    );
  });

  it("reports queued approved slices as ready to integrate without claiming completion", async () => {
    await seed({
      ...workflowRecord(),
      slices: [
        integratedSlice({ sliceId: "slice_done" }),
        approvedSlice({ sliceId: "slice_ready" })
      ],
      integrationQueue: [
        workflowRecord().integrationQueue[0]!,
        {
          queuePosition: 2,
          sliceId: "slice_ready",
          state: "queued",
          worktreePath: "/repo/.worktrees/slice_ready",
          branchName: "codex/workflow_report/slice_ready",
          reviewRunIds: ["run_review_slice_ready"],
          changedFiles: ["src/slice_ready/index.ts"],
          focusedTests: ["npm test -- tests/slice_ready.test.ts"],
          queuedAt: "2026-05-13T13:05:00.000Z"
        }
      ]
    });

    const result = await buildWorkflowReport({
      workspaceRoot: workspace,
      workflowId: "workflow_report",
      includeWorkflow: false
    });

    expect(result.completionStatus).toBe("incomplete");
    expect(result.workflow).toBeUndefined();
    expect(result.rows.map((row) => [row.sliceId, row.category, row.completionReady])).toEqual([
      ["slice_done", "cleanup-ready", true],
      ["slice_ready", "ready-to-integrate", false]
    ]);
    expect(result.rows[1]?.reasons).toContain("slice is queued for Codex-owned integration");
    expect(result.report).toContain("ready-to-integrate: 1");
  });

  it("reports blocked status for failed, blocked, cancelled, or needs-revision slices", async () => {
    await seed({
      ...workflowRecord(),
      slices: [
        integratedSlice({ sliceId: "slice_done" }),
        approvedSlice({ sliceId: "slice_failed", state: "failed" }),
        approvedSlice({ sliceId: "slice_revision", state: "needs-revision" }),
        approvedSlice({ sliceId: "slice_blocked", state: "blocked", blockedBy: ["slice_failed"] }),
        approvedSlice({ sliceId: "slice_cancelled", state: "cancelled" })
      ]
    });

    const result = await buildWorkflowReport({
      workspaceRoot: workspace,
      workflowId: "workflow_report"
    });

    expect(result.completionStatus).toBe("blocked");
    expect(result.rows.filter((row) => row.category === "blocked").map((row) => row.sliceId)).toEqual([
      "slice_failed",
      "slice_revision",
      "slice_blocked",
      "slice_cancelled"
    ]);
    expect(result.rows.find((row) => row.sliceId === "slice_blocked")?.blockers).toEqual([
      "slice_failed"
    ]);
    expect(result.report).toContain("blocked: 4");
  });

  it("keeps integrated slices incomplete when final verification evidence is missing or failed", async () => {
    await seed({
      ...workflowRecord(),
      slices: [
        integratedSlice({ sliceId: "slice_no_evidence", integrationEvidence: [] }),
        integratedSlice({
          sliceId: "slice_failed_gate",
          integrationEvidence: [
            {
              integratedAt: "2026-05-13T14:00:00.000Z",
              integrationMethod: "manual-patch",
              summary: "Integrated with a failed gate.",
              changedFiles: ["src/slice_failed_gate/index.ts"],
              verification: [
                {
                  command: "npm test -- tests/slice_failed_gate.test.ts",
                  status: "failed",
                  summary: "Focused tests failed."
                }
              ]
            }
          ]
        })
      ]
    });

    const result = await buildWorkflowReport({
      workspaceRoot: workspace,
      workflowId: "workflow_report"
    });

    expect(result.completionStatus).toBe("incomplete");
    expect(result.rows).toEqual([
      expect.objectContaining({
        sliceId: "slice_no_evidence",
        category: "missing-evidence",
        completionReady: false,
        reasons: ["integrated slice is missing integration evidence"]
      }),
      expect.objectContaining({
        sliceId: "slice_failed_gate",
        category: "missing-evidence",
        completionReady: false,
        reasons: ["final verification is not fully passed"]
      })
    ]);
  });
});
