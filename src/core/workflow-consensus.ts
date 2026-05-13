import { listRoles } from "./roles.js";
import { isSafeRunId, isSafeWorkflowId } from "./state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "./state/workflow-store.js";
import {
  appendCodexRationale,
  classifyUserEscalation
} from "./workflow-planning-state.js";
import type {
  CodexRationaleCategory,
  WorkflowConsensusRound,
  WorkflowConsensusStatus,
  WorkflowOpusReviewEvidence,
  WorkflowOpusReviewStatus,
  WorkflowPlanningStatus,
  WorkflowRecord,
  WorkflowReviewerVerdict,
  WorkflowUserEscalation,
  WorkflowVerdictStatus
} from "./workflow-types.js";
import { toWorkflowView, type WorkflowView } from "./workflow-view.js";

export type PlanConsensusRoundMode = "default" | "extended";
export type CodexConsensusDecisionStatus = "approve" | "revise" | "block";

export interface PlanConsensusVerdictInput {
  readonly reviewerRole: string;
  readonly reviewerProvider?: string;
  readonly status: string;
  readonly summary: string;
  readonly evidenceRunId?: string;
}

export interface CodexConsensusDecisionInput {
  readonly status: CodexConsensusDecisionStatus;
  readonly category: CodexRationaleCategory;
  readonly summary: string;
  readonly relatedSliceIds?: readonly string[];
}

export interface SeniorReviewerEvidenceInput {
  readonly status: WorkflowOpusReviewStatus;
  readonly provider?: string;
  readonly runId?: string;
  readonly summary: string;
}

export interface PlanConsensusUserEscalationInput {
  readonly category: CodexRationaleCategory;
  readonly question: string;
  readonly productImpact: string;
  readonly options: readonly string[];
}

export interface PlanConsensusInput {
  readonly workspaceRoot: string;
  readonly workflowId: string;
  readonly roundMode?: PlanConsensusRoundMode;
  readonly codexDecision: CodexConsensusDecisionInput;
  readonly verdicts: readonly PlanConsensusVerdictInput[];
  readonly seniorReviewerEvidence?: SeniorReviewerEvidenceInput;
  readonly userEscalations?: readonly PlanConsensusUserEscalationInput[];
  readonly now?: () => Date;
}

