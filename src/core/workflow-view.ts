import type {
  SeniorReviewPolicyConfig,
  WorkflowCodexRationale,
  WorkflowGoalPacket,
  WorkflowIntegrationQueueItem,
  WorkflowPlanningStatus,
  WorkflowRecord,
  WorkflowSlice,
  WorkflowSliceImplementationEvidence,
  WorkflowSliceIntegrationEvidence,
  WorkflowSliceReviewEvidence,
  WorkflowSliceRunEvidence,
  WorkflowSliceStartFailureEvidence,
  WorkflowSliceUnblockEvidence
} from "./workflow-types.js";

export interface WorkflowSliceView {
  readonly sliceId: string;
  readonly title: string;
  readonly state: WorkflowSlice["state"];
  readonly ownerRole: string;
  readonly dependencies: readonly string[];
  readonly writeScope: readonly string[];
  readonly readScope?: readonly string[];
  readonly acceptanceTests: readonly string[];
  readonly expectedEvidence?: readonly string[];
  readonly riskLevel?: WorkflowSlice["riskLevel"];
  readonly requiredReviewers?: readonly string[];
  readonly integrationOrderHint?: number;
  readonly blockedMode?: WorkflowSlice["blockedMode"];
  readonly blockedBy?: readonly string[];
  readonly runIds?: readonly string[];
  readonly runEvidence?: WorkflowSlice["runEvidence"];
  readonly startFailureEvidence?: WorkflowSlice["startFailureEvidence"];
  readonly unblockEvidence?: WorkflowSlice["unblockEvidence"];
  readonly implementationEvidence?: WorkflowSlice["implementationEvidence"];
  readonly reviewEvidence?: WorkflowSlice["reviewEvidence"];
  readonly integrationEvidence?: WorkflowSlice["integrationEvidence"];
}

export interface WorkflowOpusReviewEvidenceView {
  readonly phase: string;
  readonly status: string;
  readonly requiredMode: string;
  readonly checkedAt: string;
  readonly runId?: string;
  readonly provider?: string;
  readonly summary: string;
}

export interface WorkflowView {
  readonly workflowId: string;
  readonly name?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly planningStatus?: WorkflowPlanningStatus;
  readonly goal: WorkflowGoalPacket;
  readonly seniorReview: SeniorReviewPolicyConfig;
  readonly slices: readonly WorkflowSliceView[];
  readonly consensusRounds: readonly unknown[];
  readonly userEscalations: readonly unknown[];
  readonly opusReviewEvidence: readonly WorkflowOpusReviewEvidenceView[];
  readonly integrationQueue: readonly WorkflowIntegrationQueueItem[];
  readonly codexRationale: readonly WorkflowCodexRationale[];
  readonly evidencePath: string;
}

function runEvidenceToView(
  evidence: WorkflowSliceRunEvidence
): WorkflowSliceRunEvidence {
  return {
    runId: evidence.runId,
    startedAt: evidence.startedAt,
    provider: evidence.provider,
    role: evidence.role,
    sidecarPath: evidence.sidecarPath,
    logPath: evidence.logPath,
    ...(evidence.executionCwd === undefined ? {} : { executionCwd: evidence.executionCwd }),
    ...(evidence.transcriptPath === undefined ? {} : { transcriptPath: evidence.transcriptPath })
  };
}

function failureEvidenceToView(
  evidence: WorkflowSliceStartFailureEvidence
): WorkflowSliceStartFailureEvidence {
  return {
    failedAt: evidence.failedAt,
    error: evidence.error
  };
}

function unblockEvidenceToView(
  evidence: WorkflowSliceUnblockEvidence
): WorkflowSliceUnblockEvidence {
  return {
    dependencySliceId: evidence.dependencySliceId,
    recordedAt: evidence.recordedAt,
    summary: evidence.summary,
    ...(evidence.changedFiles === undefined ? {} : { changedFiles: evidence.changedFiles }),
    ...(evidence.evidencePaths === undefined ? {} : { evidencePaths: evidence.evidencePaths }),
    ...(evidence.sourceRunId === undefined ? {} : { sourceRunId: evidence.sourceRunId })
  };
}

function implementationEvidenceToView(
  evidence: WorkflowSliceImplementationEvidence
): WorkflowSliceImplementationEvidence {
  return {
    recordedAt: evidence.recordedAt,
    summary: evidence.summary,
    changedFiles: evidence.changedFiles,
    testsRun: evidence.testsRun,
    evidencePaths: evidence.evidencePaths,
    ...(evidence.sourceRunId === undefined ? {} : { sourceRunId: evidence.sourceRunId }),
    ...(evidence.worktreePath === undefined ? {} : { worktreePath: evidence.worktreePath }),
    ...(evidence.knownRisks === undefined ? {} : { knownRisks: evidence.knownRisks })
  };
}

function reviewEvidenceToView(
  evidence: WorkflowSliceReviewEvidence
): WorkflowSliceReviewEvidence {
  return {
    reviewedAt: evidence.reviewedAt,
    round: evidence.round,
    consensus: evidence.consensus,
    summary: evidence.summary,
    ...(evidence.reviewerRunIds === undefined ? {} : { reviewerRunIds: evidence.reviewerRunIds })
  };
}

