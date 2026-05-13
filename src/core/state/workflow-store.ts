import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { StateCorruptionError } from "../errors.js";
import { readJsonFile, writeJsonAtomic } from "./atomic-json.js";
import {
  isSafeRunId,
  isSafeWorkflowId,
  workflowRecordPath,
  workflowsDir
} from "./paths.js";
import {
  SENIOR_REVIEW_MODES,
  CODEX_RATIONALE_CATEGORIES,
  WORKFLOW_CLEANUP_RECOMMENDATIONS,
  WORKFLOW_BLOCKED_MODES,
  WORKFLOW_CONSENSUS_PHASES,
  WORKFLOW_CONSENSUS_STATUSES,
  WORKFLOW_ESCALATION_STATUSES,
  WORKFLOW_INTEGRATION_STATES,
  WORKFLOW_OPUS_REVIEW_STATUSES,
  WORKFLOW_PLANNING_STATUSES,
  WORKFLOW_RISK_LEVELS,
  WORKFLOW_SLICE_STATES,
  WORKFLOW_VERIFICATION_STATUSES,
  WORKFLOW_VERDICT_STATUSES,
  type CodexRationaleCategory,
  type SeniorReviewMode,
  type SeniorReviewPolicyConfig,
  type WorkflowBlockedMode,
  type WorkflowCleanupRecommendation,
  type WorkflowCodexRationale,
  type WorkflowConsensusPhase,
  type WorkflowConsensusRound,
  type WorkflowConsensusStatus,
  type WorkflowEscalationStatus,
  type WorkflowGoalPacket,
  type WorkflowIntegrationQueueItem,
  type WorkflowIntegrationState,
  type WorkflowOpusReviewEvidence,
  type WorkflowOpusReviewStatus,
  type WorkflowPlanningStatus,
  type WorkflowRecord,
  type WorkflowReviewerVerdict,
  type WorkflowRiskLevel,
  type WorkflowSlice,
  type WorkflowSliceImplementationEvidence,
  type WorkflowSliceIntegrationEvidence,
  type WorkflowSliceReviewEvidence,
  type WorkflowSliceRunEvidence,
  type WorkflowSliceStartFailureEvidence,
  type WorkflowSliceState,
  type WorkflowSliceUnblockEvidence,
  type WorkflowVerificationEvidence,
  type WorkflowVerificationStatus,
  type WorkflowUserEscalation,
  type WorkflowVerdictStatus
} from "../workflow-types.js";

const WORKFLOW_RECORD_KEYS = new Set([
  "workflowId",
  "name",
  "createdAt",
  "updatedAt",
  "planningStatus",
  "goal",
  "seniorReview",
  "slices",
  "consensusRounds",
  "userEscalations",
  "opusReviewEvidence",
  "integrationQueue",
  "codexRationale",
  "evidencePath"
]);
const GOAL_KEYS = new Set(["title", "successCriteria", "constraints", "nonGoals"]);
const SENIOR_REVIEW_KEYS = new Set(["opusPlanning", "opusImplementation"]);
const SENIOR_REVIEW_MODE_KEYS = new Set(["mode"]);
const SLICE_KEYS = new Set([
  "sliceId",
  "title",
  "state",
  "ownerRole",
  "dependencies",
  "writeScope",
  "readScope",
  "acceptanceTests",
  "expectedEvidence",
  "riskLevel",
  "requiredReviewers",
  "integrationOrderHint",
  "blockedMode",
  "blockedBy",
  "runIds",
  "runEvidence",
  "startFailureEvidence",
  "unblockEvidence",
  "implementationEvidence",
  "reviewEvidence",
  "integrationEvidence"
]);
const SLICE_RUN_EVIDENCE_KEYS = new Set([
  "runId",
  "startedAt",
  "provider",
  "role",
  "sidecarPath",
  "logPath",
  "executionCwd",
  "transcriptPath",
  "mailboxPaths"
]);
const SLICE_RUN_MAILBOX_PATH_KEYS = new Set(["inbox", "outbox", "control", "events"]);
const SLICE_START_FAILURE_EVIDENCE_KEYS = new Set(["failedAt", "error"]);
const SLICE_UNBLOCK_EVIDENCE_KEYS = new Set([
  "dependencySliceId",
  "recordedAt",
  "summary",
  "changedFiles",
  "evidencePaths",
  "sourceRunId"
]);
const SLICE_IMPLEMENTATION_EVIDENCE_KEYS = new Set([
  "recordedAt",
  "summary",
  "changedFiles",
  "testsRun",
  "evidencePaths",
  "sourceRunId",
  "worktreePath",
  "knownRisks"
]);
const SLICE_REVIEW_EVIDENCE_KEYS = new Set([
  "reviewedAt",
  "round",
  "consensus",
  "summary",
  "reviewerRunIds"
]);
const SLICE_INTEGRATION_EVIDENCE_KEYS = new Set([
  "integratedAt",
  "integrationMethod",
  "summary",
  "changedFiles",
  "verification",
  "evidencePaths",
  "retainedWorktreePath",
  "cleanupRecommendation"
]);
const VERIFICATION_EVIDENCE_KEYS = new Set([
  "command",
  "status",
  "summary",
  "evidencePath"
]);
const CODEX_RATIONALE_KEYS = new Set([
  "rationaleId",
  "createdAt",
  "category",
  "summary",
  "relatedSliceIds"
]);
const CONSENSUS_ROUND_KEYS = new Set([
  "round",
  "phase",
  "startedAt",
  "completedAt",
  "verdicts",
  "consensus"
]);
const REVIEWER_VERDICT_KEYS = new Set([
  "reviewerRole",
  "reviewerProvider",
  "status",
  "summary",
  "evidenceRunId"
]);
const USER_ESCALATION_KEYS = new Set([
  "escalationId",
  "createdAt",
  "resolvedAt",
  "status",
  "question",
  "productImpact",
  "options"
]);
const OPUS_EVIDENCE_KEYS = new Set([
  "phase",
  "status",
  "requiredMode",
  "checkedAt",
  "runId",
  "provider",
  "summary"
]);
const INTEGRATION_QUEUE_KEYS = new Set([
  "sliceId",
  "state",
  "worktreePath",
  "branchName",
  "reviewRunIds",
  "queuePosition",
  "conflictRisk",
  "riskReasons",
  "changedFiles",
  "dependencySliceIds",
  "focusedTests",
  "queuedAt",
  "integratedAt",
  "finalGateStatus",
  "integrationEvidencePaths",
  "cleanupRecommendation"
]);

