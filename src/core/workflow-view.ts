import type {
  SeniorReviewPolicyConfig,
  WorkflowCodexRationale,
  WorkflowGoalPacket,
  WorkflowPlanningStatus,
  WorkflowRecord,
  WorkflowSlice
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
  readonly integrationQueue: readonly unknown[];
  readonly codexRationale: readonly WorkflowCodexRationale[];
  readonly evidencePath: string;
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
    ...(slice.blockedBy === undefined ? {} : { blockedBy: slice.blockedBy })
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
    integrationQueue: record.integrationQueue,
    codexRationale: record.codexRationale ?? [],
    evidencePath: record.evidencePath
  };
}