const ROLE_IDS = new Set<string>(listRoles().map((role) => role.id));
const VERDICT_STATUSES = new Set<string>(["approve", "revise", "block", "abstain"]);
const DECISION_STATUSES = new Set<string>(["approve", "revise", "block"]);
const SENIOR_REVIEW_STATUSES = new Set<string>(["available", "unavailable", "skipped"]);
const RATIONALE_CATEGORIES = new Set<string>([
  "technical",
  "product-behavior",
  "user-trust",
  "security-risk",
  "provider-cost",
  "release-posture"
]);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: readonly string[] | undefined, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must contain at least one item`);
  }
  return value.map((item, index) => requireNonEmptyString(item, `${field}[${index}]`));
}

function validateCategory(value: CodexRationaleCategory, field: string): CodexRationaleCategory {
  if (!RATIONALE_CATEGORIES.has(value)) {
    throw new Error(`${field} must be a supported decision category`);
  }
  return value;
}

function nextPlanningRound(record: WorkflowRecord): number {
  const planningRounds = record.consensusRounds.filter((round) => round.phase === "planning");
  if (planningRounds.length === 0) {
    return 1;
  }
  const maxRound = Math.max(...planningRounds.map((round) => round.round));
  return maxRound + 1;
}

function validateRoundMode(round: number, roundMode: PlanConsensusRoundMode | undefined): void {
  if (round > 15) {
    throw new Error("planning consensus cannot exceed 15 rounds");
  }
  if (round > 10 && roundMode !== "extended") {
    throw new Error(`round ${round} requires extended consensus mode`);
  }
}

function normalizeVerdicts(verdicts: readonly PlanConsensusVerdictInput[]): readonly WorkflowReviewerVerdict[] {
  if (!Array.isArray(verdicts) || verdicts.length === 0) {
    throw new Error("verdicts must contain at least one item");
  }
  return verdicts.map((verdict, index) => {
    if (typeof verdict !== "object" || verdict === null) {
      throw new Error(`verdicts[${index}] must be an object`);
    }
    const reviewerRole = requireNonEmptyString(verdict.reviewerRole, `verdicts[${index}].reviewerRole`);
    if (!ROLE_IDS.has(reviewerRole)) {
      throw new Error(`Invalid reviewer role: ${reviewerRole}`);
    }
    if (!VERDICT_STATUSES.has(verdict.status)) {
      throw new Error(`verdicts[${index}].status must be approve, revise, block, or abstain`);
    }
    const evidenceRunId =
      verdict.evidenceRunId === undefined
        ? undefined
        : requireNonEmptyString(verdict.evidenceRunId, `verdicts[${index}].evidenceRunId`);
    if (evidenceRunId !== undefined && !isSafeRunId(evidenceRunId)) {
      throw new Error(`Invalid evidence run id: ${evidenceRunId}`);
    }
    return {
      reviewerRole,
      ...(verdict.reviewerProvider === undefined
        ? {}
        : { reviewerProvider: requireNonEmptyString(verdict.reviewerProvider, `verdicts[${index}].reviewerProvider`) }),
      status: verdict.status as WorkflowVerdictStatus,
      summary: requireNonEmptyString(verdict.summary, `verdicts[${index}].summary`),
      ...(evidenceRunId === undefined ? {} : { evidenceRunId })
    };
  });
}

function normalizeCodexDecision(decision: CodexConsensusDecisionInput): CodexConsensusDecisionInput {
  if (!DECISION_STATUSES.has(decision.status)) {
    throw new Error("codexDecision.status must be approve, revise, or block");
  }
  return {
    status: decision.status,
    category: validateCategory(decision.category, "codexDecision.category"),
    summary: requireNonEmptyString(decision.summary, "codexDecision.summary"),
    ...(decision.relatedSliceIds === undefined
      ? {}
      : { relatedSliceIds: requireStringArray(decision.relatedSliceIds, "codexDecision.relatedSliceIds") })
  };
}

function normalizeSeniorEvidence(
  evidence: SeniorReviewerEvidenceInput | undefined,
  record: WorkflowRecord,
  checkedAt: string
): WorkflowOpusReviewEvidence | undefined {
  if (evidence === undefined) {
    return undefined;
  }
  if (!SENIOR_REVIEW_STATUSES.has(evidence.status)) {
    throw new Error("seniorReviewerEvidence.status must be available, unavailable, or skipped");
  }
  const runId =
    evidence.runId === undefined
      ? undefined
      : requireNonEmptyString(evidence.runId, "seniorReviewerEvidence.runId");
  if (runId !== undefined && !isSafeRunId(runId)) {
    throw new Error(`Invalid senior reviewer run id: ${runId}`);
  }
  return {
    phase: "planning",
    status: evidence.status,
    requiredMode: record.seniorReview.opusPlanning.mode,
    checkedAt,
    ...(runId === undefined ? {} : { runId }),
    ...(evidence.provider === undefined
      ? {}
      : { provider: requireNonEmptyString(evidence.provider, "seniorReviewerEvidence.provider") }),
    summary: requireNonEmptyString(evidence.summary, "seniorReviewerEvidence.summary")
  };
}

function normalizeUserEscalations(
  input: readonly PlanConsensusUserEscalationInput[] | undefined,
  workflowId: string,
  round: number,
  createdAt: string
): readonly WorkflowUserEscalation[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("userEscalations must be an array");
  }
  return input.map((escalation, index) => {
    const category = validateCategory(escalation.category, `userEscalations[${index}].category`);
    if (!classifyUserEscalation(category).shouldEscalateToUser) {
      throw new Error(`user escalation category ${category} is Codex-owned`);
    }
    return {
      escalationId: `${workflowId}_round_${round}_escalation_${index + 1}`,
      createdAt,
      status: "open",
      question: requireNonEmptyString(escalation.question, `userEscalations[${index}].question`),
      productImpact: requireNonEmptyString(
        escalation.productImpact,
        `userEscalations[${index}].productImpact`
      ),
      options: requireStringArray(escalation.options, `userEscalations[${index}].options`)
    };
  });
}

function automaticRound15Escalation(
  workflowId: string,
  round: number,
  createdAt: string,
  decision: CodexConsensusDecisionInput
): WorkflowUserEscalation | undefined {
  if (round !== 15) {
    return undefined;
  }
  if (!classifyUserEscalation(decision.category).shouldEscalateToUser) {
    return undefined;
  }
  return {
    escalationId: `${workflowId}_round_15_unresolved`,
    createdAt,
    status: "open",
    question: "Resolve the remaining planning disagreement.",
    productImpact: decision.summary,
    options: ["continue with Codex decision", "pause until senior review resolves"]
  };
}

function evaluateConsensus(input: {
  readonly round: number;
  readonly decision: CodexConsensusDecisionInput;
  readonly verdicts: readonly WorkflowReviewerVerdict[];
  readonly seniorEvidence?: WorkflowOpusReviewEvidence;
  readonly explicitEscalations: readonly WorkflowUserEscalation[];
}): WorkflowConsensusStatus {
  const hasBlocker = input.verdicts.some((verdict) => verdict.status === "block");
  const hasRevision = input.verdicts.some((verdict) => verdict.status === "revise");
  const seniorMode = input.seniorEvidence?.requiredMode;
  const seniorUnavailableBlocking =
    seniorMode === "required-blocking" && input.seniorEvidence?.status !== "available";

  if (input.round === 15 && (hasBlocker || hasRevision || input.decision.status !== "approve")) {
    return "escalated";
  }
  if (seniorUnavailableBlocking || hasBlocker || input.decision.status === "block") {
    return "blocked";
  }
  if (input.decision.status === "approve" && (!hasRevision || input.round >= 10)) {
    return "approved";
  }
  if (input.explicitEscalations.length > 0) {
    return "escalated";
  }
  return "needs-revision";
}

function planningStatusFor(consensus: WorkflowConsensusStatus): WorkflowPlanningStatus {
  if (consensus === "approved") {
    return "approved";
  }
  if (consensus === "escalated") {
    return "escalated";
  }
  return "in-consensus";
}

export async function planConsensus(input: PlanConsensusInput): Promise<{
  readonly workflow: WorkflowView;
}> {
  if (!isSafeWorkflowId(input.workflowId)) {
    throw new Error(`Invalid workflow id: ${input.workflowId}`);
  }
  if (input.roundMode !== undefined && input.roundMode !== "default" && input.roundMode !== "extended") {
    throw new Error("roundMode must be default or extended");
  }

  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  const timestamp = (input.now?.() ?? new Date()).toISOString();
  const round = nextPlanningRound(record);
  validateRoundMode(round, input.roundMode);

  const verdicts = normalizeVerdicts(input.verdicts);
  const decision = normalizeCodexDecision(input.codexDecision);
  const seniorEvidence = normalizeSeniorEvidence(input.seniorReviewerEvidence, record, timestamp);
  const explicitEscalations = normalizeUserEscalations(
    input.userEscalations,
    record.workflowId,
    round,
    timestamp
  );
  const automaticEscalation =
    explicitEscalations.length === 0
      ? automaticRound15Escalation(record.workflowId, round, timestamp, decision)
      : undefined;
  const userEscalations =
    automaticEscalation === undefined
      ? explicitEscalations
      : [...explicitEscalations, automaticEscalation];

  const consensus = evaluateConsensus({
    round,
    decision,
    verdicts,
    ...(seniorEvidence === undefined ? {} : { seniorEvidence }),
    explicitEscalations: userEscalations
  });
  const consensusRound: WorkflowConsensusRound = {
    round,
    phase: "planning",
    startedAt: timestamp,
    completedAt: timestamp,
    verdicts,
    consensus
  };
  const rationaleRecord = {
    rationaleId: `${record.workflowId}_round_${round}_codex_decision`,
    createdAt: timestamp,
    category: decision.category,
    summary: decision.summary,
    relatedSliceIds: decision.relatedSliceIds ?? []
  };
  const rationalized = appendCodexRationale(record, rationaleRecord);
  const updated: WorkflowRecord = {
    ...rationalized,
    updatedAt: timestamp,
    planningStatus: planningStatusFor(consensus),
    consensusRounds: [...record.consensusRounds, consensusRound],
    userEscalations: [...record.userEscalations, ...userEscalations],
    opusReviewEvidence:
      seniorEvidence === undefined
        ? record.opusReviewEvidence
        : [...record.opusReviewEvidence, seniorEvidence]
  };

  await writeWorkflowRecord(input.workspaceRoot, updated);
  return { workflow: toWorkflowView(updated) };
}
