import { describe, expect, it } from "vitest";
import { DEFAULT_SENIOR_REVIEW_POLICY } from "../../src/core/workflow-types.js";
import { deriveWorkflowGuidance } from "../../src/core/workflow-guidance.js";
import type { WorkflowRecord, WorkflowSlice } from "../../src/core/workflow-types.js";

function slice(overrides: Partial<WorkflowSlice> = {}): WorkflowSlice {
  return {
    sliceId: "slice_core",
    title: "Core slice",
    state: "planned",
    ownerRole: "slice-implementer",
    dependencies: [],
    writeScope: ["src/core"],
    acceptanceTests: ["npm test -- tests/core"],
    expectedEvidence: ["focused tests"],
    ...overrides
  };
}

function workflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    workflowId: "workflow_guidance",
    createdAt: "2026-05-13T10:00:00.000Z",
    updatedAt: "2026-05-13T10:00:00.000Z",
    planningStatus: "draft",
    goal: {
      title: "Ship guided workflow",
      successCriteria: ["Codex knows the next safe step"],
      constraints: ["No hidden auto-progression"],
      nonGoals: ["Provider quality claims"]
    },
    seniorReview: DEFAULT_SENIOR_REVIEW_POLICY,
    slices: [],
    consensusRounds: [],
    userEscalations: [],
    opusReviewEvidence: [],
    integrationQueue: [],
    codexRationale: [],
    evidencePath: "/repo/.agent-team/workflows/workflow_guidance.json",
    ...overrides
  };
}

