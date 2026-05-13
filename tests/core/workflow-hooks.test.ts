import { describe, expect, it } from "vitest";
import { planWorkflowHooks } from "../../src/core/workflow-hooks.js";
import type { WorkflowGuidance } from "../../src/core/workflow-guidance.js";

function guidance(overrides: Partial<WorkflowGuidance> = {}): WorkflowGuidance {
  return {
    workflowId: "workflow_hooks",
    phase: "awaiting_user_plan_approval",
    hooks: [],
    delegation: [],
    userEscalations: [],
    blockedReasons: [],
    seniorReview: {
      opusPlanning: "not_requested",
      opusImplementation: "not_requested"
    },
    ...overrides
  };
}

describe("planWorkflowHooks", () => {
  it("orders required user approval before slice starts", () => {
    const planned = planWorkflowHooks(
      guidance({
        hooks: [
          {
            hookId: "hook_start",
            kind: "start_ready_slices",
            priority: "recommended",
            reason: "Start ready slices.",
            mutatesSource: false,
            startsProvider: false,
            safeToolName: "agent_team_start_slices",
            safeInputSummary: { workflowId: "workflow_hooks" }
          },
          {
            hookId: "hook_approval",
            kind: "request_user_plan_approval",
            priority: "required",
            reason: "Plan approval required.",
            mutatesSource: false,
            startsProvider: false,
            safeToolName: "agent_team_record_user_decision",
            safeInputSummary: { workflowId: "workflow_hooks" }
          }
        ]
      })
    );

    expect(planned.hooks.map((hook) => hook.kind)).toEqual([
      "request_user_plan_approval",
      "start_ready_slices"
    ]);
    expect(planned.mutatesSource).toBe(false);
    expect(planned.startsProvider).toBe(false);
    expect(planned.canReportCompletion).toBe(false);
  });

  it("allows completion reporting only for completed workflow guidance", () => {
    const planned = planWorkflowHooks(
      guidance({
        phase: "completed",
        hooks: [
          {
            hookId: "hook_report",
            kind: "report_completion",
            priority: "optional",
            reason: "Report complete workflow.",
            mutatesSource: false,
            startsProvider: false,
            safeToolName: "agent_team_workflow_report",
            safeInputSummary: { workflowId: "workflow_hooks" }
          }
        ]
      })
    );

    expect(planned.canReportCompletion).toBe(true);
    expect(planned.hooks[0]?.kind).toBe("report_completion");
  });
});
