import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflowRecordPath } from "../../src/core/state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "../../src/core/state/workflow-store.js";
import { recordWorkflowIntegration } from "../../src/core/workflow-integration-evidence.js";
import type { WorkflowRecord, WorkflowSlice } from "../../src/core/workflow-types.js";

let workspace: string;

async function overwriteWorkflow(record: WorkflowRecord): Promise<void> {
  try {
    const current = await readWorkflowRecord(workspace, record.workflowId);
    await writeWorkflowRecord(workspace, { ...record, ...(current.revision === undefined ? {} : { revision: current.revision }) });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await writeWorkflowRecord(workspace, record);
      return;
    }
    throw error;
  }
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-workflow-integration-evidence-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function approvedSlice(overrides: Partial<WorkflowSlice> = {}): WorkflowSlice {
  const sliceId = overrides.sliceId ?? "slice_core";
  return {
    sliceId,
    title: `Slice ${sliceId}`,
    state: "approved",
    ownerRole: "slice-implementer",
    dependencies: [],
    writeScope: [`src/${sliceId}`],
    readScope: ["src"],
    acceptanceTests: [`npm test -- ${sliceId}`],
    expectedEvidence: ["focused tests"],
    riskLevel: "medium",
    requiredReviewers: ["code-reviewer", "test-hardening-engineer"],
    implementationEvidence: {
      recordedAt: "2026-05-13T12:00:00.000Z",
      summary: `${sliceId} implementation evidence.`,
      changedFiles: [`src/${sliceId}/index.ts`],
      testsRun: [`npm test -- tests/${sliceId}.test.ts`],
      evidencePaths: [`/repo/.agent-team/runs/run_${sliceId}.json`],
      sourceRunId: `run_${sliceId}`,
      worktreePath: `/repo/.worktrees/${sliceId}`
    },
    reviewEvidence: [
      {
        reviewedAt: "2026-05-13T12:10:00.000Z",
        round: 1,
        consensus: "approved",
        summary: `${sliceId} approved.`,
        reviewerRunIds: [`run_review_${sliceId}`]
      }
    ],
    ...overrides
  };
}

function workflowRecord(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  const workflowId = overrides.workflowId ?? "workflow_integration_evidence";
  const createdAt = overrides.createdAt ?? "2026-05-13T10:00:00.000Z";
  const slice = approvedSlice({ sliceId: "slice_foundation" });
  return {
    workflowId,
    name: "Integration Evidence Workflow",
    createdAt,
    updatedAt: createdAt,
    planningStatus: "approved",
    goal: {
      title: "Record integration evidence safely",
      successCriteria: ["final gate evidence is durable"],
      constraints: ["Codex owns integration execution"],
      nonGoals: ["auto cleanup"]
    },
    seniorReview: {
      opusPlanning: { mode: "required-when-available" },
      opusImplementation: { mode: "required-when-available" }
    },
    slices: [slice],
    consensusRounds: [],
    userEscalations: [],
    opusReviewEvidence: [],
    integrationQueue: [
      {
        queuePosition: 1,
        sliceId: "slice_foundation",
        state: "queued",
        worktreePath: "/repo/.worktrees/slice_foundation",
        branchName: "codex/workflow_integration_evidence/slice_foundation",
        reviewRunIds: ["run_review_slice_foundation"],
        conflictRisk: "low",
        changedFiles: ["src/slice_foundation/index.ts"],
        dependencySliceIds: [],
        focusedTests: ["npm test -- tests/slice_foundation.test.ts"],
        queuedAt: "2026-05-13T13:00:00.000Z"
      }
    ],
    codexRationale: [],
    evidencePath: workflowRecordPath(workspace, workflowId),
    ...overrides
  };
}

async function seed(record: WorkflowRecord = workflowRecord()): Promise<void> {
  await overwriteWorkflow(record);
}

