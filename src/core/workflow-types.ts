export const SENIOR_REVIEW_MODES = [
  "disabled",
  "optional",
  "required-when-available",
  "required-blocking"
] as const;

export type SeniorReviewMode = (typeof SENIOR_REVIEW_MODES)[number];

export interface SeniorReviewModeConfig {
  readonly mode: SeniorReviewMode;
}

export interface SeniorReviewPolicyConfig {
  readonly opusPlanning: SeniorReviewModeConfig;
  readonly opusImplementation: SeniorReviewModeConfig;
}

export const DEFAULT_SENIOR_REVIEW_POLICY: SeniorReviewPolicyConfig = {
  opusPlanning: { mode: "required-when-available" },
  opusImplementation: { mode: "required-when-available" }
};

export const WORKFLOW_SLICE_STATES = [
  "planned",
  "blocked",
  "ready",
  "running",
  "awaiting-review",
  "needs-revision",
  "approved",
  "integrated",
  "failed",
  "cancelled"
] as const;

export type WorkflowSliceState = (typeof WORKFLOW_SLICE_STATES)[number];

export const WORKFLOW_CONSENSUS_PHASES = [
  "planning",
  "implementation",
  "review"
] as const;

export type WorkflowConsensusPhase = (typeof WORKFLOW_CONSENSUS_PHASES)[number];

export const WORKFLOW_VERDICT_STATUSES = [
  "approve",
  "revise",
  "block",
  "abstain"
] as const;

export type WorkflowVerdictStatus = (typeof WORKFLOW_VERDICT_STATUSES)[number];

export const WORKFLOW_CONSENSUS_STATUSES = [
  "approved",
  "needs-revision",
  "blocked",
  "escalated"
] as const;

export type WorkflowConsensusStatus = (typeof WORKFLOW_CONSENSUS_STATUSES)[number];

export const WORKFLOW_ESCALATION_STATUSES = ["open", "resolved"] as const;

export type WorkflowEscalationStatus = (typeof WORKFLOW_ESCALATION_STATUSES)[number];

export const WORKFLOW_OPUS_REVIEW_STATUSES = [
  "available",
  "unavailable",
  "skipped"
] as const;

export type WorkflowOpusReviewStatus = (typeof WORKFLOW_OPUS_REVIEW_STATUSES)[number];

export const WORKFLOW_INTEGRATION_STATES = [
  "queued",
  "awaiting-review",
  "integrating",
  "integrated",
  "failed",
  "cancelled"
] as const;

export type WorkflowIntegrationState = (typeof WORKFLOW_INTEGRATION_STATES)[number];

export interface WorkflowGoalPacket {
  readonly title: string;
  readonly successCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly nonGoals: readonly string[];
}

export interface WorkflowSlice {
  readonly sliceId: string;
  readonly title: string;
  readonly state: WorkflowSliceState;
  readonly ownerRole: string;
  readonly dependencies: readonly string[];
  readonly writeScope: readonly string[];
  readonly acceptanceTests: readonly string[];
  readonly blockedBy?: readonly string[];
}

export interface WorkflowReviewerVerdict {
  readonly reviewerRole: string;
  readonly reviewerProvider?: string;
  readonly status: WorkflowVerdictStatus;
  readonly summary: string;
  readonly evidenceRunId?: string;
}

export interface WorkflowConsensusRound {
  readonly round: number;
  readonly phase: WorkflowConsensusPhase;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly verdicts: readonly WorkflowReviewerVerdict[];
  readonly consensus: WorkflowConsensusStatus;
}

export interface WorkflowUserEscalation {
  readonly escalationId: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly status: WorkflowEscalationStatus;
  readonly question: string;
  readonly productImpact: string;
  readonly options: readonly string[];
}

export interface WorkflowOpusReviewEvidence {
  readonly phase: WorkflowConsensusPhase;
  readonly status: WorkflowOpusReviewStatus;
  readonly requiredMode: SeniorReviewMode;
  readonly checkedAt: string;
  readonly runId?: string;
  readonly provider?: string;
  readonly summary: string;
}

export interface WorkflowIntegrationQueueItem {
  readonly sliceId: string;
  readonly state: WorkflowIntegrationState;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly reviewRunIds: readonly string[];
}

export interface WorkflowRecord {
  readonly workflowId: string;
  readonly name?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly goal: WorkflowGoalPacket;
  readonly seniorReview: SeniorReviewPolicyConfig;
  readonly slices: readonly WorkflowSlice[];
  readonly consensusRounds: readonly WorkflowConsensusRound[];
  readonly userEscalations: readonly WorkflowUserEscalation[];
  readonly opusReviewEvidence: readonly WorkflowOpusReviewEvidence[];
  readonly integrationQueue: readonly WorkflowIntegrationQueueItem[];
  readonly evidencePath: string;
}
