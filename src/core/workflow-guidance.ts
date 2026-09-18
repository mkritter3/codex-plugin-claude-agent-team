import type {
  CodexRationaleCategory,
  WorkflowRecord,
  WorkflowSlice
} from "./workflow-types.js";
import {
  recommendDelegationForWorkflowPhase,
  type DelegationRecommendation
} from "./delegation-playbook.js";

export const WORKFLOW_GUIDANCE_PHASES = [
  "brainstorming",
  "planning",
  "awaiting_user_plan_approval",
  "approved",
  "executing",
  "reviewing",
  "awaiting_integration",
  "integrating",
  "validating",
  "cleanup_ready",
  "completed",
  "escalated",
  "blocked"
] as const;

export type WorkflowGuidancePhase = (typeof WORKFLOW_GUIDANCE_PHASES)[number];

export const WORKFLOW_HOOK_KINDS = [
  "brainstorm_with_user",
  "write_plan",
  "request_user_plan_approval",
  "start_ready_slices",
  "record_mailbox_update",
  "review_slice",
  "queue_integration",
  "record_integration",
  "run_verification",
  "report_completion",
  "cleanup_evidence",
  "escalate_user_decision"
] as const;

export type WorkflowHookKind = (typeof WORKFLOW_HOOK_KINDS)[number];

export type WorkflowGuidanceHook = {
  readonly hookId: string;
  readonly kind: WorkflowHookKind;
  readonly priority: "required" | "recommended" | "optional";
  readonly reason: string;
  readonly mutatesSource: false;
  readonly startsProvider: false;
  readonly safeToolName?: string;
  readonly safeInputSummary: Record<string, unknown>;
};

export type WorkflowGuidanceUserEscalation = {
  readonly escalationId: string;
  readonly category: "product" | "trust" | "cost" | "release" | "permission" | "user_impact";
  readonly question: string;
  readonly practicalEffect: string;
  readonly options: readonly string[];
};

export type WorkflowGuidance = {
  readonly orchestration?: WorkflowRecord["orchestration"];
  readonly workflowId: string;
  readonly phase: WorkflowGuidancePhase;
  readonly hooks: readonly WorkflowGuidanceHook[];
  readonly delegation: readonly DelegationRecommendation[];
  readonly userEscalations: readonly WorkflowGuidanceUserEscalation[];
  readonly blockedReasons: readonly {
    readonly code: string;
    readonly message: string;
    readonly evidenceRef?: string;
  }[];
  readonly seniorReview: {
    readonly opusPlanning: "not_requested" | "requested" | "signed_off" | "degraded_unavailable" | "blocking";
    readonly opusImplementation: "not_requested" | "requested" | "signed_off" | "degraded_unavailable" | "blocking";
  };
};

const USER_DECISION_PREFIX = "User decision recorded:";

export function deriveWorkflowGuidance(record: WorkflowRecord): WorkflowGuidance {
  const phase = deriveWorkflowGuidancePhase(record);
  return {
    workflowId: record.workflowId,
    phase,
    hooks: record.orchestration === undefined ? hooksForPhase(record, phase) : orchestrationHooks(record, phase),
    delegation: record.orchestration === undefined ? recommendDelegationForWorkflowPhase(phase) : [],
    ...(record.orchestration === undefined ? {} : { orchestration: record.orchestration }),
    userEscalations: userEscalationsForGuidance(record),
    blockedReasons: blockedReasonsForGuidance(record),
    seniorReview: seniorReviewForGuidance(record)
  };
}

export function hasUserPlanApproval(record: WorkflowRecord): boolean {
  return (record.codexRationale ?? []).some(
    (rationale) =>
      rationale.category === "product-behavior" &&
      rationale.summary.startsWith(`${USER_DECISION_PREFIX} approve`)
  );
}

export function userDecisionSummary(input: {
  readonly decision: string;
  readonly summary: string;
  readonly practicalEffect: string;
  readonly selectedOption?: string;
}): string {
  const selected =
    input.selectedOption === undefined ? "" : ` Selected option: ${input.selectedOption}.`;
  return `${USER_DECISION_PREFIX} ${input.decision}. ${input.summary} Practical effect: ${input.practicalEffect}.${selected}`;
}

export function userDecisionCategoryToRationaleCategory(
  category: WorkflowGuidanceUserEscalation["category"]
): CodexRationaleCategory {
  switch (category) {
    case "trust":
    case "permission":
      return "user-trust";
    case "cost":
      return "provider-cost";
    case "release":
      return "release-posture";
    case "product":
    case "user_impact":
      return "product-behavior";
  }
}

