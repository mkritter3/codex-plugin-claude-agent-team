import { describe, expect, it } from "vitest";
import {
  evaluateWorkflowValidationScenario,
  summarizeWorkflowValidationResults
} from "../../src/core/workflow-validation.js";

describe("evaluateWorkflowValidationScenario", () => {
  it("passes when all required evidence is present", () => {
    const result = evaluateWorkflowValidationScenario({
      scenarioId: "guided-happy-path",
      requiredEvidence: [
        "workflow",
        "approval",
        "slice",
        "review",
        "integration",
        "verification",
        "cleanup"
      ],
      observations: [
        { kind: "workflow", ref: "wf_1" },
        { kind: "approval", ref: "decision_1" },
        { kind: "slice", ref: "slice_1" },
        { kind: "review", ref: "review_1" },
        { kind: "integration", ref: "int_1" },
        { kind: "verification", ref: "ci_1" },
        { kind: "cleanup", ref: "cleanup_1" }
      ]
    });

    expect(result.status).toBe("passed");
    expect(result.missingEvidence).toEqual([]);
    expect(result.claimBoundary).toBe("workflow_mechanics_only");
  });

  it("fails closed when required review evidence is missing", () => {
    const result = evaluateWorkflowValidationScenario({
      scenarioId: "missing-review",
      requiredEvidence: ["workflow", "approval", "slice", "review"],
      observations: [
        { kind: "workflow", ref: "wf_1" },
        { kind: "approval", ref: "decision_1" },
        { kind: "slice", ref: "slice_1" }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.missingEvidence).toEqual(["review"]);
  });

  it("fails closed when an observed gate is explicitly failed or blocked", () => {
    const result = evaluateWorkflowValidationScenario({
      scenarioId: "failed-tests",
      requiredEvidence: ["workflow", "slice", "verification"],
      observations: [
        { kind: "workflow", ref: "wf_1" },
        { kind: "slice", ref: "slice_1" },
        { kind: "verification", ref: "npm_test", status: "failed" }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.failedEvidence).toEqual([
      { kind: "verification", ref: "npm_test", status: "failed" }
    ]);
  });

  it("does not emit comparative provider-superiority or model-intelligence claims", () => {
    const result = evaluateWorkflowValidationScenario({
      scenarioId: "provider-proof",
      requiredEvidence: ["workflow"],
      observations: [{ kind: "workflow", ref: "wf_1" }]
    });

    expect(JSON.stringify(result)).not.toMatch(
      /best model|provider superiority|model intelligence|provider ranking/i
    );
  });
});

describe("summarizeWorkflowValidationResults", () => {
  it("summarizes operational outcomes without live provider calls", () => {
    const summary = summarizeWorkflowValidationResults([
      evaluateWorkflowValidationScenario({
        scenarioId: "passed",
        requiredEvidence: ["workflow"],
        observations: [{ kind: "workflow", ref: "wf_1" }]
      }),
      evaluateWorkflowValidationScenario({
        scenarioId: "blocked",
        requiredEvidence: ["workflow", "review"],
        observations: [{ kind: "workflow", ref: "wf_2" }]
      })
    ]);

    expect(summary).toEqual({
      status: "failed",
      claimBoundary: "workflow_mechanics_only",
      liveProviderCalls: 0,
      counts: {
        total: 2,
        passed: 1,
        failed: 1
      },
      failedScenarioIds: ["blocked"]
    });
  });
});