const SENIOR_REVIEW_MODE_SET = new Set<string>(SENIOR_REVIEW_MODES);
const PLANNING_STATUS_SET = new Set<string>(WORKFLOW_PLANNING_STATUSES);
const SLICE_STATE_SET = new Set<string>(WORKFLOW_SLICE_STATES);
const RISK_LEVEL_SET = new Set<string>(WORKFLOW_RISK_LEVELS);
const VERIFICATION_STATUS_SET = new Set<string>(WORKFLOW_VERIFICATION_STATUSES);
const CLEANUP_RECOMMENDATION_SET = new Set<string>(WORKFLOW_CLEANUP_RECOMMENDATIONS);
const BLOCKED_MODE_SET = new Set<string>(WORKFLOW_BLOCKED_MODES);
const CODEX_RATIONALE_CATEGORY_SET = new Set<string>(CODEX_RATIONALE_CATEGORIES);
const CONSENSUS_PHASE_SET = new Set<string>(WORKFLOW_CONSENSUS_PHASES);
const VERDICT_STATUS_SET = new Set<string>(WORKFLOW_VERDICT_STATUSES);
const CONSENSUS_STATUS_SET = new Set<string>(WORKFLOW_CONSENSUS_STATUSES);
const ESCALATION_STATUS_SET = new Set<string>(WORKFLOW_ESCALATION_STATUSES);
const OPUS_STATUS_SET = new Set<string>(WORKFLOW_OPUS_REVIEW_STATUSES);
const INTEGRATION_STATE_SET = new Set<string>(WORKFLOW_INTEGRATION_STATES);

function corruption(path: string, reason: string): StateCorruptionError {
  return new StateCorruptionError(`Invalid workflow record at ${path}: ${reason}`, {
    path,
    kind: "json"
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  path: string,
  allowedKeys: ReadonlySet<string>,
  label: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw corruption(path, `${label} contains unsupported field ${key}`);
    }
  }
}

function expectObject(
  value: unknown,
  path: string,
  field: string
): Record<string, unknown> {
  if (!isObject(value)) {
    throw corruption(path, `${field} must be an object`);
  }
  return value;
}

function expectNonEmptyString(value: unknown, path: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw corruption(path, `${field} must be a non-empty string`);
  }
  return value;
}

function expectOptionalNonEmptyString(
  value: unknown,
  path: string,
  field: string
): string | undefined {
  return value === undefined ? undefined : expectNonEmptyString(value, path, field);
}

function expectPositiveInteger(value: unknown, path: string, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw corruption(path, `${field} must be a positive integer`);
  }
  return value;
}

function expectOptionalPositiveInteger(
  value: unknown,
  path: string,
  field: string
): number | undefined {
  return value === undefined ? undefined : expectPositiveInteger(value, path, field);
}

function expectStringArray(value: unknown, path: string, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw corruption(path, `${field} must be an array`);
  }
  return value.map((item, index) =>
    expectNonEmptyString(item, path, `${field}[${index}]`)
  );
}

function expectNonEmptyArray(
  value: unknown,
  path: string,
  field: string
): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw corruption(path, `${field} must be a non-empty array`);
  }
  return value;
}

function expectArray(value: unknown, path: string, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw corruption(path, `${field} must be an array`);
  }
  return value;
}

function expectEnum<T extends string>(
  value: unknown,
  path: string,
  field: string,
  allowed: ReadonlySet<string>
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw corruption(path, `${field} must be a supported value`);
  }
  return value as T;
}

function parseGoal(value: unknown, path: string): WorkflowGoalPacket {
  const goal = expectObject(value, path, "goal");
  assertKnownKeys(goal, path, GOAL_KEYS, "goal");
  return {
    title: expectNonEmptyString(goal.title, path, "goal.title"),
    successCriteria: expectStringArray(goal.successCriteria, path, "goal.successCriteria"),
    constraints: expectStringArray(goal.constraints, path, "goal.constraints"),
    nonGoals: expectStringArray(goal.nonGoals, path, "goal.nonGoals")
  };
}

