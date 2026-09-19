import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflowRecordPath } from "../../src/core/state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "../../src/core/state/workflow-store.js";
import { buildWorkflowIntegrationQueue } from "../../src/core/workflow-integration-queue.js";
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
  workspace = await mkdtemp(join(tmpdir(), "agent-team-workflow-integration-"));
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
  const workflowId = overrides.workflowId ?? "workflow_integration";
  const createdAt = overrides.createdAt ?? "2026-05-13T10:00:00.000Z";
  return {
    workflowId,
    name: "Integration Workflow",
    createdAt,
    updatedAt: createdAt,
    planningStatus: "approved",
    goal: {
      title: "Plan integration safely",
      successCriteria: ["queue is deterministic"],
      constraints: ["no auto merge"],
      nonGoals: ["cleanup"]
    },
    seniorReview: {
      opusPlanning: { mode: "required-when-available" },
      opusImplementation: { mode: "required-when-available" }
    },
    slices: [
      approvedSlice({
        sliceId: "slice_foundation",
        riskLevel: "low",
        integrationOrderHint: 1
      }),
      approvedSlice({
        sliceId: "slice_feature",
        dependencies: ["slice_foundation"],
        riskLevel: "medium",
        integrationOrderHint: 2
      }),
      approvedSlice({
        sliceId: "slice_docs",
        ownerRole: "docs-dx-writer",
        riskLevel: "low",
        integrationOrderHint: 3,
        writeScope: ["docs"],
        implementationEvidence: {
          recordedAt: "2026-05-13T12:00:00.000Z",
          summary: "Docs implementation evidence.",
          changedFiles: ["docs/runbook.md"],
          testsRun: ["npm test -- tests/docs/runbook.test.ts"],
          evidencePaths: ["/repo/.agent-team/runs/run_slice_docs.json"],
          sourceRunId: "run_slice_docs",
          worktreePath: "/repo/.worktrees/slice_docs"
        }
      }),
      approvedSlice({
        sliceId: "slice_revision",
        state: "needs-revision"
      })
    ],
    consensusRounds: [],
    userEscalations: [],
    opusReviewEvidence: [],
    integrationQueue: [],
    codexRationale: [],
    evidencePath: workflowRecordPath(workspace, workflowId),
    ...overrides
  };
}

async function seed(record: WorkflowRecord = workflowRecord()): Promise<void> {
  await overwriteWorkflow(record);
}

