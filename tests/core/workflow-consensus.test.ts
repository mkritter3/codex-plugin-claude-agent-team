import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflowRecordPath } from "../../src/core/state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "../../src/core/state/workflow-store.js";
import { planConsensus } from "../../src/core/workflow-consensus.js";
import type { WorkflowRecord } from "../../src/core/workflow-types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-workflow-consensus-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function workflowRecord(
  overrides: Partial<WorkflowRecord> = {}
): WorkflowRecord {
  const workflowId = overrides.workflowId ?? "workflow_consensus";
  const createdAt = overrides.createdAt ?? "2026-05-13T10:00:00.000Z";
  return {
    workflowId,
    name: "Consensus Workflow",
    createdAt,
    updatedAt: createdAt,
    planningStatus: "ready-for-consensus",
    goal: {
      title: "Plan a workflow",
      successCriteria: ["consensus is durable"],
      constraints: ["Codex remains final authority"],
      nonGoals: ["live provider calls"]
    },
    seniorReview: {
      opusPlanning: { mode: "required-when-available" },
      opusImplementation: { mode: "required-when-available" }
    },
    slices: [
      {
        sliceId: "slice_core",
        title: "Core consensus",
        state: "ready",
        ownerRole: "planner",
        dependencies: [],
        writeScope: ["src/core/workflow-consensus.ts"],
        acceptanceTests: ["workflow consensus tests"],
        expectedEvidence: ["focused tests"]
      }
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
  await writeWorkflowRecord(workspace, record);
}

const approveVerdicts = [
  {
    reviewerRole: "architect",
    reviewerProvider: "fixture-reviewer",
    status: "approve",
    summary: "The plan preserves source-of-truth boundaries.",
    evidenceRunId: "run_architect_review"
  },
  {
    reviewerRole: "test-designer",
    status: "approve",
    summary: "The acceptance tests cover the goal."
  }
] as const;

describe("workflow planning consensus", () => {
  it("records an approved planning round with senior reviewer evidence", async () => {
    await seed();

    const result = await planConsensus({
      workspaceRoot: workspace,
      workflowId: "workflow_consensus",
      now: () => new Date("2026-05-13T11:00:00.000Z"),
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Codex approves the plan because the dissent-free slices are bounded.",
        relatedSliceIds: ["slice_core"]
      },
      verdicts: approveVerdicts,
      seniorReviewerEvidence: {
        status: "available",
        provider: "senior-reviewer:opus",
        runId: "run_opus_planning",
        summary: "Senior reviewer approved the planning record."
      }
    });

    expect(result.workflow).toMatchObject({
      planningStatus: "approved",
      consensusRounds: [
        expect.objectContaining({
          round: 1,
          phase: "planning",
          consensus: "approved",
          verdicts: expect.arrayContaining([
            expect.objectContaining({ reviewerRole: "architect", status: "approve" })
          ])
        })
      ],
      opusReviewEvidence: [
        expect.objectContaining({
          phase: "planning",
          status: "available",
          requiredMode: "required-when-available",
          runId: "run_opus_planning"
        })
      ],
      codexRationale: [
        expect.objectContaining({
          category: "technical",
          summary: "Codex approves the plan because the dissent-free slices are bounded."
        })
      ]
    });
    expect(JSON.stringify(result.workflow)).not.toMatch(/internalPrompt|rawProvider|providerSession|commandArgs|secret/i);
  });

  it("keeps revision rounds in consensus before the default decision cap", async () => {
    await seed();

    const result = await planConsensus({
      workspaceRoot: workspace,
      workflowId: "workflow_consensus",
      now: () => new Date("2026-05-13T11:01:00.000Z"),
      codexDecision: {
        status: "revise",
        category: "technical",
        summary: "Codex wants the test plan sharpened before approval."
      },
      verdicts: [
        {
          reviewerRole: "test-hardening-engineer",
          status: "revise",
          summary: "Add malformed-input and corruption-recovery cases."
        }
      ]
    });

    expect(result.workflow.planningStatus).toBe("in-consensus");
    expect(result.workflow.consensusRounds).toEqual([
      expect.objectContaining({ round: 1, consensus: "needs-revision" })
    ]);
    expect(result.workflow.userEscalations).toEqual([]);
  });

  it("requires explicit extended mode after round 10 and rejects round 16", async () => {
    await seed({
      ...workflowRecord(),
      consensusRounds: Array.from({ length: 10 }, (_, index) => ({
        round: index + 1,
        phase: "planning",
        startedAt: `2026-05-13T10:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-05-13T10:${String(index).padStart(2, "0")}:30.000Z`,
        verdicts: [
          {
            reviewerRole: "planner",
            status: "revise",
            summary: "More planning work is required."
          }
        ],
        consensus: "needs-revision"
      }))
    });

    const input = {
      workspaceRoot: workspace,
      workflowId: "workflow_consensus",
      now: () => new Date("2026-05-13T11:02:00.000Z"),
      codexDecision: {
        status: "revise",
        category: "technical",
        summary: "Codex is extending because the plan is close."
      },
      verdicts: [
        {
          reviewerRole: "planner",
          status: "revise",
          summary: "One dependency still needs clarification."
        }
      ]
    } as const;

    await expect(planConsensus(input)).rejects.toThrow(
      "round 11 requires extended consensus mode"
    );

    await expect(planConsensus({ ...input, roundMode: "extended" })).resolves.toMatchObject({
      workflow: {
        consensusRounds: expect.arrayContaining([
          expect.objectContaining({ round: 11, consensus: "needs-revision" })
        ])
      }
    });

    const record = await readWorkflowRecord(workspace, "workflow_consensus");
    await writeWorkflowRecord(workspace, {
      ...record,
      consensusRounds: Array.from({ length: 15 }, (_, index) => ({
        round: index + 1,
        phase: "planning",
        startedAt: `2026-05-13T10:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-05-13T10:${String(index).padStart(2, "0")}:30.000Z`,
        verdicts: [
          {
            reviewerRole: "planner",
            status: "revise",
            summary: "Still unresolved."
          }
        ],
        consensus: "needs-revision"
      }))
    });

    await expect(planConsensus({ ...input, roundMode: "extended" })).rejects.toThrow(
      "planning consensus cannot exceed 15 rounds"
    );
  });

  it("escalates unresolved material disagreement at round 15", async () => {
    await seed({
      ...workflowRecord(),
      consensusRounds: Array.from({ length: 14 }, (_, index) => ({
        round: index + 1,
        phase: "planning",
        startedAt: `2026-05-13T10:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-05-13T10:${String(index).padStart(2, "0")}:30.000Z`,
        verdicts: [
          {
            reviewerRole: "security-reviewer",
            status: "revise",
            summary: "Security risk needs a product-level posture decision."
          }
        ],
        consensus: "needs-revision"
      }))
    });

    const result = await planConsensus({
      workspaceRoot: workspace,
      workflowId: "workflow_consensus",
      roundMode: "extended",
      now: () => new Date("2026-05-13T11:03:00.000Z"),
      codexDecision: {
        status: "revise",
        category: "security-risk",
        summary: "Codex cannot resolve the remaining security posture alone."
      },
      verdicts: [
        {
          reviewerRole: "security-reviewer",
          status: "block",
          summary: "The release needs an explicit trust-risk decision."
        }
      ],
      userEscalations: [
        {
          category: "security-risk",
          question: "Should the workflow ship with degraded senior-review evidence?",
          productImpact: "Shipping faster may lower user trust for high-risk changes.",
          options: ["ship degraded for internal use", "wait for senior review"]
        }
      ]
    });

    expect(result.workflow.planningStatus).toBe("escalated");
    expect(result.workflow.consensusRounds.at(-1)).toMatchObject({
      round: 15,
      consensus: "escalated"
    });
    expect(result.workflow.userEscalations).toEqual([
      expect.objectContaining({
        status: "open",
        question: "Should the workflow ship with degraded senior-review evidence?",
        productImpact: "Shipping faster may lower user trust for high-risk changes."
      })
    ]);
  });

  it("records degraded senior-review evidence without silently blocking required-when-available", async () => {
    await seed();

    const result = await planConsensus({
      workspaceRoot: workspace,
      workflowId: "workflow_consensus",
      now: () => new Date("2026-05-13T11:04:00.000Z"),
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Codex approves with recorded degraded senior-review evidence."
      },
      verdicts: approveVerdicts,
      seniorReviewerEvidence: {
        status: "unavailable",
        provider: "senior-reviewer:opus",
        summary: "Senior reviewer was not reachable; Codex continued with degraded evidence."
      }
    });

    expect(result.workflow.planningStatus).toBe("approved");
    expect(result.workflow.opusReviewEvidence).toEqual([
      expect.objectContaining({
        status: "unavailable",
        requiredMode: "required-when-available",
        summary: "Senior reviewer was not reachable; Codex continued with degraded evidence."
      })
    ]);
  });

  it("does not approve when required-blocking senior review is unavailable", async () => {
    await seed({
      ...workflowRecord(),
      seniorReview: {
        opusPlanning: { mode: "required-blocking" },
        opusImplementation: { mode: "required-when-available" }
      }
    });

    const result = await planConsensus({
      workspaceRoot: workspace,
      workflowId: "workflow_consensus",
      now: () => new Date("2026-05-13T11:05:00.000Z"),
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Codex cannot override required-blocking senior review."
      },
      verdicts: approveVerdicts,
      seniorReviewerEvidence: {
        status: "unavailable",
        provider: "senior-reviewer:opus",
        summary: "Senior reviewer is unavailable."
      }
    });

    expect(result.workflow.planningStatus).toBe("in-consensus");
    expect(result.workflow.consensusRounds).toEqual([
      expect.objectContaining({ consensus: "blocked" })
    ]);
  });

  it("rejects user escalations for technical-only categories", async () => {
    await seed();

    await expect(
      planConsensus({
        workspaceRoot: workspace,
        workflowId: "workflow_consensus",
        codexDecision: {
          status: "revise",
          category: "technical",
          summary: "Codex owns this technical decision."
        },
        verdicts: [
          {
            reviewerRole: "planner",
            status: "revise",
            summary: "The dependency order should change."
          }
        ],
        userEscalations: [
          {
            category: "technical",
            question: "Which module boundary should we pick?",
            productImpact: "No direct product-level impact.",
            options: ["A", "B"]
          }
        ]
      })
    ).rejects.toThrow("user escalation category technical is Codex-owned");
  });
});