function parseSeniorReviewModeConfig(
  value: unknown,
  path: string,
  field: string
): { readonly mode: SeniorReviewMode } {
  const config = expectObject(value, path, field);
  assertKnownKeys(config, path, SENIOR_REVIEW_MODE_KEYS, field);
  return {
    mode: expectEnum<SeniorReviewMode>(config.mode, path, `${field}.mode`, SENIOR_REVIEW_MODE_SET)
  };
}

function parseSeniorReview(value: unknown, path: string): SeniorReviewPolicyConfig {
  const seniorReview = expectObject(value, path, "seniorReview");
  assertKnownKeys(seniorReview, path, SENIOR_REVIEW_KEYS, "seniorReview");
  return {
    opusPlanning: parseSeniorReviewModeConfig(
      seniorReview.opusPlanning,
      path,
      "seniorReview.opusPlanning"
    ),
    opusImplementation: parseSeniorReviewModeConfig(
      seniorReview.opusImplementation,
      path,
      "seniorReview.opusImplementation"
    )
  };
}

function parseSlice(value: unknown, path: string, index: number): WorkflowSlice {
  const slice = expectObject(value, path, `slices[${index}]`);
  assertKnownKeys(slice, path, SLICE_KEYS, `slices[${index}]`);
  const blockedBy =
    slice.blockedBy === undefined
      ? undefined
      : expectStringArray(slice.blockedBy, path, `slices[${index}].blockedBy`);
  const runIds =
    slice.runIds === undefined
      ? undefined
      : expectStringArray(slice.runIds, path, `slices[${index}].runIds`);
  const runEvidence =
    slice.runEvidence === undefined
      ? undefined
      : expectArray(slice.runEvidence, path, `slices[${index}].runEvidence`).map(
          (item, evidenceIndex) => parseSliceRunEvidence(item, path, index, evidenceIndex)
        );
  const startFailureEvidence =
    slice.startFailureEvidence === undefined
      ? undefined
      : expectArray(
          slice.startFailureEvidence,
          path,
          `slices[${index}].startFailureEvidence`
        ).map((item, evidenceIndex) =>
          parseSliceStartFailureEvidence(item, path, index, evidenceIndex)
        );
  const unblockEvidence =
    slice.unblockEvidence === undefined
      ? undefined
      : expectArray(slice.unblockEvidence, path, `slices[${index}].unblockEvidence`).map(
          (item, evidenceIndex) => parseSliceUnblockEvidence(item, path, index, evidenceIndex)
        );
  const implementationEvidence =
    slice.implementationEvidence === undefined
      ? undefined
      : parseSliceImplementationEvidence(slice.implementationEvidence, path, index);
  const reviewEvidence =
    slice.reviewEvidence === undefined
      ? undefined
      : expectArray(slice.reviewEvidence, path, `slices[${index}].reviewEvidence`).map(
          (item, evidenceIndex) => parseSliceReviewEvidence(item, path, index, evidenceIndex)
        );
  const integrationEvidence =
    slice.integrationEvidence === undefined
      ? undefined
      : expectArray(slice.integrationEvidence, path, `slices[${index}].integrationEvidence`).map(
          (item, evidenceIndex) =>
            parseSliceIntegrationEvidence(item, path, index, evidenceIndex)
        );
  const readScope =
    slice.readScope === undefined
      ? undefined
      : expectStringArray(slice.readScope, path, `slices[${index}].readScope`);
  const expectedEvidence =
    slice.expectedEvidence === undefined
      ? undefined
      : expectStringArray(slice.expectedEvidence, path, `slices[${index}].expectedEvidence`);
  const requiredReviewers =
    slice.requiredReviewers === undefined
      ? undefined
      : expectStringArray(slice.requiredReviewers, path, `slices[${index}].requiredReviewers`);
  const integrationOrderHint = expectOptionalPositiveInteger(
    slice.integrationOrderHint,
    path,
    `slices[${index}].integrationOrderHint`
  );
  const riskLevel =
    slice.riskLevel === undefined
      ? undefined
      : expectEnum<WorkflowRiskLevel>(
          slice.riskLevel,
          path,
          `slices[${index}].riskLevel`,
          RISK_LEVEL_SET
        );
  const blockedMode =
    slice.blockedMode === undefined
      ? undefined
      : expectEnum<WorkflowBlockedMode>(
          slice.blockedMode,
          path,
          `slices[${index}].blockedMode`,
          BLOCKED_MODE_SET
        );
  return {
    sliceId: expectNonEmptyString(slice.sliceId, path, `slices[${index}].sliceId`),
    title: expectNonEmptyString(slice.title, path, `slices[${index}].title`),
    state: expectEnum<WorkflowSliceState>(
      slice.state,
      path,
      `slices[${index}].state`,
      SLICE_STATE_SET
    ),
    ownerRole: expectNonEmptyString(slice.ownerRole, path, `slices[${index}].ownerRole`),
    dependencies: expectStringArray(slice.dependencies, path, `slices[${index}].dependencies`),
    writeScope: expectStringArray(slice.writeScope, path, `slices[${index}].writeScope`),
    ...(readScope === undefined ? {} : { readScope }),
    acceptanceTests: expectStringArray(
      slice.acceptanceTests,
      path,
      `slices[${index}].acceptanceTests`
    ),
    ...(expectedEvidence === undefined ? {} : { expectedEvidence }),
    ...(riskLevel === undefined ? {} : { riskLevel }),
    ...(requiredReviewers === undefined ? {} : { requiredReviewers }),
    ...(integrationOrderHint === undefined ? {} : { integrationOrderHint }),
    ...(blockedMode === undefined ? {} : { blockedMode }),
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(runIds === undefined ? {} : { runIds }),
    ...(runEvidence === undefined ? {} : { runEvidence }),
    ...(startFailureEvidence === undefined ? {} : { startFailureEvidence }),
    ...(unblockEvidence === undefined ? {} : { unblockEvidence }),
    ...(implementationEvidence === undefined ? {} : { implementationEvidence }),
    ...(reviewEvidence === undefined ? {} : { reviewEvidence }),
    ...(integrationEvidence === undefined ? {} : { integrationEvidence })
  };
}

