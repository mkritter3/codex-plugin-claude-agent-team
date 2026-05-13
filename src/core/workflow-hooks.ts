import type { WorkflowGuidance, WorkflowGuidanceHook } from "./workflow-guidance.js";

const PRIORITY_RANK: Record<WorkflowGuidanceHook["priority"], number> = {
  required: 0,
  recommended: 1,
  optional: 2
};

const KIND_RANK: Record<WorkflowGuidanceHook["kind"], number> = {
  brainstorm_with_user: 0,
  write_plan: 1,
  request_user_plan_approval: 2,
  start_ready_slices: 3,
  record_mailbox_update: 4,
  review_slice: 5,
  queue_integration: 6,
  record_integration: 7,
  run_verification: 8,
  report_completion: 9,
  cleanup_evidence: 10,
  escalate_user_decision: 11
};

export interface PlannedWorkflowHooks {
  readonly workflowId: string;
  readonly hooks: readonly WorkflowGuidanceHook[];
  readonly mutatesSource: false;
  readonly startsProvider: false;
  readonly canReportCompletion: boolean;
}

export function planWorkflowHooks(guidance: WorkflowGuidance): PlannedWorkflowHooks {
  const hooks = [...guidance.hooks].sort((left, right) => {
    const priority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    if (priority !== 0) {
      return priority;
    }
    return KIND_RANK[left.kind] - KIND_RANK[right.kind];
  });

  return {
    workflowId: guidance.workflowId,
    hooks,
    mutatesSource: false,
    startsProvider: false,
    canReportCompletion: guidance.phase === "completed"
  };
}
