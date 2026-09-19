import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflowRecordPath } from "../../src/core/state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "../../src/core/state/workflow-store.js";
import { reviewWorkflowSlice } from "../../src/core/workflow-review.js";
import type { WorkflowRecord, WorkflowSlice } from "../../src/core/workflow-types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-workflow-review-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function slice(overrides: Partial<WorkflowSlice> = {}): WorkflowSlice {
  return {
    sliceId: "slice_core",
    title: "Core implementation",
    state: "running",
    ownerRole: "backend-engineer",
    dependencies: [],
    writeScope: ["src/core/workflow-review.ts"],
    readScope: ["src/core"],
    acceptanceTests: ["workflow review tests"],
    expectedEvidence: ["focused tests", "diff evidence"],
    riskLevel: "medium",
    requiredReviewers: ["code-reviewer", "test-hardening-engineer"],
    runIds: ["run_impl_1"],
    runEvidence: [
      {
        runId: "run_impl_1",
        startedAt: "2026-05-13T11:00:00.000Z",
        provider: "claude-code-cli",
        role: "backend-engineer",
        sidecarPath: "/repo/.agent-team/runs/run_impl_1.json",
        logPath: "/repo/.agent-team/logs/run_impl_1.log",
        executionCwd: "/repo/.worktrees/run_impl_1"
      }
    ],
    ...overrides
  };
}

function workflowRecord(
  overrides: Partial<WorkflowRecord> = {}
): WorkflowRecord {
  const workflowId = overrides.workflowId ?? "workflow_review";
  const createdAt = overrides.createdAt ?? "2026-05-13T10:00:00.000Z";
  return {
    workflowId,
    name: "Review Workflow",
    createdAt,
    updatedAt: createdAt,
    planningStatus: "approved",
    goal: {
      title: "Review implementation slices",
      successCriteria: ["slice review blocks unsafe integration"],
      constraints: ["Codex remains final authority"],
      nonGoals: ["auto merge"]
    },
    seniorReview: {
      opusPlanning: { mode: "required-when-available" },
      opusImplementation: { mode: "required-when-available" }
    },
    slices: [slice()],
    consensusRounds: [
      {
        round: 1,
        phase: "planning",
        startedAt: createdAt,
        completedAt: createdAt,
        verdicts: [
          {
            reviewerRole: "planner",
            status: "approve",
            summary: "The plan is approved."
          }
        ],
        consensus: "approved"
      }
    ],
    userEscalations: [],
    opusReviewEvidence: [],
    integrationQueue: [],
    codexRationale: [],
    evidencePath: workflowRecordPath(workspace, workflowId),
    ...overrides
  };
}

async function seed(record: WorkflowRecord = workflowRecord()): Promise<void> {
  await writeWorkflowRecord(workspace, record);
}

const implementationEvidence = {
  summary: "Implemented the review gate with focused state tests.",
  changedFiles: ["src/core/workflow-review.ts", "tests/core/workflow-review.test.ts"],
  testsRun: ["npm test -- tests/core/workflow-review.test.ts"],
  evidencePaths: ["/repo/.agent-team/runs/run_impl_1.json"],
  sourceRunId: "run_impl_1",
  worktreePath: "/repo/.worktrees/run_impl_1",
  knownRisks: ["integration queue is intentionally out of scope"]
} as const;

const approvingVerdicts = [
  {
    reviewerRole: "code-reviewer",
    status: "approve",
    summary: "The implementation is bounded and correct.",
    evidenceRunId: "run_review_1"
  },
  {
    reviewerRole: "test-hardening-engineer",
    status: "approve",
    summary: "The focused edge cases cover review-state transitions."
  }
] as const;