function parseSliceRunEvidence(
  value: unknown,
  path: string,
  sliceIndex: number,
  evidenceIndex: number
): WorkflowSliceRunEvidence {
  const field = `slices[${sliceIndex}].runEvidence[${evidenceIndex}]`;
  const evidence = expectObject(value, path, field);
  assertKnownKeys(evidence, path, SLICE_RUN_EVIDENCE_KEYS, field);
  const executionCwd =
    evidence.executionCwd === undefined
      ? undefined
      : expectNonEmptyString(evidence.executionCwd, path, `${field}.executionCwd`);
  const transcriptPath =
    evidence.transcriptPath === undefined
      ? undefined
      : expectNonEmptyString(evidence.transcriptPath, path, `${field}.transcriptPath`);
  const mailboxPaths =
    evidence.mailboxPaths === undefined
      ? undefined
      : parseSliceRunMailboxPaths(evidence.mailboxPaths, path, `${field}.mailboxPaths`);
  return {
    runId: expectNonEmptyString(evidence.runId, path, `${field}.runId`),
    startedAt: expectNonEmptyString(evidence.startedAt, path, `${field}.startedAt`),
    provider: expectNonEmptyString(evidence.provider, path, `${field}.provider`),
    role: expectNonEmptyString(evidence.role, path, `${field}.role`),
    sidecarPath: expectNonEmptyString(evidence.sidecarPath, path, `${field}.sidecarPath`),
    logPath: expectNonEmptyString(evidence.logPath, path, `${field}.logPath`),
    ...(executionCwd === undefined ? {} : { executionCwd }),
    ...(transcriptPath === undefined ? {} : { transcriptPath }),
    ...(mailboxPaths === undefined ? {} : { mailboxPaths })
  };
}

function parseSliceRunMailboxPaths(
  value: unknown,
  path: string,
  field: string
): WorkflowSliceRunEvidence["mailboxPaths"] {
  const paths = expectObject(value, path, field);
  assertKnownKeys(paths, path, SLICE_RUN_MAILBOX_PATH_KEYS, field);
  return {
    inbox: expectNonEmptyString(paths.inbox, path, `${field}.inbox`),
    outbox: expectNonEmptyString(paths.outbox, path, `${field}.outbox`),
    control: expectNonEmptyString(paths.control, path, `${field}.control`),
    events: expectNonEmptyString(paths.events, path, `${field}.events`)
  };
}

function parseSliceStartFailureEvidence(
  value: unknown,
  path: string,
  sliceIndex: number,
  evidenceIndex: number
): WorkflowSliceStartFailureEvidence {
  const field = `slices[${sliceIndex}].startFailureEvidence[${evidenceIndex}]`;
  const evidence = expectObject(value, path, field);
  assertKnownKeys(evidence, path, SLICE_START_FAILURE_EVIDENCE_KEYS, field);
  return {
    failedAt: expectNonEmptyString(evidence.failedAt, path, `${field}.failedAt`),
    error: expectNonEmptyString(evidence.error, path, `${field}.error`)
  };
}

function parseSliceUnblockEvidence(
  value: unknown,
  path: string,
  sliceIndex: number,
  evidenceIndex: number
): WorkflowSliceUnblockEvidence {
  const field = `slices[${sliceIndex}].unblockEvidence[${evidenceIndex}]`;
  const evidence = expectObject(value, path, field);
  assertKnownKeys(evidence, path, SLICE_UNBLOCK_EVIDENCE_KEYS, field);
  const changedFiles =
    evidence.changedFiles === undefined
      ? undefined
      : expectStringArray(evidence.changedFiles, path, `${field}.changedFiles`);
  const evidencePaths =
    evidence.evidencePaths === undefined
      ? undefined
      : expectStringArray(evidence.evidencePaths, path, `${field}.evidencePaths`);
  const sourceRunId =
    evidence.sourceRunId === undefined
      ? undefined
      : expectNonEmptyString(evidence.sourceRunId, path, `${field}.sourceRunId`);
  return {
    dependencySliceId: expectNonEmptyString(
      evidence.dependencySliceId,
      path,
      `${field}.dependencySliceId`
    ),
    recordedAt: expectNonEmptyString(evidence.recordedAt, path, `${field}.recordedAt`),
    summary: expectNonEmptyString(evidence.summary, path, `${field}.summary`),
    ...(changedFiles === undefined ? {} : { changedFiles }),
    ...(evidencePaths === undefined ? {} : { evidencePaths }),
    ...(sourceRunId === undefined ? {} : { sourceRunId })
  };
}

