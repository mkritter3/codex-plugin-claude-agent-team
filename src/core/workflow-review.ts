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
  WorkflowRecord,
  WorkflowReviewerVerdict,
  WorkflowSlice,
  WorkflowSliceImplementationEvidence,
  WorkflowSliceReviewEvidence,
  WorkflowSliceState,
  WorkflowUserEscalation,
  WorkflowVerdictStatus
} from "./workflow-types.js";
import { toWorkflowView, type WorkflowView } from "./workflow-view.js";

export type ReviewConsensusRoundMode = "default" | "extended";
export type CodexReviewDecisionStatus = "approve" | "revise" | "block";

export interface ReviewVerdictInput {
  readonly reviewerRole: string;
  readonly reviewerProvider?: string;
  readonly status: string;
  readonly summary: string;
  readonly evidenceRunId?: string;
}

export interface CodexReviewDecisionInput {
  readonly status: CodexReviewDecisionStatus;
  readonly category: CodexRationaleCategory;
  readonly summary: string;
  readonly relatedSliceIds?: readonly string[];
}

export interface SliceImplementationEvidenceInput {
  readonly summary: string;
  readonly changedFiles: readonly string[];
  readonly testsRun: readonly string[];
  readonly evidencePaths: readonly string[];
  readonly sourceRunId?: string;
  readonly worktreePath?: string;
  readonly knownRisks?: readonly string[];
}

export interface ReviewSeniorReviewerEvidenceInput {
  readonly status: WorkflowOpusReviewStatus;
  readonly provider?: string;
  readonly runId?: string;
  readonly summary: string;
}

export interface ReviewUserEscalationInput {
  readonly category: CodexRationaleCategory;
  readonly question: string;
  readonly productImpact: string;
  readonly options: readonly string[];
}

export interface ReviewWorkflowSliceInput {
  readonly workspaceRoot: string;
  readonly workflowId: string;
  readonly sliceId: string;
  readonly roundMode?: ReviewConsensusRoundMode;
  readonly codexDecision: CodexReviewDecisionInput;
  readonly verdicts: readonly ReviewVerdictInput[];
  readonly implementationEvidence?: SliceImplementationEvidenceInput;
  readonly seniorReviewerEvidence?: ReviewSeniorReviewerEvidenceInput;
  readonly userEscalations?: readonly ReviewUserEscalationInput[];
  readonly now?: () => Date;
}

const ROLE_IDS = new Set<string>(listRoles().map((role) => role.id));
const REVIEWABLE_STATES = new Set<WorkflowSliceState>([
  "running",
  "awaiting-review",
  "needs-revision"
]);
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
const HARD_BLOCKING_REVIEWERS = new Set<string>([
  "security-reviewer",
  "test-hardening-engineer"
]);
const HARD_BLOCK_PATTERNS = /\b(secret|security|source[- ]?worktree|data[- ]?loss|invariant)\b/i;

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

function findSlice(record: WorkflowRecord, sliceId: string): WorkflowSlice {
  const slice = record.slices.find((candidate) => candidate.sliceId === sliceId);
  if (slice === undefined) {
    throw new Error(`Unknown workflow slice id: ${sliceId}`);
  }
  return slice;
}

function nextReviewRound(record: WorkflowRecord): number {
  const reviewRounds = record.consensusRounds.filter((round) => round.phase === "review");
  if (reviewRounds.length === 0) {
    return 1;
  }
  return Math.max(...reviewRounds.map((round) => round.round)) + 1;
}

function validateRoundMode(round: number, roundMode: ReviewConsensusRoundMode | undefined): void {
  if (round > 15) {
    throw new Error("review consensus cannot exceed 15 rounds");
  }
  if (round > 10 && roundMode !== "extended") {
    throw new Error(`round ${round} requires extended review mode`);
  }
}