describe("workflow integration evidence", () => {
  it("records passing final gates and marks a queued approved slice integrated", async () => {
    await seed();

    const result = await recordWorkflowIntegration({
      workspaceRoot: workspace,
      workflowId: "workflow_integration_evidence",
      sliceId: "slice_foundation",
      integrationMethod: "manual-merge",
      summary: "Codex integrated the retained slice worktree into main.",
      changedFiles: ["src/slice_foundation/index.ts"],
      verification: [
        {
          command: "npm test -- tests/slice_foundation.test.ts",
          status: "passed",
          summary: "Focused slice tests passed.",
          evidencePath: "/repo/.agent-team/evidence/focused.log"
        },
        {
          command: "npm run typecheck",
          status: "passed",
          summary: "Typecheck passed."
        }
      ],
      evidencePaths: ["/repo/.agent-team/evidence/integration-summary.json"],
      retainedWorktreePath: "/repo/.worktrees/slice_foundation",
      cleanupRecommendation: "eligible-after-evidence-saved",
      now: () => new Date("2026-05-13T14:00:00.000Z")
    });

    expect(result.slice).toMatchObject({
      sliceId: "slice_foundation",
      state: "integrated",
      integrationEvidence: [
        expect.objectContaining({
          integratedAt: "2026-05-13T14:00:00.000Z",
          integrationMethod: "manual-merge",
          summary: "Codex integrated the retained slice worktree into main.",
          changedFiles: ["src/slice_foundation/index.ts"],
          retainedWorktreePath: "/repo/.worktrees/slice_foundation",
          cleanupRecommendation: "eligible-after-evidence-saved"
        })
      ]
    });
    expect(result.queueItem).toMatchObject({
      sliceId: "slice_foundation",
      state: "integrated",
      integratedAt: "2026-05-13T14:00:00.000Z",
      finalGateStatus: "passed",
      cleanupRecommendation: "eligible-after-evidence-saved"
    });
    expect(result.workflow.integrationQueue).toHaveLength(1);
    expect(result.workflow.integrationQueue[0]).toMatchObject({
      queuePosition: 1,
      state: "integrated",
      focusedTests: ["npm test -- tests/slice_foundation.test.ts"]
    });

    const stored = await readWorkflowRecord(workspace, "workflow_integration_evidence");
    expect(stored.slices[0]?.state).toBe("integrated");
    expect(stored.integrationQueue[0]?.state).toBe("integrated");
    expect(JSON.stringify(result.workflow)).not.toMatch(
      /internalPrompt|rawProviderPayload|providerSessionId|commandArgs|secret/i
    );
  });

  it("fails closed without a queued approved slice and passing verification", async () => {
    await seed({ ...workflowRecord(), planningStatus: "in-consensus" });
    const validInput = {
      workspaceRoot: workspace,
      workflowId: "workflow_integration_evidence",
      sliceId: "slice_foundation",
      integrationMethod: "manual-merge" as const,
      summary: "Codex integrated the retained slice worktree into main.",
      changedFiles: ["src/slice_foundation/index.ts"],
      verification: [
        {
          command: "npm test -- tests/slice_foundation.test.ts",
          status: "passed" as const,
          summary: "Focused tests passed."
        }
      ]
    };

    await expect(recordWorkflowIntegration(validInput)).rejects.toThrow(
      "Workflow workflow_integration_evidence must be approved before recording integration evidence"
    );

    await overwriteWorkflow( workflowRecord());
    await expect(
      recordWorkflowIntegration({
        ...validInput,
        sliceId: "slice_missing"
      })
    ).rejects.toThrow("Unknown workflow slice id: slice_missing");

    await overwriteWorkflow( {
      ...workflowRecord(),
      slices: [approvedSlice({ sliceId: "slice_foundation", state: "needs-revision" })]
    });
    await expect(recordWorkflowIntegration(validInput)).rejects.toThrow(
      "Workflow slice slice_foundation is needs-revision, not approved"
    );

    await overwriteWorkflow( {
      ...workflowRecord(),
      integrationQueue: []
    });
    await expect(recordWorkflowIntegration(validInput)).rejects.toThrow(
      "Workflow slice slice_foundation must be queued before recording integration evidence"
    );

    await overwriteWorkflow( workflowRecord());
    await expect(
      recordWorkflowIntegration({
        ...validInput,
        verification: [
          {
            command: "npm test -- tests/slice_foundation.test.ts",
            status: "failed",
            summary: "Focused tests failed."
          }
        ]
      })
    ).rejects.toThrow("Workflow slice slice_foundation cannot be marked integrated with failed verification");
  });
});