function deriveWorkflowGuidancePhase(record: WorkflowRecord): WorkflowGuidancePhase {
  if (record.orchestration !== undefined) {
    if (record.planningStatus === "escalated" || record.consensusRounds.at(-1)?.consensus === "escalated") return "escalated";
    if (record.planningStatus !== "approved") return "planning";
  }
  if (record.userEscalations.some((escalation) => escalation.status === "open")) {
    return "escalated";
  }
  if (
    record.slices.some((slice) =>
      ["blocked", "failed", "cancelled", "needs-revision"].includes(slice.state)
    )
  ) {
    return "blocked";
  }
  if (record.slices.length === 0 && record.planningStatus === "draft") {
    return "brainstorming";
  }
  if (
    record.orchestration === undefined && record.planningStatus === "approved" &&
    record.consensusRounds.some((round) => round.phase === "planning" && round.consensus === "approved") &&
    !hasUserPlanApproval(record)
  ) {
    return "awaiting_user_plan_approval";
  }
  if (record.slices.length > 0 && record.slices.every(isCompletedSlice)) {
    return "completed";
  }
  if (record.slices.some((slice) => slice.state === "integrated")) {
    return "validating";
  }
  if (record.integrationQueue.some((item) => item.state === "integrating")) {
    return "integrating";
  }
  if (
    record.integrationQueue.some((item) => item.state === "queued" || item.state === "awaiting-review") ||
    record.slices.some((slice) => slice.state === "approved")
  ) {
    return "awaiting_integration";
  }
  if (record.slices.some((slice) => slice.state === "awaiting-review")) {
    return "reviewing";
  }
  if (record.slices.some((slice) => slice.state === "running" || slice.state === "ready")) {
    return "executing";
  }
  if (record.planningStatus === "approved" || record.slices.some((slice) => slice.state === "planned")) {
    return "approved";
  }
  if (record.consensusRounds.length > 0 || record.planningStatus === "in-consensus") {
    return "planning";
  }
  return "brainstorming";
}

function isCompletedSlice(slice: WorkflowSlice): boolean {
  if (slice.state !== "integrated") {
    return false;
  }
  return (
    slice.integrationEvidence?.some((evidence) =>
      evidence.verification.some((verification) => verification.status === "passed")
    ) ?? false
  );
}

function hooksForPhase(
  record: WorkflowRecord,
  phase: WorkflowGuidancePhase
): readonly WorkflowGuidanceHook[] {
  switch (phase) {
    case "brainstorming":
      return [
        hook(
          "brainstorm_with_user",
          "required",
          "Capture product goal, non-goals, success criteria, and practical user effects before creating a workflow.",
          "agent_team_create_workflow",
          { workflowId: record.workflowId }
        )
      ];
    case "planning":
      return [
        hook(
          "write_plan",
          "required",
          "Run planning consensus until Codex and required senior review have enough evidence.",
          "agent_team_plan_consensus",
          { workflowId: record.workflowId }
        )
      ];
    case "awaiting_user_plan_approval":
      return [
        hook(
          "request_user_plan_approval",
          "required",
          "User approval is required before implementation slices start.",
          "agent_team_record_user_decision",
          { workflowId: record.workflowId, category: "product" }
        )
      ];
    case "approved":
    case "executing":
      return [
        hook(
          "start_ready_slices",
          "recommended",
          "Start ready independent slices with bounded concurrency.",
          "agent_team_start_slices",
          { workflowId: record.workflowId }
        )
      ];
    case "reviewing":
      return [
        hook(
          "review_slice",
          "required",
          "Review implementation evidence before integration.",
          "agent_team_review_slice",
          { workflowId: record.workflowId }
        )
      ];
    case "awaiting_integration":
      return [
        hook(
          "queue_integration",
          "required",
          "Compute a read-only integration queue before Codex integrates a slice.",
          "agent_team_integration_queue",
          { workflowId: record.workflowId }
        )
      ];
    case "integrating":
      return [
        hook(
          "record_integration",
          "required",
          "Record Codex-owned integration evidence after a manual integration step.",
          "agent_team_record_integration",
          { workflowId: record.workflowId }
        )
      ];
    case "validating":
      return [
        hook(
          "run_verification",
          "required",
          "Run focused tests, typecheck, full tests, build, packaged smoke, invariant scans, and npm run ci before completion.",
          undefined,
          { workflowId: record.workflowId }
        )
      ];
    case "cleanup_ready":
      return [
        hook(
          "cleanup_evidence",
          "recommended",
          "Clean up retained temporary worktrees only after evidence and integration records are saved.",
          "agent_team_cleanup",
          { workflowId: record.workflowId }
        )
      ];
    case "completed":
      return [
        hook(
          "report_completion",
          "optional",
          "Report verified completion without inventing new work.",
          "agent_team_workflow_report",
          { workflowId: record.workflowId }
        )
      ];
    case "escalated":
      return [
        hook(
          "escalate_user_decision",
          "required",
          "Ask the user only for the practical product, trust, cost, release, permission, or user-impact decision.",
          "agent_team_record_user_decision",
          { workflowId: record.workflowId }
        )
      ];
    case "blocked":
      return [
        hook(
          "record_mailbox_update",
          "recommended",
          "Record blocker evidence, unblock dependencies, or create a follow-up slice.",
          "agent_team_unblock_slice",
          { workflowId: record.workflowId }
        )
      ];
  }
}