function parseSliceImplementationEvidence(
  value: unknown,
  path: string,
  sliceIndex: number
): WorkflowSliceImplementationEvidence {
  const field = `slices[${sliceIndex}].implementationEvidence`;
  const evidence = expectObject(value, path, field);
  assertKnownKeys(evidence, path, SLICE_IMPLEMENTATION_EVIDENCE_KEYS, field);
  const sourceRunId =
    evidence.sourceRunId === undefined
      ? undefined
      : expectNonEmptyString(evidence.sourceRunId, path, `${field}.sourceRunId`);
  if (sourceRunId !== undefined && !isSafeRunId(sourceRunId)) {
    throw corruption(path, `${field}.sourceRunId is not a safe run id`);
  }
  const worktreePath =
    evidence.worktreePath === undefined
      ? undefined
      : expectNonEmptyString(evidence.worktreePath, path, `${field}.worktreePath`);
  const knownRisks =
    evidence.knownRisks === undefined
      ? undefined
      : expectStringArray(evidence.knownRisks, path, `${field}.knownRisks`);
  return {
    recordedAt: expectNonEmptyString(evidence.recordedAt, path, `${field}.recordedAt`),
    summary: expectNonEmptyString(evidence.summary, path, `${field}.summary`),
    changedFiles: expectStringArray(evidence.changedFiles, path, `${field}.changedFiles`),
    testsRun: expectStringArray(evidence.testsRun, path, `${field}.testsRun`),
    evidencePaths: expectStringArray(evidence.evidencePaths, path, `${field}.evidencePaths`),
    ...(sourceRunId === undefined ? {} : { sourceRunId }),
    ...(worktreePath === undefined ? {} : { worktreePath }),
    ...(knownRisks === undefined ? {} : { knownRisks })
  };
}

function parseSliceReviewEvidence(
  value: unknown,
  path: string,
  sliceIndex: number,
  evidenceIndex: number
): WorkflowSliceReviewEvidence {
  const field = `slices[${sliceIndex}].reviewEvidence[${evidenceIndex}]`;
  const evidence = expectObject(value, path, field);
  assertKnownKeys(evidence, path, SLICE_REVIEW_EVIDENCE_KEYS, field);
  const reviewerRunIds =
    evidence.reviewerRunIds === undefined
      ? undefined
      : expectStringArray(evidence.reviewerRunIds, path, `${field}.reviewerRunIds`);
  if (reviewerRunIds !== undefined) {
    for (const [runIndex, runId] of reviewerRunIds.entries()) {
      if (!isSafeRunId(runId)) {
        throw corruption(path, `${field}.reviewerRunIds[${runIndex}] is not a safe run id`);
      }
    }
  }
  return {
    reviewedAt: expectNonEmptyString(evidence.reviewedAt, path, `${field}.reviewedAt`),
    round: expectPositiveInteger(evidence.round, path, `${field}.round`),
    consensus: expectEnum<WorkflowConsensusStatus>(
      evidence.consensus,
      path,
      `${field}.consensus`,
      CONSENSUS_STATUS_SET
    ),
    summary: expectNonEmptyString(evidence.summary, path, `${field}.summary`),
    ...(reviewerRunIds === undefined ? {} : { reviewerRunIds })
  };
}

function parseVerificationEvidence(
  value: unknown,
  path: string,
  field: string
): WorkflowVerificationEvidence {
  const evidence = expectObject(value, path, field);
  assertKnownKeys(evidence, path, VERIFICATION_EVIDENCE_KEYS, field);
  const evidencePath =
    evidence.evidencePath === undefined
      ? undefined
      : expectNonEmptyString(evidence.evidencePath, path, `${field}.evidencePath`);
  return {
    command: expectNonEmptyString(evidence.command, path, `${field}.command`),
    status: expectEnum<WorkflowVerificationStatus>(
      evidence.status,
      path,
      `${field}.status`,
      VERIFICATION_STATUS_SET
    ),
    summary: expectNonEmptyString(evidence.summary, path, `${field}.summary`),
    ...(evidencePath === undefined ? {} : { evidencePath })
  };
}