function normalizeVerdicts(verdicts: readonly ReviewVerdictInput[]): readonly WorkflowReviewerVerdict[] {
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

function normalizeDecision(decision: CodexReviewDecisionInput): CodexReviewDecisionInput {
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

function normalizeImplementationEvidence(
  evidence: SliceImplementationEvidenceInput | undefined,
  existing: WorkflowSliceImplementationEvidence | undefined,
  recordedAt: string
): WorkflowSliceImplementationEvidence | undefined {
  if (evidence === undefined) {
    return existing;
  }
  const sourceRunId =
    evidence.sourceRunId === undefined
      ? undefined
      : requireNonEmptyString(evidence.sourceRunId, "implementationEvidence.sourceRunId");
  if (sourceRunId !== undefined && !isSafeRunId(sourceRunId)) {
    throw new Error(`Invalid implementation evidence run id: ${sourceRunId}`);
  }
  return {
    recordedAt,
    summary: requireNonEmptyString(evidence.summary, "implementationEvidence.summary"),
    changedFiles: requireStringArray(evidence.changedFiles, "implementationEvidence.changedFiles"),
    testsRun: requireStringArray(evidence.testsRun, "implementationEvidence.testsRun"),
    evidencePaths: requireStringArray(evidence.evidencePaths, "implementationEvidence.evidencePaths"),
    ...(sourceRunId === undefined ? {} : { sourceRunId }),
    ...(evidence.worktreePath === undefined
      ? {}
      : { worktreePath: requireNonEmptyString(evidence.worktreePath, "implementationEvidence.worktreePath") }),
    ...(evidence.knownRisks === undefined
      ? {}
      : { knownRisks: requireStringArray(evidence.knownRisks, "implementationEvidence.knownRisks") })
  };
}

function normalizeSeniorEvidence(
  evidence: ReviewSeniorReviewerEvidenceInput | undefined,
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
    phase: "review",
    status: evidence.status,
    requiredMode: record.seniorReview.opusImplementation.mode,
    checkedAt,
    ...(runId === undefined ? {} : { runId }),
    ...(evidence.provider === undefined
      ? {}
      : { provider: requireNonEmptyString(evidence.provider, "seniorReviewerEvidence.provider") }),
    summary: requireNonEmptyString(evidence.summary, "seniorReviewerEvidence.summary")
  };
}

function normalizeUserEscalations(
  input: readonly ReviewUserEscalationInput[] | undefined,
  workflowId: string,
  sliceId: string,
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
      escalationId: `${workflowId}_${sliceId}_review_${round}_escalation_${index + 1}`,
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
  sliceId: string,
  round: number,
  createdAt: string,
  decision: CodexReviewDecisionInput
): WorkflowUserEscalation | undefined {
  if (round !== 15) {
    return undefined;
  }
  if (!classifyUserEscalation(decision.category).shouldEscalateToUser) {
    return undefined;
  }
  return {
    escalationId: `${workflowId}_${sliceId}_review_round_15_unresolved`,
    createdAt,
    status: "open",
    question: "Resolve the remaining review disagreement.",
    productImpact: decision.summary,
    options: ["continue with Codex decision", "pause until review resolves"]
  };
}

function hasHardBlockingConcern(verdicts: readonly WorkflowReviewerVerdict[]): boolean {
  return verdicts.some((verdict) => {
    if (verdict.status !== "block") {
      return false;
    }
    return HARD_BLOCKING_REVIEWERS.has(verdict.reviewerRole) || HARD_BLOCK_PATTERNS.test(verdict.summary);
  });
}

function evaluateReview(input: {
  readonly round: number;
  readonly decision: CodexReviewDecisionInput;
  readonly verdicts: readonly WorkflowReviewerVerdict[];
  readonly seniorEvidence?: WorkflowOpusReviewEvidence;
  readonly implementationEvidence?: WorkflowSliceImplementationEvidence;
  readonly explicitEscalations: readonly WorkflowUserEscalation[];
}): WorkflowConsensusStatus {
  const hasBlocker = input.verdicts.some((verdict) => verdict.status === "block");
  const hasRevision = input.verdicts.some((verdict) => verdict.status === "revise");
  const seniorMode = input.seniorEvidence?.requiredMode;
  const seniorUnavailableBlocking =
    seniorMode === "required-blocking" && input.seniorEvidence?.status !== "available";
  const missingApprovalEvidence =
    input.decision.status === "approve" && input.implementationEvidence === undefined;

  if (input.round === 15 && (hasBlocker || hasRevision || input.decision.status !== "approve")) {
    return "escalated";
  }
  if (
    seniorUnavailableBlocking ||
    missingApprovalEvidence ||
    hasBlocker ||
    hasHardBlockingConcern(input.verdicts) ||
    input.decision.status === "block"
  ) {
    return "blocked";
  }
  if (input.decision.status === "approve" && !hasRevision) {
    return "approved";
  }
  if (input.decision.status === "approve" && input.round >= 10) {
    return "approved";
  }
  if (input.explicitEscalations.length > 0) {
    return "escalated";
  }
  return "needs-revision";
}

function sliceStateFor(consensus: WorkflowConsensusStatus): WorkflowSliceState {
  if (consensus === "approved") {
    return "approved";
  }
  if (consensus === "blocked") {
    return "blocked";
  }
  if (consensus === "needs-revision") {
    return "needs-revision";
  }
  return "awaiting-review";
}

function reviewerRunIds(verdicts: readonly WorkflowReviewerVerdict[]): readonly string[] | undefined {
  const runIds = verdicts
    .map((verdict) => verdict.evidenceRunId)
    .filter((runId): runId is string => runId !== undefined);
  return runIds.length === 0 ? undefined : runIds;
}

export async function reviewWorkflowSlice(input: ReviewWorkflowSliceInput): Promise<{
  readonly workflow: WorkflowView;
}> {
  if (!isSafeWorkflowId(input.workflowId)) {
    throw new Error(`Invalid workflow id: ${input.workflowId}`);
  }
  if (input.roundMode !== undefined && input.roundMode !== "default" && input.roundMode !== "extended") {
    throw new Error("roundMode must be default or extended");
  }

  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  if (record.planningStatus !== "approved") {
    throw new Error(`Workflow ${record.workflowId} must be approved before reviewing slices`);
  }
  const slice = findSlice(record, input.sliceId);
  if (!REVIEWABLE_STATES.has(slice.state)) {
    throw new Error(`Workflow slice ${slice.sliceId} is ${slice.state}, not reviewable`);
  }

  const timestamp = (input.now?.() ?? new Date()).toISOString();
  const round = nextReviewRound(record);
  validateRoundMode(round, input.roundMode);
  const verdicts = normalizeVerdicts(input.verdicts);
  const decision = normalizeDecision(input.codexDecision);
  const implementationEvidence = normalizeImplementationEvidence(
    input.implementationEvidence,
    slice.implementationEvidence,
    timestamp
  );
  if (decision.status === "approve" && implementationEvidence === undefined) {
    throw new Error("implementation evidence is required before approving a slice");
  }
  const seniorEvidence = normalizeSeniorEvidence(input.seniorReviewerEvidence, record, timestamp);
  const explicitEscalations = normalizeUserEscalations(
    input.userEscalations,
    record.workflowId,
    slice.sliceId,
    round,
    timestamp
  );
  const automaticEscalation =
    explicitEscalations.length === 0
      ? automaticRound15Escalation(record.workflowId, slice.sliceId, round, timestamp, decision)
      : undefined;
  const userEscalations =
    automaticEscalation === undefined
      ? explicitEscalations
      : [...explicitEscalations, automaticEscalation];

  const consensus = evaluateReview({
    round,
    decision,
    verdicts,
    ...(seniorEvidence === undefined ? {} : { seniorEvidence }),
    ...(implementationEvidence === undefined ? {} : { implementationEvidence }),
    explicitEscalations: userEscalations
  });
  const consensusRound: WorkflowConsensusRound = {
    round,
    phase: "review",
    startedAt: timestamp,
    completedAt: timestamp,
    verdicts,
    consensus
  };
  const reviewRunIds = reviewerRunIds(verdicts);
  const reviewEvidence: WorkflowSliceReviewEvidence = {
    reviewedAt: timestamp,
    round,
    consensus,
    summary: decision.summary,
    ...(reviewRunIds === undefined ? {} : { reviewerRunIds: reviewRunIds })
  };
  const updatedSlices = record.slices.map((candidate) => {
    if (candidate.sliceId !== slice.sliceId) {
      return candidate;
    }
    return {
      ...candidate,
      state: sliceStateFor(consensus),
      ...(implementationEvidence === undefined ? {} : { implementationEvidence }),
      reviewEvidence: [...(candidate.reviewEvidence ?? []), reviewEvidence]
    };
  });
  const rationaleRecord = {
    rationaleId: `${record.workflowId}_${slice.sliceId}_review_${round}_codex_decision`,
    createdAt: timestamp,
    category: decision.category,
    summary: decision.summary,
    relatedSliceIds: decision.relatedSliceIds ?? [slice.sliceId]
  };
  const rationalized = appendCodexRationale(record, rationaleRecord);
  const updated: WorkflowRecord = {
    ...rationalized,
    updatedAt: timestamp,
    slices: updatedSlices,
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