describe("deriveWorkflowGuidance", () => {
  it("includes Opus planning delegation guidance during planning", () => {
    const guidance = deriveWorkflowGuidance(
      workflow({
        planningStatus: "in-consensus",
        consensusRounds: [
          {
            round: 1,
            phase: "planning",
            startedAt: "2026-05-13T10:01:00.000Z",
            consensus: "needs-revision",
            verdicts: [{ reviewerRole: "architect", status: "revise", summary: "Tighten scope." }]
          }
        ]
      })
    );

    expect(guidance.phase).toBe("planning");
    expect(guidance.delegation.map((item) => item.workType)).toEqual(["planning"]);
    expect(guidance.delegation[0]?.providerPreferences).toContain("claude-code-cli:opus");
    expect(guidance.delegation[0]?.claimBoundary).toBe("routing_guidance_only");
  });

  it("includes implementation and junior-worker delegation guidance while executing", () => {
    const guidance = deriveWorkflowGuidance(
      workflow({
        planningStatus: "approved",
        codexRationale: [
          {
            rationaleId: "rat_approval",
            createdAt: "2026-05-13T10:03:00.000Z",
            category: "product-behavior",
            summary:
              "User decision recorded: approve. Ship this. Practical effect: Users get the workflow.",
            relatedSliceIds: ["slice_core"]
          }
        ],
        slices: [slice({ state: "ready", riskLevel: "low" })]
      })
    );

    expect(guidance.phase).toBe("executing");
    expect(guidance.delegation.map((item) => item.workType)).toEqual([
      "implementation",
      "junior-implementation"
    ]);
    expect(guidance.delegation[0]?.providerPreferences).toEqual(
      expect.arrayContaining(["claude-code-cli:sonnet", "codex-cli"])
    );
    expect(guidance.delegation[1]?.providerPreferences).toContain(
      "ollama-claude-code:glm-5.2"
    );
  });

  it("includes review and test-hardening delegation guidance during review", () => {
    const guidance = deriveWorkflowGuidance(
      workflow({
        planningStatus: "approved",
        slices: [slice({ state: "awaiting-review" })]
      })
    );

    expect(guidance.phase).toBe("reviewing");
    expect(guidance.delegation.map((item) => item.workType)).toEqual([
      "high-complexity-review",
      "test-hardening"
    ]);
    expect(guidance.delegation[0]?.evidenceRequirements).toContain(
      "Codex final sign-off"
    );
  });

  it("requires user plan approval after planning consensus signs off", () => {
    const guidance = deriveWorkflowGuidance(
      workflow({
        planningStatus: "approved",
        slices: [slice({ state: "ready" })],
        consensusRounds: [
          {
            round: 1,
            phase: "planning",
            startedAt: "2026-05-13T10:01:00.000Z",
            completedAt: "2026-05-13T10:02:00.000Z",
            consensus: "approved",
            verdicts: [{ reviewerRole: "architect", status: "approve", summary: "Sound." }]
          }
        ]
      })
    );

    expect(guidance.phase).toBe("awaiting_user_plan_approval");
    expect(guidance.hooks.map((hook) => hook.kind)).toContain(
      "request_user_plan_approval"
    );
    expect(guidance.hooks.every((hook) => hook.mutatesSource === false)).toBe(true);
    expect(guidance.hooks.every((hook) => hook.startsProvider === false)).toBe(true);
  });

  it("filters technical escalations out of user-facing decisions", () => {
    const guidance = deriveWorkflowGuidance(
      workflow({
        userEscalations: [
          {
            escalationId: "esc_user",
            createdAt: "2026-05-13T10:01:00.000Z",
            status: "open",
            question: "Should this release default to private beta?",
            productImpact: "Users may see the feature before support docs are complete.",
            options: ["Private beta", "Production"]
          }
        ],
        codexRationale: [
          {
            rationaleId: "rat_technical",
            createdAt: "2026-05-13T10:01:00.000Z",
            category: "technical",
            summary: "Codex should choose the module split.",
            relatedSliceIds: ["slice_core"]
          }
        ]
      })
    );

    expect(guidance.phase).toBe("escalated");
    expect(guidance.userEscalations).toEqual([
      {
        escalationId: "esc_user",
        category: "release",
        question: "Should this release default to private beta?",
        practicalEffect: "Users may see the feature before support docs are complete.",
        options: ["Private beta", "Production"]
      }
    ]);
    expect(JSON.stringify(guidance)).not.toMatch(
      /systemPrompt|rawProvider|providerPayload|apiKey|commandArgs|best model|provider superiority|benchmark winner/i
    );
  });

  it("does not claim completion until integrated slices have passing final gate evidence", () => {
    const guidance = deriveWorkflowGuidance(
      workflow({
        planningStatus: "approved",
        slices: [
          slice({
            state: "integrated",
            integrationEvidence: [
              {
                integratedAt: "2026-05-13T12:00:00.000Z",
                integrationMethod: "manual-patch",
                summary: "Integrated by Codex.",
                changedFiles: ["src/core/index.ts"],
                verification: [
                  {
                    command: "npm test -- tests/core/workflow-guidance.test.ts",
                    status: "failed",
                    summary: "Regression still failing."
                  }
                ],
                cleanupRecommendation: "retain-for-review"
              }
            ]
          })
        ]
      })
    );

    expect(guidance.phase).toBe("validating");
    expect(guidance.hooks.map((hook) => hook.kind)).toContain("run_verification");
    expect(guidance.hooks.map((hook) => hook.kind)).not.toContain("report_completion");
  });

  it("reports completion only after every slice is integrated and verified", () => {
    const guidance = deriveWorkflowGuidance(
      workflow({
        planningStatus: "approved",
        slices: [
          slice({
            state: "integrated",
            integrationEvidence: [
              {
                integratedAt: "2026-05-13T12:00:00.000Z",
                integrationMethod: "manual-patch",
                summary: "Integrated by Codex.",
                changedFiles: ["src/core/index.ts"],
                verification: [
                  {
                    command: "npm run ci",
                    status: "passed",
                    summary: "Full gate passed."
                  }
                ],
                cleanupRecommendation: "eligible-after-evidence-saved"
              }
            ]
          })
        ]
      })
    );

    expect(guidance.phase).toBe("completed");
    expect(guidance.hooks.map((hook) => hook.kind)).toEqual(["report_completion"]);
  });
});