function integrationEvidenceToView(
  evidence: WorkflowSliceIntegrationEvidence
): WorkflowSliceIntegrationEvidence {
  return {
    integratedAt: evidence.integratedAt,
    integrationMethod: evidence.integrationMethod,
    summary: evidence.summary,
    changedFiles: evidence.changedFiles,
    verification: evidence.verification.map((item) => ({
      command: item.command,
      status: item.status,
      summary: item.summary,
      ...(item.evidencePath === undefined ? {} : { evidencePath: item.evidencePath })
    })),
    ...(evidence.evidencePaths === undefined ? {} : { evidencePaths: evidence.evidencePaths }),
    ...(evidence.retainedWorktreePath === undefined
      ? {}
      : { retainedWorktreePath: evidence.retainedWorktreePath }),
    ...(evidence.cleanupRecommendation === undefined
      ? {}
      : { cleanupRecommendation: evidence.cleanupRecommendation })
  };
}

function integrationQueueItemToView(
  item: WorkflowIntegrationQueueItem
): WorkflowIntegrationQueueItem {
  return {
    sliceId: item.sliceId,
    state: item.state,
    worktreePath: item.worktreePath,
    branchName: item.branchName,
    reviewRunIds: item.reviewRunIds,
    ...(item.queuePosition === undefined ? {} : { queuePosition: item.queuePosition }),
    ...(item.conflictRisk === undefined ? {} : { conflictRisk: item.conflictRisk }),
    ...(item.riskReasons === undefined ? {} : { riskReasons: item.riskReasons }),
    ...(item.changedFiles === undefined ? {} : { changedFiles: item.changedFiles }),
    ...(item.dependencySliceIds === undefined ? {} : { dependencySliceIds: item.dependencySliceIds }),
    ...(item.focusedTests === undefined ? {} : { focusedTests: item.focusedTests }),
    ...(item.queuedAt === undefined ? {} : { queuedAt: item.queuedAt }),
    ...(item.integratedAt === undefined ? {} : { integratedAt: item.integratedAt }),
    ...(item.finalGateStatus === undefined ? {} : { finalGateStatus: item.finalGateStatus }),
    ...(item.integrationEvidencePaths === undefined
      ? {}
      : { integrationEvidencePaths: item.integrationEvidencePaths }),
    ...(item.cleanupRecommendation === undefined
      ? {}
      : { cleanupRecommendation: item.cleanupRecommendation })
  };
}

function sliceToView(slice: WorkflowSlice): WorkflowSliceView {
  return {
    sliceId: slice.sliceId,
    title: slice.title,
    state: slice.state,
    ownerRole: slice.ownerRole,
    dependencies: slice.dependencies,
    writeScope: slice.writeScope,
    ...(slice.readScope === undefined ? {} : { readScope: slice.readScope }),
    acceptanceTests: slice.acceptanceTests,
    ...(slice.expectedEvidence === undefined
      ? {}
      : { expectedEvidence: slice.expectedEvidence }),
    ...(slice.riskLevel === undefined ? {} : { riskLevel: slice.riskLevel }),
    ...(slice.requiredReviewers === undefined
      ? {}
      : { requiredReviewers: slice.requiredReviewers }),
    ...(slice.integrationOrderHint === undefined
      ? {}
      : { integrationOrderHint: slice.integrationOrderHint }),
    ...(slice.blockedMode === undefined ? {} : { blockedMode: slice.blockedMode }),
    ...(slice.blockedBy === undefined ? {} : { blockedBy: slice.blockedBy }),
    ...(slice.runIds === undefined ? {} : { runIds: slice.runIds }),
    ...(slice.runEvidence === undefined
      ? {}
      : { runEvidence: slice.runEvidence.map(runEvidenceToView) }),
    ...(slice.startFailureEvidence === undefined
      ? {}
      : { startFailureEvidence: slice.startFailureEvidence.map(failureEvidenceToView) }),
    ...(slice.unblockEvidence === undefined
      ? {}
      : { unblockEvidence: slice.unblockEvidence.map(unblockEvidenceToView) }),
    ...(slice.implementationEvidence === undefined
      ? {}
      : { implementationEvidence: implementationEvidenceToView(slice.implementationEvidence) }),
    ...(slice.reviewEvidence === undefined
      ? {}
      : { reviewEvidence: slice.reviewEvidence.map(reviewEvidenceToView) }),
    ...(slice.integrationEvidence === undefined
      ? {}
      : { integrationEvidence: slice.integrationEvidence.map(integrationEvidenceToView) })
  };
}

export function toWorkflowView(record: WorkflowRecord): WorkflowView {
  return {
    workflowId: record.workflowId,
    ...(record.name === undefined ? {} : { name: record.name }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.planningStatus === undefined ? {} : { planningStatus: record.planningStatus }),
    goal: record.goal,
    seniorReview: record.seniorReview,
    slices: record.slices.map(sliceToView),
    consensusRounds: record.consensusRounds,
    userEscalations: record.userEscalations,
    opusReviewEvidence: record.opusReviewEvidence.map((evidence) => ({
      phase: evidence.phase,
      status: evidence.status,
      requiredMode: evidence.requiredMode,
      checkedAt: evidence.checkedAt,
      ...(evidence.runId === undefined ? {} : { runId: evidence.runId }),
      ...(evidence.provider === undefined ? {} : { provider: evidence.provider }),
      summary: evidence.summary
    })),
    integrationQueue: record.integrationQueue.map(integrationQueueItemToView),
    codexRationale: record.codexRationale ?? [],
    evidencePath: record.evidencePath
  };
}