describe("workflow slice review consensus", () => {
  it("approves a reviewed slice with implementation evidence and degraded Opus availability", async () => {
    await seed();

    const result = await reviewWorkflowSlice({
      workspaceRoot: workspace,
      workflowId: "workflow_review",
      sliceId: "slice_core",
      now: () => new Date("2026-05-13T12:00:00.000Z"),
      implementationEvidence,
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Codex approves the slice because evidence and reviewers are clean.",
        relatedSliceIds: ["slice_core"]
      },
      verdicts: approvingVerdicts,
      seniorReviewerEvidence: {
        status: "unavailable",
        provider: "claude-code-cli:opus",
        summary: "Opus implementation review was requested but unavailable; Codex continued with degraded evidence."
      }
    });

    expect(result.workflow.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sliceId: "slice_core",
          state: "approved",
          implementationEvidence: expect.objectContaining({
            sourceRunId: "run_impl_1",
            changedFiles: implementationEvidence.changedFiles,
            testsRun: implementationEvidence.testsRun
          }),
          reviewEvidence: [
            expect.objectContaining({
              round: 1,
              consensus: "approved",
              reviewerRunIds: ["run_review_1"]
            })
          ]
        })
      ])
    );
    expect(result.workflow.consensusRounds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          round: 1,
          phase: "review",
          consensus: "approved"
        })
      ])
    );
    expect(result.workflow.opusReviewEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "review",
          status: "unavailable",
          requiredMode: "required-when-available"
        })
      ])
    );
    expect(JSON.stringify(result.workflow)).not.toMatch(
      /internalPrompt|rawProvider|providerSession|commandArgs|secret/i
    );
  });

  it("tracks review rounds independently from planning rounds and enforces the 10/15 cap", async () => {
    await seed({
      ...workflowRecord(),
      consensusRounds: [
        {
          round: 10,
          phase: "planning",
          startedAt: "2026-05-13T10:00:00.000Z",
          completedAt: "2026-05-13T10:00:30.000Z",
          verdicts: [{ reviewerRole: "planner", status: "approve", summary: "Approved." }],
          consensus: "approved"
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          round: index + 1,
          phase: "review" as const,
          startedAt: `2026-05-13T11:${String(index).padStart(2, "0")}:00.000Z`,
          completedAt: `2026-05-13T11:${String(index).padStart(2, "0")}:30.000Z`,
          verdicts: [
            {
              reviewerRole: "code-reviewer",
              status: "revise" as const,
              summary: "Review still needs another round."
            }
          ],
          consensus: "needs-revision" as const
        }))
      ]
    });

    const input = {
      workspaceRoot: workspace,
      workflowId: "workflow_review",
      sliceId: "slice_core",
      implementationEvidence,
      codexDecision: {
        status: "revise",
        category: "technical",
        summary: "Codex is continuing review because remaining changes are close."
      },
      verdicts: [
        {
          reviewerRole: "code-reviewer",
          status: "revise",
          summary: "One test assertion still needs tightening."
        }
      ],
      now: () => new Date("2026-05-13T12:01:00.000Z")
    } as const;

    await expect(reviewWorkflowSlice(input)).rejects.toThrow(
      "round 11 requires extended review mode"
    );
    await expect(reviewWorkflowSlice({ ...input, roundMode: "extended" })).resolves.toMatchObject({
      workflow: {
        consensusRounds: expect.arrayContaining([
          expect.objectContaining({ phase: "review", round: 11 })
        ])
      }
    });

    const record = await readWorkflowRecord(workspace, "workflow_review");
    await writeWorkflowRecord(workspace, {
      ...record,
      consensusRounds: [
        record.consensusRounds[0]!,
        ...Array.from({ length: 15 }, (_, index) => ({
          round: index + 1,
          phase: "review" as const,
          startedAt: `2026-05-13T11:${String(index).padStart(2, "0")}:00.000Z`,
          completedAt: `2026-05-13T11:${String(index).padStart(2, "0")}:30.000Z`,
          verdicts: [
            {
              reviewerRole: "code-reviewer",
              status: "revise" as const,
              summary: "Review is still unresolved."
            }
          ],
          consensus: "needs-revision" as const
        }))
      ]
    });

    await expect(reviewWorkflowSlice({ ...input, roundMode: "extended" })).rejects.toThrow(
      "review consensus cannot exceed 15 rounds"
    );
  });

  it("prevents approval without implementation evidence or with blocking senior-review policy", async () => {
    await seed();

    await expect(
      reviewWorkflowSlice({
        workspaceRoot: workspace,
        workflowId: "workflow_review",
        sliceId: "slice_core",
        codexDecision: {
          status: "approve",
          category: "technical",
          summary: "Codex cannot approve without implementation evidence."
        },
        verdicts: approvingVerdicts
      })
    ).rejects.toThrow("implementation evidence is required before approving a slice");

    const recordBeforePolicyUpdate = await readWorkflowRecord(workspace, "workflow_review");
    await writeWorkflowRecord(workspace, {
      ...recordBeforePolicyUpdate,
      seniorReview: {
        opusPlanning: { mode: "required-when-available" },
        opusImplementation: { mode: "required-blocking" }
      }
    });

    const blocked = await reviewWorkflowSlice({
      workspaceRoot: workspace,
      workflowId: "workflow_review",
      sliceId: "slice_core",
      implementationEvidence,
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Codex would approve, but blocking Opus review is unavailable."
      },
      verdicts: approvingVerdicts,
      seniorReviewerEvidence: {
        status: "unavailable",
        provider: "claude-code-cli:opus",
        summary: "Blocking senior reviewer was unavailable."
      }
    });

    expect(blocked.workflow.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sliceId: "slice_core", state: "blocked" })
      ])
    );
    expect(blocked.workflow.consensusRounds).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "review", consensus: "blocked" })])
    );
  });

  it("moves slices to needs-revision or blocked when reviewers object", async () => {
    await seed();

    const needsRevision = await reviewWorkflowSlice({
      workspaceRoot: workspace,
      workflowId: "workflow_review",
      sliceId: "slice_core",
      implementationEvidence,
      codexDecision: {
        status: "revise",
        category: "technical",
        summary: "Codex requires another test-hardening pass."
      },
      verdicts: [
        {
          reviewerRole: "test-hardening-engineer",
          status: "revise",
          summary: "Add malformed evidence-path tests."
        }
      ]
    });
    expect(needsRevision.workflow.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sliceId: "slice_core", state: "needs-revision" })
      ])
    );

    const recordBeforeSecurityCase = await readWorkflowRecord(workspace, "workflow_review");
    await writeWorkflowRecord(workspace, {
      ...workflowRecord(),
      ...(recordBeforeSecurityCase.revision === undefined ? {} : { revision: recordBeforeSecurityCase.revision })
    });
    const blocked = await reviewWorkflowSlice({
      workspaceRoot: workspace,
      workflowId: "workflow_review",
      sliceId: "slice_core",
      implementationEvidence,
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Codex cannot override a security blocker without revision."
      },
      verdicts: [
        {
          reviewerRole: "security-reviewer",
          status: "block",
          summary: "Potential secret exposure must be fixed before integration."
        }
      ]
    });

    expect(blocked.workflow.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sliceId: "slice_core", state: "blocked" })
      ])
    );
    expect(blocked.workflow.consensusRounds).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "review", consensus: "blocked" })])
    );
  });

  it("escalates round-15 user-level disagreement but rejects technical user escalations", async () => {
    await seed({
      ...workflowRecord(),
      consensusRounds: Array.from({ length: 14 }, (_, index) => ({
        round: index + 1,
        phase: "review" as const,
        startedAt: `2026-05-13T11:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-05-13T11:${String(index).padStart(2, "0")}:30.000Z`,
        verdicts: [
          {
            reviewerRole: "security-reviewer",
            status: "revise" as const,
            summary: "Release risk posture remains unresolved."
          }
        ],
        consensus: "needs-revision" as const
      }))
    });

    const result = await reviewWorkflowSlice({
      workspaceRoot: workspace,
      workflowId: "workflow_review",
      sliceId: "slice_core",
      roundMode: "extended",
      implementationEvidence,
      codexDecision: {
        status: "revise",
        category: "release-posture",
        summary: "The review dispute now affects release timing."
      },
      verdicts: [
        {
          reviewerRole: "devops-release-engineer",
          status: "revise",
          summary: "Release posture needs a product-level decision."
        }
      ]
    });

    expect(result.workflow.consensusRounds).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "review", round: 15, consensus: "escalated" })])
    );
    expect(result.workflow.userEscalations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          question: "Resolve the remaining review disagreement.",
          productImpact: "The review dispute now affects release timing."
        })
      ])
    );

    const recordBeforeEscalationCase = await readWorkflowRecord(workspace, "workflow_review");
    await writeWorkflowRecord(workspace, {
      ...workflowRecord(),
      ...(recordBeforeEscalationCase.revision === undefined ? {} : { revision: recordBeforeEscalationCase.revision })
    });
    await expect(
      reviewWorkflowSlice({
        workspaceRoot: workspace,
        workflowId: "workflow_review",
        sliceId: "slice_core",
        implementationEvidence,
        codexDecision: {
          status: "revise",
          category: "technical",
          summary: "Codex owns this implementation detail."
        },
        verdicts: [
          {
            reviewerRole: "code-reviewer",
            status: "revise",
            summary: "Needs a simpler helper."
          }
        ],
        userEscalations: [
          {
            category: "technical",
            question: "Which helper should exist?",
            productImpact: "No product impact.",
            options: ["helper A", "helper B"]
          }
        ]
      })
    ).rejects.toThrow("user escalation category technical is Codex-owned");
  });
});