function orchestrationHooks(record: WorkflowRecord, phase: WorkflowGuidancePhase): readonly WorkflowGuidanceHook[] {
  const assignmentPhase = phase === "planning" ? "planning" : phase === "reviewing" ? "review" : phase === "approved" || phase === "executing" ? "implementation" : undefined;
  if (assignmentPhase === undefined) return hooksForPhase(record, phase);
  const slice = record.slices.find(item => assignmentPhase === "review" ? item.state === "awaiting-review" : ["planned", "ready", "needs-revision"].includes(item.state));
  return [hook(assignmentPhase === "planning" ? "write_plan" : assignmentPhase === "review" ? "review_slice" : "start_ready_slices", "required",
    "Use the selected native/provider assignments. Reuse matching active planning; only the selected authority can approve the same artifact.",
    "agent_team_prepare_assignments", { workflowId: record.workflowId, phase: assignmentPhase, ...(assignmentPhase !== "planning" && slice ? { sliceId: slice.sliceId } : {}) })];
}

function hook(
  kind: WorkflowHookKind,
  priority: WorkflowGuidanceHook["priority"],
  reason: string,
  safeToolName?: string,
  safeInputSummary: Record<string, unknown> = {}
): WorkflowGuidanceHook {
  return {
    hookId: `hook_${kind}`,
    kind,
    priority,
    reason,
    mutatesSource: false,
    startsProvider: false,
    ...(safeToolName === undefined ? {} : { safeToolName }),
    safeInputSummary
  };
}

function userEscalationsForGuidance(
  record: WorkflowRecord
): readonly WorkflowGuidanceUserEscalation[] {
  return record.userEscalations
    .filter((escalation) => escalation.status === "open")
    .map((escalation) => ({
      escalationId: escalation.escalationId,
      category: escalationCategory(`${escalation.question} ${escalation.productImpact}`),
      question: escalation.question,
      practicalEffect: escalation.productImpact,
      options: escalation.options
    }));
}

function escalationCategory(
  productImpact: string
): WorkflowGuidanceUserEscalation["category"] {
  const normalized = productImpact.toLowerCase();
  if (normalized.includes("cost") || normalized.includes("provider")) return "cost";
  if (normalized.includes("trust") || normalized.includes("privacy")) return "trust";
  if (normalized.includes("permission") || normalized.includes("security")) {
    return "permission";
  }
  if (normalized.includes("release") || normalized.includes("beta")) return "release";
  if (normalized.includes("user")) return "user_impact";
  return "product";
}

function blockedReasonsForGuidance(record: WorkflowRecord): WorkflowGuidance["blockedReasons"] {
  return record.slices
    .filter((slice) =>
      ["blocked", "failed", "cancelled", "needs-revision"].includes(slice.state)
    )
    .map((slice) => ({
      code: `slice_${slice.state.replace("-", "_")}`,
      message: `${slice.sliceId} is ${slice.state}`,
      evidenceRef: slice.sliceId
    }));
}

function seniorReviewForGuidance(record: WorkflowRecord): WorkflowGuidance["seniorReview"] {
  if (record.orchestration !== undefined) return { opusPlanning: "not_requested", opusImplementation: "not_requested" };
  return {
    opusPlanning: seniorReviewPhaseStatus(record, "planning"),
    opusImplementation: seniorReviewPhaseStatus(record, "implementation")
  };
}

function seniorReviewPhaseStatus(
  record: WorkflowRecord,
  phase: "planning" | "implementation"
): WorkflowGuidance["seniorReview"]["opusPlanning"] {
  const evidence = record.opusReviewEvidence.find((item) => item.phase === phase);
  if (evidence?.status === "available") return "signed_off";
  if (evidence?.status === "unavailable") return "degraded_unavailable";
  const mode =
    phase === "planning"
      ? record.seniorReview.opusPlanning.mode
      : record.seniorReview.opusImplementation.mode;
  if (mode === "required-blocking") return "blocking";
  if (mode === "required-when-available" || mode === "optional") return "not_requested";
  return "not_requested";
}