describe("workflow integration queue", () => {
  it("queues approved slices in dependency and hint order while excluding non-approved slices", async () => {
    await seed();

    const result = await buildWorkflowIntegrationQueue({
      workspaceRoot: workspace,
      workflowId: "workflow_integration",
      now: () => new Date("2026-05-13T13:00:00.000Z")
    });

    expect(result.queue.map((item) => item.sliceId)).toEqual([
      "slice_foundation",
      "slice_feature",
      "slice_docs"
    ]);
    expect(result.excluded).toEqual([
      expect.objectContaining({
        sliceId: "slice_revision",
        state: "needs-revision",
        reason: "slice is needs-revision, not approved"
      })
    ]);
    expect(result.workflow.integrationQueue).toEqual([
      expect.objectContaining({
        queuePosition: 1,
        sliceId: "slice_foundation",
        state: "queued",
        conflictRisk: "low",
        worktreePath: "/repo/.worktrees/slice_foundation",
        changedFiles: ["src/slice_foundation/index.ts"],
        dependencySliceIds: []
      }),
      expect.objectContaining({
        queuePosition: 2,
        sliceId: "slice_feature",
        dependencySliceIds: ["slice_foundation"]
      }),
      expect.objectContaining({
        queuePosition: 3,
        sliceId: "slice_docs"
      })
    ]);

    const stored = await readWorkflowRecord(workspace, "workflow_integration");
    expect(stored.integrationQueue.map((item) => item.sliceId)).toEqual([
      "slice_foundation",
      "slice_feature",
      "slice_docs"
    ]);
    expect(JSON.stringify(result.workflow)).not.toMatch(
      /internalPrompt|rawProvider|providerSession|commandArgs|secret/i
    );
  });

  it("raises conflict risk for overlapping write scopes or changed files", async () => {
    await seed({
      ...workflowRecord(),
      slices: [
        approvedSlice({
          sliceId: "slice_a",
          integrationOrderHint: 1,
          writeScope: ["src/shared"],
          implementationEvidence: {
            recordedAt: "2026-05-13T12:00:00.000Z",
            summary: "A",
            changedFiles: ["src/shared/index.ts"],
            testsRun: ["npm test -- a"],
            evidencePaths: ["/repo/.agent-team/runs/run_slice_a.json"],
            sourceRunId: "run_slice_a",
            worktreePath: "/repo/.worktrees/slice_a"
          }
        }),
        approvedSlice({
          sliceId: "slice_b",
          integrationOrderHint: 2,
          writeScope: ["src/shared"],
          implementationEvidence: {
            recordedAt: "2026-05-13T12:00:00.000Z",
            summary: "B",
            changedFiles: ["src/shared/index.ts"],
            testsRun: ["npm test -- b"],
            evidencePaths: ["/repo/.agent-team/runs/run_slice_b.json"],
            sourceRunId: "run_slice_b",
            worktreePath: "/repo/.worktrees/slice_b"
          }
        })
      ]
    });

    const result = await buildWorkflowIntegrationQueue({
      workspaceRoot: workspace,
      workflowId: "workflow_integration"
    });

    expect(result.queue[0]).toMatchObject({ sliceId: "slice_a", conflictRisk: "low" });
    expect(result.queue[1]).toMatchObject({
      sliceId: "slice_b",
      conflictRisk: "high",
      riskReasons: expect.arrayContaining([
        "write scope overlaps earlier queued slice slice_a: src/shared",
        "changed file overlaps earlier queued slice slice_a: src/shared/index.ts"
      ])
    });
  });

  it("fails closed for unapproved workflows, invalid selections, missing evidence, and unresolved dependencies", async () => {
    await seed({ ...workflowRecord(), planningStatus: "in-consensus" });
    await expect(
      buildWorkflowIntegrationQueue({
        workspaceRoot: workspace,
        workflowId: "workflow_integration"
      })
    ).rejects.toThrow("Workflow workflow_integration must be approved before building an integration queue");

    await overwriteWorkflow( workflowRecord());
    await expect(
      buildWorkflowIntegrationQueue({
        workspaceRoot: workspace,
        workflowId: "workflow_integration",
        sliceIds: ["slice_feature", "slice_feature"]
      })
    ).rejects.toThrow("Duplicate workflow slice id: slice_feature");

    await expect(
      buildWorkflowIntegrationQueue({
        workspaceRoot: workspace,
        workflowId: "workflow_integration",
        sliceIds: ["slice_revision"]
      })
    ).rejects.toThrow("Workflow slice slice_revision is needs-revision, not approved");

    const { implementationEvidence: _implementationEvidence, ...sliceWithoutEvidence } = approvedSlice();
    await overwriteWorkflow( {
      ...workflowRecord(),
      slices: [sliceWithoutEvidence]
    });
    await expect(
      buildWorkflowIntegrationQueue({
        workspaceRoot: workspace,
        workflowId: "workflow_integration"
      })
    ).rejects.toThrow("Workflow slice slice_core requires implementation evidence before integration queueing");

    await overwriteWorkflow( {
      ...workflowRecord(),
      slices: [
        approvedSlice({
          dependencies: ["slice_blocked"]
        }),
        approvedSlice({
          sliceId: "slice_blocked",
          state: "blocked"
        })
      ]
    });
    await expect(
      buildWorkflowIntegrationQueue({
        workspaceRoot: workspace,
        workflowId: "workflow_integration"
      })
    ).rejects.toThrow("Workflow slice slice_core depends on slice_blocked, which is blocked");
  });

  it("supports explicit approved selections and rejects dependency cycles", async () => {
    await seed();

    await expect(
      buildWorkflowIntegrationQueue({
        workspaceRoot: workspace,
        workflowId: "workflow_integration",
        sliceIds: ["slice_docs"]
      })
    ).resolves.toMatchObject({
      queue: [expect.objectContaining({ sliceId: "slice_docs" })]
    });

    await overwriteWorkflow( {
      ...workflowRecord(),
      slices: [
        approvedSlice({
          sliceId: "slice_a",
          dependencies: ["slice_b"]
        }),
        approvedSlice({
          sliceId: "slice_b",
          dependencies: ["slice_a"]
        })
      ]
    });

    await expect(
      buildWorkflowIntegrationQueue({
        workspaceRoot: workspace,
        workflowId: "workflow_integration"
      })
    ).rejects.toThrow("Workflow integration queue contains a dependency cycle");
  });
});