function parseSliceIntegrationEvidence(
  value: unknown,
  path: string,
  sliceIndex: number,
  evidenceIndex: number
): WorkflowSliceIntegrationEvidence {
  const field = `slices[${sliceIndex}].integrationEvidence[${evidenceIndex}]`;
  const evidence = expectObject(value, path, field);
  assertKnownKeys(evidence, path, SLICE_INTEGRATION_EVIDENCE_KEYS, field);
  const verification = expectNonEmptyArray(
    evidence.verification,
    path,
    `${field}.verification`
  ).map((item, verificationIndex) =>
    parseVerificationEvidence(item, path, `${field}.verification[${verificationIndex}]`)
  );
  const evidencePaths =
    evidence.evidencePaths === undefined
      ? undefined
      : expectStringArray(evidence.evidencePaths, path, `${field}.evidencePaths`);
  const retainedWorktreePath =
    evidence.retainedWorktreePath === undefined
      ? undefined
      : expectNonEmptyString(
          evidence.retainedWorktreePath,
          path,
          `${field}.retainedWorktreePath`
        );
  const cleanupRecommendation =
    evidence.cleanupRecommendation === undefined
      ? undefined
      : expectEnum<WorkflowCleanupRecommendation>(
          evidence.cleanupRecommendation,
          path,
          `${field}.cleanupRecommendation`,
          CLEANUP_RECOMMENDATION_SET
        );
  return {
    integratedAt: expectNonEmptyString(evidence.integratedAt, path, `${field}.integratedAt`),
    integrationMethod: expectNonEmptyString(
      evidence.integrationMethod,
      path,
      `${field}.integrationMethod`
    ),
    summary: expectNonEmptyString(evidence.summary, path, `${field}.summary`),
    changedFiles: expectStringArray(evidence.changedFiles, path, `${field}.changedFiles`),
    verification,
    ...(evidencePaths === undefined ? {} : { evidencePaths }),
    ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
    ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation })
  };
}

function parseCodexRationale(
  value: unknown,
  path: string,
  index: number
): WorkflowCodexRationale {
  const rationale = expectObject(value, path, `codexRationale[${index}]`);
  assertKnownKeys(rationale, path, CODEX_RATIONALE_KEYS, `codexRationale[${index}]`);
  return {
    rationaleId: expectNonEmptyString(
      rationale.rationaleId,
      path,
      `codexRationale[${index}].rationaleId`
    ),
    createdAt: expectNonEmptyString(
      rationale.createdAt,
      path,
      `codexRationale[${index}].createdAt`
    ),
    category: expectEnum<CodexRationaleCategory>(
      rationale.category,
      path,
      `codexRationale[${index}].category`,
      CODEX_RATIONALE_CATEGORY_SET
    ),
    summary: expectNonEmptyString(
      rationale.summary,
      path,
      `codexRationale[${index}].summary`
    ),
    relatedSliceIds: expectStringArray(
      rationale.relatedSliceIds,
      path,
      `codexRationale[${index}].relatedSliceIds`
    )
  };
}

function parseVerdict(
  value: unknown,
  path: string,
  roundIndex: number,
  verdictIndex: number
): WorkflowReviewerVerdict {
  const verdict = expectObject(
    value,
    path,
    `consensusRounds[${roundIndex}].verdicts[${verdictIndex}]`
  );
  const field = `consensusRounds[${roundIndex}].verdicts[${verdictIndex}]`;
  assertKnownKeys(verdict, path, REVIEWER_VERDICT_KEYS, field);
  const reviewerProvider = expectOptionalNonEmptyString(
    verdict.reviewerProvider,
    path,
    `${field}.reviewerProvider`
  );
  const evidenceRunId = expectOptionalNonEmptyString(
    verdict.evidenceRunId,
    path,
    `${field}.evidenceRunId`
  );
  if (evidenceRunId !== undefined && !isSafeRunId(evidenceRunId)) {
    throw corruption(path, `${field}.evidenceRunId is not a safe run id`);
  }
  return {
    reviewerRole: expectNonEmptyString(verdict.reviewerRole, path, `${field}.reviewerRole`),
    ...(reviewerProvider === undefined ? {} : { reviewerProvider }),
    status: expectEnum<WorkflowVerdictStatus>(
      verdict.status,
      path,
      `${field}.status`,
      VERDICT_STATUS_SET
    ),
    summary: expectNonEmptyString(verdict.summary, path, `${field}.summary`),
    ...(evidenceRunId === undefined ? {} : { evidenceRunId })
  };
}

function parseConsensusRound(
  value: unknown,
  path: string,
  index: number
): WorkflowConsensusRound {
  const round = expectObject(value, path, `consensusRounds[${index}]`);
  assertKnownKeys(round, path, CONSENSUS_ROUND_KEYS, `consensusRounds[${index}]`);
  const completedAt = expectOptionalNonEmptyString(
    round.completedAt,
    path,
    `consensusRounds[${index}].completedAt`
  );
  return {
    round: expectPositiveInteger(round.round, path, `consensusRounds[${index}].round`),
    phase: expectEnum<WorkflowConsensusPhase>(
      round.phase,
      path,
      `consensusRounds[${index}].phase`,
      CONSENSUS_PHASE_SET
    ),
    startedAt: expectNonEmptyString(round.startedAt, path, `consensusRounds[${index}].startedAt`),
    ...(completedAt === undefined ? {} : { completedAt }),
    verdicts: expectArray(
      round.verdicts,
      path,
      `consensusRounds[${index}].verdicts`
    ).map((verdict, verdictIndex) => parseVerdict(verdict, path, index, verdictIndex)),
    consensus: expectEnum<WorkflowConsensusStatus>(
      round.consensus,
      path,
      `consensusRounds[${index}].consensus`,
      CONSENSUS_STATUS_SET
    )
  };
}

