export const WORKFLOW_VALIDATION_EVIDENCE_KINDS = [
  "workflow",
  "approval",
  "slice",
  "mailbox",
  "review",
  "integration",
  "verification",
  "cleanup",
  "degraded_provider",
  "scope_violation",
  "blocked_dependency",
  "public_sanitization",
  "senior_review",
  "bounded_concurrency",
  "steering_truth",
  "provider_auth",
  "test_execution"
] as const;

export type WorkflowValidationEvidenceKind =
  (typeof WORKFLOW_VALIDATION_EVIDENCE_KINDS)[number];

export type WorkflowValidationObservationStatus =
  | "passed"
  | "failed"
  | "degraded"
  | "blocked";

export interface WorkflowValidationObservation {
  readonly kind: WorkflowValidationEvidenceKind;
  readonly ref: string;
  readonly status?: WorkflowValidationObservationStatus;
  readonly detail?: string;
}

export interface WorkflowValidationScenario {
  readonly scenarioId: string;
  readonly requiredEvidence: readonly WorkflowValidationEvidenceKind[];
  readonly observations: readonly WorkflowValidationObservation[];
}

export interface WorkflowValidationResult {
  readonly scenarioId: string;
  readonly status: "passed" | "failed";
  readonly missingEvidence: readonly WorkflowValidationEvidenceKind[];
  readonly failedEvidence: readonly WorkflowValidationObservation[];
  readonly observations: readonly WorkflowValidationObservation[];
  readonly claimBoundary: "workflow_mechanics_only";
}

export interface WorkflowValidationSummary {
  readonly status: "passed" | "failed";
  readonly claimBoundary: "workflow_mechanics_only";
  readonly liveProviderCalls: 0;
  readonly counts: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
  };
  readonly failedScenarioIds: readonly string[];
}

export function evaluateWorkflowValidationScenario(
  scenario: WorkflowValidationScenario
): WorkflowValidationResult {
  const observedKinds = new Set(
    scenario.observations.map((observation) => observation.kind)
  );
  const missingEvidence = scenario.requiredEvidence.filter(
    (kind) => !observedKinds.has(kind)
  );
  const failedEvidence = scenario.observations.filter(
    (observation) =>
      observation.status === "failed" || observation.status === "blocked"
  );

  return {
    scenarioId: scenario.scenarioId,
    status:
      missingEvidence.length === 0 && failedEvidence.length === 0
        ? "passed"
        : "failed",
    missingEvidence,
    failedEvidence,
    observations: scenario.observations,
    claimBoundary: "workflow_mechanics_only"
  };
}

export function summarizeWorkflowValidationResults(
  results: readonly WorkflowValidationResult[]
): WorkflowValidationSummary {
  const failedScenarioIds = results
    .filter((result) => result.status === "failed")
    .map((result) => result.scenarioId);

  return {
    status: failedScenarioIds.length === 0 ? "passed" : "failed",
    claimBoundary: "workflow_mechanics_only",
    liveProviderCalls: 0,
    counts: {
      total: results.length,
      passed: results.length - failedScenarioIds.length,
      failed: failedScenarioIds.length
    },
    failedScenarioIds
  };
}