function parseUserEscalation(
  value: unknown,
  path: string,
  index: number
): WorkflowUserEscalation {
  const escalation = expectObject(value, path, `userEscalations[${index}]`);
  assertKnownKeys(escalation, path, USER_ESCALATION_KEYS, `userEscalations[${index}]`);
  const resolvedAt = expectOptionalNonEmptyString(
    escalation.resolvedAt,
    path,
    `userEscalations[${index}].resolvedAt`
  );
  return {
    escalationId: expectNonEmptyString(
      escalation.escalationId,
      path,
      `userEscalations[${index}].escalationId`
    ),
    createdAt: expectNonEmptyString(
      escalation.createdAt,
      path,
      `userEscalations[${index}].createdAt`
    ),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    status: expectEnum<WorkflowEscalationStatus>(
      escalation.status,
      path,
      `userEscalations[${index}].status`,
      ESCALATION_STATUS_SET
    ),
    question: expectNonEmptyString(
      escalation.question,
      path,
      `userEscalations[${index}].question`
    ),
    productImpact: expectNonEmptyString(
      escalation.productImpact,
      path,
      `userEscalations[${index}].productImpact`
    ),
    options: expectStringArray(escalation.options, path, `userEscalations[${index}].options`)
  };
}

function parseOpusEvidence(
  value: unknown,
  path: string,
  index: number
): WorkflowOpusReviewEvidence {
  const evidence = expectObject(value, path, `opusReviewEvidence[${index}]`);
  assertKnownKeys(evidence, path, OPUS_EVIDENCE_KEYS, `opusReviewEvidence[${index}]`);
  const runId = expectOptionalNonEmptyString(
    evidence.runId,
    path,
    `opusReviewEvidence[${index}].runId`
  );
  if (runId !== undefined && !isSafeRunId(runId)) {
    throw corruption(path, `opusReviewEvidence[${index}].runId is not a safe run id`);
  }
  const provider = expectOptionalNonEmptyString(
    evidence.provider,
    path,
    `opusReviewEvidence[${index}].provider`
  );
  return {
    phase: expectEnum<WorkflowConsensusPhase>(
      evidence.phase,
      path,
      `opusReviewEvidence[${index}].phase`,
      CONSENSUS_PHASE_SET
    ),
    status: expectEnum<WorkflowOpusReviewStatus>(
      evidence.status,
      path,
      `opusReviewEvidence[${index}].status`,
      OPUS_STATUS_SET
    ),
    requiredMode: expectEnum<SeniorReviewMode>(
      evidence.requiredMode,
      path,
      `opusReviewEvidence[${index}].requiredMode`,
      SENIOR_REVIEW_MODE_SET
    ),
    checkedAt: expectNonEmptyString(
      evidence.checkedAt,
      path,
      `opusReviewEvidence[${index}].checkedAt`
    ),
    ...(runId === undefined ? {} : { runId }),
    ...(provider === undefined ? {} : { provider }),
    summary: expectNonEmptyString(evidence.summary, path, `opusReviewEvidence[${index}].summary`)
  };
}

function parseIntegrationQueueItem(
  value: unknown,
  path: string,
  index: number
): WorkflowIntegrationQueueItem {
  const item = expectObject(value, path, `integrationQueue[${index}]`);
  assertKnownKeys(item, path, INTEGRATION_QUEUE_KEYS, `integrationQueue[${index}]`);
  const reviewRunIds = expectStringArray(
    item.reviewRunIds,
    path,
    `integrationQueue[${index}].reviewRunIds`
  );
  for (const [runIndex, runId] of reviewRunIds.entries()) {
    if (!isSafeRunId(runId)) {
      throw corruption(path, `integrationQueue[${index}].reviewRunIds[${runIndex}] is not a safe run id`);
    }
  }
  return {
    sliceId: expectNonEmptyString(item.sliceId, path, `integrationQueue[${index}].sliceId`),
    state: expectEnum<WorkflowIntegrationState>(
      item.state,
      path,
      `integrationQueue[${index}].state`,
      INTEGRATION_STATE_SET
    ),
    worktreePath: expectNonEmptyString(
      item.worktreePath,
      path,
      `integrationQueue[${index}].worktreePath`
    ),
    branchName: expectNonEmptyString(
      item.branchName,
      path,
      `integrationQueue[${index}].branchName`
    ),
    reviewRunIds,
    ...(item.queuePosition === undefined
      ? {}
      : {
          queuePosition: expectPositiveInteger(
            item.queuePosition,
            path,
            `integrationQueue[${index}].queuePosition`
          )
        }),
    ...(item.conflictRisk === undefined
      ? {}
      : {
          conflictRisk: expectEnum<WorkflowRiskLevel>(
            item.conflictRisk,
            path,
            `integrationQueue[${index}].conflictRisk`,
            RISK_LEVEL_SET
          )
        }),
    ...(item.riskReasons === undefined
      ? {}
      : { riskReasons: expectStringArray(item.riskReasons, path, `integrationQueue[${index}].riskReasons`) }),
    ...(item.changedFiles === undefined
      ? {}
      : { changedFiles: expectStringArray(item.changedFiles, path, `integrationQueue[${index}].changedFiles`) }),
    ...(item.dependencySliceIds === undefined
      ? {}
      : {
          dependencySliceIds: expectStringArray(
            item.dependencySliceIds,
            path,
            `integrationQueue[${index}].dependencySliceIds`
          )
        }),
    ...(item.focusedTests === undefined
      ? {}
      : { focusedTests: expectStringArray(item.focusedTests, path, `integrationQueue[${index}].focusedTests`) }),
    ...(item.queuedAt === undefined
      ? {}
      : { queuedAt: expectNonEmptyString(item.queuedAt, path, `integrationQueue[${index}].queuedAt`) }),
    ...(item.integratedAt === undefined
      ? {}
      : {
          integratedAt: expectNonEmptyString(
            item.integratedAt,
            path,
            `integrationQueue[${index}].integratedAt`
          )
        }),
    ...(item.finalGateStatus === undefined
      ? {}
      : {
          finalGateStatus: expectEnum<WorkflowVerificationStatus>(
            item.finalGateStatus,
            path,
            `integrationQueue[${index}].finalGateStatus`,
            VERIFICATION_STATUS_SET
          )
        }),
    ...(item.integrationEvidencePaths === undefined
      ? {}
      : {
          integrationEvidencePaths: expectStringArray(
            item.integrationEvidencePaths,
            path,
            `integrationQueue[${index}].integrationEvidencePaths`
          )
        }),
    ...(item.cleanupRecommendation === undefined
      ? {}
      : {
          cleanupRecommendation: expectEnum<WorkflowCleanupRecommendation>(
            item.cleanupRecommendation,
            path,
            `integrationQueue[${index}].cleanupRecommendation`,
            CLEANUP_RECOMMENDATION_SET
          )
        })
  };
}

function parseWorkflowRecord(value: unknown, path: string): WorkflowRecord {
  if (!isObject(value)) {
    throw corruption(path, "record must be an object");
  }
  assertKnownKeys(value, path, WORKFLOW_RECORD_KEYS, "record");

  const workflowId = expectNonEmptyString(value.workflowId, path, "workflowId");
  if (!isSafeWorkflowId(workflowId)) {
    throw corruption(path, "workflowId is not a safe workflow id");
  }
  if (basename(path) !== `${workflowId}.json`) {
    throw corruption(path, "workflowId must match the workflow record file name");
  }

  const evidencePath = expectNonEmptyString(value.evidencePath, path, "evidencePath");
  if (evidencePath !== path) {
    throw corruption(path, "evidencePath must match the workflow record path");
  }

  const name = expectOptionalNonEmptyString(value.name, path, "name");
  const planningStatus =
    value.planningStatus === undefined
      ? undefined
      : expectEnum<WorkflowPlanningStatus>(
          value.planningStatus,
          path,
          "planningStatus",
          PLANNING_STATUS_SET
        );
  const codexRationale =
    value.codexRationale === undefined
      ? undefined
      : expectArray(value.codexRationale, path, "codexRationale").map((rationale, index) =>
          parseCodexRationale(rationale, path, index)
        );

  return {
    workflowId,
    ...(name === undefined ? {} : { name }),
    createdAt: expectNonEmptyString(value.createdAt, path, "createdAt"),
    updatedAt: expectNonEmptyString(value.updatedAt, path, "updatedAt"),
    ...(planningStatus === undefined ? {} : { planningStatus }),
    goal: parseGoal(value.goal, path),
    seniorReview: parseSeniorReview(value.seniorReview, path),
    slices: expectNonEmptyArray(value.slices, path, "slices").map((slice, index) =>
      parseSlice(slice, path, index)
    ),
    consensusRounds: expectArray(value.consensusRounds, path, "consensusRounds").map(
      (round, index) => parseConsensusRound(round, path, index)
    ),
    userEscalations: expectArray(value.userEscalations, path, "userEscalations").map(
      (escalation, index) => parseUserEscalation(escalation, path, index)
    ),
    opusReviewEvidence: expectArray(value.opusReviewEvidence, path, "opusReviewEvidence").map(
      (evidence, index) => parseOpusEvidence(evidence, path, index)
    ),
    integrationQueue: expectArray(value.integrationQueue, path, "integrationQueue").map(
      (item, index) => parseIntegrationQueueItem(item, path, index)
    ),
    ...(codexRationale === undefined ? {} : { codexRationale }),
    evidencePath
  };
}

async function readWorkflowRecordPath(path: string): Promise<WorkflowRecord> {
  return parseWorkflowRecord(await readJsonFile<unknown>(path), path);
}

export async function writeWorkflowRecord(
  workspaceRoot: string,
  record: WorkflowRecord
): Promise<void> {
  const path = workflowRecordPath(workspaceRoot, record.workflowId);
  await writeJsonAtomic(path, parseWorkflowRecord(record, path));
}

export async function readWorkflowRecord(
  workspaceRoot: string,
  workflowId: string
): Promise<WorkflowRecord> {
  return readWorkflowRecordPath(workflowRecordPath(workspaceRoot, workflowId));
}

export async function listWorkflowRecords(
  workspaceRoot: string
): Promise<readonly WorkflowRecord[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(workflowsDir(workspaceRoot));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => {
        const workflowId = entry.slice(0, -5);
        const path = join(workflowsDir(workspaceRoot), entry);
        if (!isSafeWorkflowId(workflowId)) {
          throw corruption(path, "workflow record file name is not a safe workflow id");
        }
        return readWorkflowRecordPath(path);
      })
  );

  return records.sort((left, right) => {
    const created = left.createdAt.localeCompare(right.createdAt);
    return created === 0 ? left.workflowId.localeCompare(right.workflowId) : created;
  });
}
