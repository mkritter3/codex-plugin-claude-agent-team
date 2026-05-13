import { resolve } from "node:path";
import { runDoctor } from "../doctor.js";
import { cancelAgentRuns } from "../core/cancel-many.js";
import { loadAgentTeamConfig } from "../core/config.js";
import { dispatchReadOnlyAgent } from "../core/dispatch.js";
import { StateCorruptionError } from "../core/errors.js";
import {
  buildAgentTeamDashboard,
  buildAgentTeamDashboardStateCorrupt
} from "../core/team-dashboard.js";
import {
  createDefaultLifecycleRegistry,
  LifecycleRegistry
} from "../core/lifecycle-registry.js";
import { startAgentTeamInParallel } from "../core/parallel-start.js";
import { listRoles } from "../core/roles.js";
import { createRunId } from "../core/run-ids.js";
import { sendAgentMessages } from "../core/message-many.js";
import { readMailboxRecords } from "../core/state/mailbox-store.js";
import { isSafeRunId, isSafeTeamId, teamRecordPath } from "../core/state/paths.js";
import {
  recoverStateCorruption,
  reportStateCorruption
} from "../core/state/recovery.js";
import { readRunSidecar } from "../core/state/run-store.js";
import { readAgentStatuses } from "../core/status-many.js";
import { summarizeAgentTeam } from "../core/team-summary.js";
import {
  createAgentTeamRecord,
  getAgentTeamRecord,
  listAgentTeamRecords
} from "../core/team-records.js";
import { windDownAgentRuns } from "../core/wind-down-many.js";
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  type CreateWorkflowInput,
  type CreateWorkflowSliceInput,
  type GetWorkflowInput
} from "../core/workflow-service.js";
import {
  planConsensus,
  type PlanConsensusInput,
  type PlanConsensusUserEscalationInput,
  type PlanConsensusVerdictInput
} from "../core/workflow-consensus.js";
import {
  buildWorkflowIntegrationQueue,
  type BuildWorkflowIntegrationQueueInput
} from "../core/workflow-integration-queue.js";
import {
  recordWorkflowIntegration,
  type RecordWorkflowIntegrationInput,
  type RecordWorkflowVerificationInput
} from "../core/workflow-integration-evidence.js";
import {
  buildWorkflowReport,
  type BuildWorkflowReportInput
} from "../core/workflow-report.js";
import {
  reviewWorkflowSlice,
  type ReviewUserEscalationInput,
  type ReviewVerdictInput,
  type ReviewWorkflowSliceInput,
  type SliceImplementationEvidenceInput
} from "../core/workflow-review.js";
import {
  startWorkflowSlices,
  unblockWorkflowSlice,
  type StartWorkflowSlicesInput,
  type UnblockDependencyEvidenceInput,
  type UnblockWorkflowSliceInput
} from "../core/workflow-slices.js";
import type {
  CodexRationaleCategory,
  WorkflowGoalPacket,
  WorkflowOpusReviewStatus
} from "../core/workflow-types.js";
import type {
  AgentCleanupRequest,
  AgentCleanupResult,
  AgentCancelManyRequest,
  AgentCancelManyRun,
  AgentControlResult,
  AgentDispatchRequest,
  AgentMessageManyItemRequest,
  AgentMessageManyRequest,
  AgentMessageRequest,
  AgentMessageResult,
  AgentParallelStartRequest,
  AgentParallelStartRun,
  AgentReplyRequest,
  AgentReplyResult,
  AgentStartResult,
  AgentStatusManyRequest,
  AgentStatusManyRun,
  AgentTeamDashboardRequest,
  AgentTeamConfig,
  AgentTeamCreateRequest,
  AgentTeamRunRef,
  AgentTeamSummaryRequest,
  AgentTeamSummaryRunRequest,
  AgentWindDownManyRequest,
  AgentWindDownManyRun,
  RoleId,
  RunSidecar
} from "../core/types.js";
import { listProviders } from "../providers/index.js";
import { jsonToolResult, type JsonToolResult } from "../utils/json.js";

export const TOOL_NAMES = [
  "agent_team_dispatch",
  "agent_team_start",
  "agent_team_start_parallel",
  "agent_team_reply",
  "agent_team_message",
  "agent_team_message_many",
  "agent_team_status",
  "agent_team_status_many",
  "agent_team_summary",
  "agent_team_create_team",
  "agent_team_get_team",
  "agent_team_list_teams",
  "agent_team_create_workflow",
  "agent_team_get_workflow",
  "agent_team_list_workflows",
  "agent_team_plan_consensus",
  "agent_team_start_slices",
  "agent_team_unblock_slice",
  "agent_team_review_slice",
  "agent_team_integration_queue",
  "agent_team_record_integration",
  "agent_team_workflow_report",
  "agent_team_dashboard",
  "agent_team_cancel",
  "agent_team_cancel_many",
  "agent_team_wind_down",
  "agent_team_wind_down_many",
  "agent_team_cleanup",
  "agent_team_doctor",
  "agent_team_list_roles",
  "agent_team_list_providers"
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const ROLE_IDS = new Set<string>(listRoles().map((role) => role.id));

type LifecycleLike = {
  readonly startRun: (request: AgentDispatchRequest) => Promise<AgentStartResult>;
  readonly messageRun: (request: AgentMessageRequest) => Promise<AgentMessageResult>;
  readonly replyRun: (request: AgentReplyRequest) => Promise<AgentReplyResult>;
  readonly getStatus: (cwd: string, runId: string) => Promise<RunSidecar>;
  readonly cancelRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
  readonly windDownRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
  readonly cleanupRunWorkspace?: (request: AgentCleanupRequest) => Promise<AgentCleanupResult>;
};

const defaultLifecycleRegistry = createDefaultLifecycleRegistry();

export interface ToolDependencies {
  readonly dispatch?: typeof dispatchReadOnlyAgent;
  readonly lifecycle?: LifecycleLike;
  readonly lifecycleFactory?: (config: AgentTeamConfig) => LifecycleLike;
  readonly lifecycleRegistry?: LifecycleRegistry<LifecycleLike>;
  readonly doctor?: typeof runDoctor;
  readonly cwd?: () => string;
  readonly config?: AgentTeamConfig;
  readonly createWorkflow?: typeof createWorkflow;
  readonly getWorkflow?: typeof getWorkflow;
  readonly listWorkflows?: typeof listWorkflows;
  readonly planConsensus?: typeof planConsensus;
  readonly startWorkflowSlices?: typeof startWorkflowSlices;
  readonly unblockWorkflowSlice?: typeof unblockWorkflowSlice;
  readonly reviewWorkflowSlice?: typeof reviewWorkflowSlice;
  readonly buildWorkflowIntegrationQueue?: typeof buildWorkflowIntegrationQueue;
  readonly recordWorkflowIntegration?: typeof recordWorkflowIntegration;
  readonly buildWorkflowReport?: typeof buildWorkflowReport;
  readonly now?: () => Date;
  readonly createWorkflowId?: () => string;
}

export function listToolNames(): readonly ToolName[] {
  return TOOL_NAMES;
}

function validationError(message: string): JsonToolResult {
  return jsonToolResult({ status: "validation_error", message });
}

function isJsonToolResult(value: unknown): value is JsonToolResult {
  return typeof value === "object" && value !== null && "content" in value;
}

async function recoverableLifecycleTool(input: {
  readonly workspaceRoot: string;
  readonly runId?: string;
  readonly operation: ToolName;
  readonly action: () => Promise<JsonToolResult>;
}): Promise<JsonToolResult> {
  try {
    return await input.action();
  } catch (error) {
    if (error instanceof StateCorruptionError) {
      return jsonToolResult(
        await recoverStateCorruption({
          workspaceRoot: input.workspaceRoot,
          ...(input.runId === undefined ? {} : { runId: input.runId }),
          operation: input.operation,
          error
        })
      );
    }
    throw error;
  }
}

function parseDispatchArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentDispatchRequest | JsonToolResult {
  if (typeof args.role !== "string" || !ROLE_IDS.has(args.role)) {
    return validationError("agent_team_dispatch requires a valid role.");
  }
  if (typeof args.task !== "string" || args.task.trim().length === 0) {
    return validationError("agent_team_dispatch requires a non-empty task.");
  }
  if (args.cwd !== undefined && typeof args.cwd !== "string") {
    return validationError("agent_team_dispatch cwd must be a string.");
  }
  if (args.provider !== undefined && typeof args.provider !== "string") {
    return validationError("agent_team_dispatch provider must be a string.");
  }
  if (
    args.timeoutMs !== undefined &&
    (typeof args.timeoutMs !== "number" || args.timeoutMs <= 0)
  ) {
    return validationError("agent_team_dispatch timeoutMs must be a positive number.");
  }

  return {
    role: args.role as RoleId,
    task: args.task,
    cwd: args.cwd ?? cwd,
    ...(args.provider === undefined ? {} : { provider: args.provider }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  };
}

function readOptionalString(
  value: unknown,
  message: string
): string | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return validationError(message);
  }
  return value;
}

function readString(value: unknown, message: string): string | JsonToolResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return validationError(message);
  }
  return value;
}

function readRole(value: unknown, message: string): RoleId | JsonToolResult {
  if (typeof value !== "string" || !ROLE_IDS.has(value)) {
    return validationError(message);
  }
  return value as RoleId;
}

function readOptionalPositiveInteger(
  value: unknown,
  field: string
): number | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return validationError(`${field} must be a positive integer.`);
  }
  return value;
}

function readStringArray(
  value: unknown,
  field: string
): readonly string[] | JsonToolResult {
  if (!Array.isArray(value) || value.length === 0) {
    return validationError(`${field} must be a non-empty array.`);
  }
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return validationError(`${field}[${index}] must be a non-empty string.`);
    }
    result.push(item);
  }
  return result;
}

function readOptionalBoolean(
  value: unknown,
  message: string
): boolean | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    return validationError(message);
  }
  return value;
}

function parseWorkflowGoalArgs(value: unknown): WorkflowGoalPacket | JsonToolResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return validationError("agent_team_create_workflow goal must be an object.");
  }
  const goal = value as Record<string, unknown>;
  const title = readString(goal.title, "agent_team_create_workflow goal.title");
  if (isJsonToolResult(title)) {
    return title;
  }
  const successCriteria = readStringArray(
    goal.successCriteria,
    "agent_team_create_workflow goal.successCriteria"
  );
  if (isJsonToolResult(successCriteria)) {
    return successCriteria;
  }
  const constraints = readStringArray(
    goal.constraints,
    "agent_team_create_workflow goal.constraints"
  );
  if (isJsonToolResult(constraints)) {
    return constraints;
  }
  const nonGoals = readStringArray(
    goal.nonGoals,
    "agent_team_create_workflow goal.nonGoals"
  );
  if (isJsonToolResult(nonGoals)) {
    return nonGoals;
  }
  return {
    title,
    successCriteria,
    constraints,
    nonGoals
  };
}

function parseWorkflowSliceArgs(
  value: unknown,
  index: number
): CreateWorkflowSliceInput | JsonToolResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return validationError(`agent_team_create_workflow slices[${index}] must be an object.`);
  }
  const slice = value as Record<string, unknown>;
  const sliceId = readString(slice.sliceId, `agent_team_create_workflow slices[${index}].sliceId`);
  if (isJsonToolResult(sliceId)) {
    return sliceId;
  }
  const title = readString(slice.title, `agent_team_create_workflow slices[${index}].title`);
  if (isJsonToolResult(title)) {
    return title;
  }
  const ownerRole = readRole(
    slice.ownerRole,
    `agent_team_create_workflow slices[${index}].ownerRole`
  );
  if (isJsonToolResult(ownerRole)) {
    return ownerRole;
  }
  const state = readOptionalString(
    slice.state,
    `agent_team_create_workflow slices[${index}].state`
  );
  if (state !== undefined && typeof state !== "string") {
    return state;
  }
  const dependencies =
    slice.dependencies === undefined
      ? undefined
      : readStringArray(slice.dependencies, `agent_team_create_workflow slices[${index}].dependencies`);
  if (dependencies !== undefined && isJsonToolResult(dependencies)) {
    return dependencies;
  }
  const writeScope = readStringArray(
    slice.writeScope,
    `agent_team_create_workflow slices[${index}].writeScope`
  );
  if (isJsonToolResult(writeScope)) {
    return writeScope;
  }
  const readScope =
    slice.readScope === undefined
      ? undefined
      : readStringArray(slice.readScope, `agent_team_create_workflow slices[${index}].readScope`);
  if (readScope !== undefined && isJsonToolResult(readScope)) {
    return readScope;
  }
  const acceptanceTests = readStringArray(
    slice.acceptanceTests,
    `agent_team_create_workflow slices[${index}].acceptanceTests`
  );
  if (isJsonToolResult(acceptanceTests)) {
    return acceptanceTests;
  }
  const expectedEvidence = readStringArray(
    slice.expectedEvidence,
    `agent_team_create_workflow slices[${index}].expectedEvidence`
  );
  if (isJsonToolResult(expectedEvidence)) {
    return expectedEvidence;
  }
  const riskLevel = readOptionalString(
    slice.riskLevel,
    `agent_team_create_workflow slices[${index}].riskLevel`
  );
  if (riskLevel !== undefined && typeof riskLevel !== "string") {
    return riskLevel;
  }
  const requiredReviewers =
    slice.requiredReviewers === undefined
      ? undefined
      : readStringArray(slice.requiredReviewers, `agent_team_create_workflow slices[${index}].requiredReviewers`);
  if (requiredReviewers !== undefined && isJsonToolResult(requiredReviewers)) {
    return requiredReviewers;
  }
  const integrationOrderHint = readOptionalPositiveInteger(
    slice.integrationOrderHint,
    `agent_team_create_workflow slices[${index}].integrationOrderHint`
  );
  if (integrationOrderHint !== undefined && typeof integrationOrderHint !== "number") {
    return integrationOrderHint;
  }
  const blockedMode = readOptionalString(
    slice.blockedMode,
    `agent_team_create_workflow slices[${index}].blockedMode`
  );
  if (blockedMode !== undefined && typeof blockedMode !== "string") {
    return blockedMode;
  }
  return {
    sliceId,
    title,
    ownerRole,
    ...(state === undefined ? {} : { state }),
    ...(dependencies === undefined ? {} : { dependencies }),
    writeScope,
    ...(readScope === undefined ? {} : { readScope }),
    acceptanceTests,
    expectedEvidence,
    ...(riskLevel === undefined ? {} : { riskLevel }),
    ...(requiredReviewers === undefined ? {} : { requiredReviewers }),
    ...(integrationOrderHint === undefined ? {} : { integrationOrderHint }),
    ...(blockedMode === undefined ? {} : { blockedMode })
  };
}

function parseCreateWorkflowArgs(
  args: Record<string, unknown>,
  defaultCwd: string,
  config: AgentTeamConfig,
  deps: Pick<ToolDependencies, "now" | "createWorkflowId">
): CreateWorkflowInput | JsonToolResult {
  const cwdValue = readOptionalString(args.cwd, "agent_team_create_workflow cwd");
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  const workflowId = readOptionalString(
    args.workflowId,
    "agent_team_create_workflow workflowId"
  );
  if (workflowId !== undefined && typeof workflowId !== "string") {
    return workflowId;
  }
  const name = readOptionalString(args.name, "agent_team_create_workflow name");
  if (name !== undefined && typeof name !== "string") {
    return name;
  }
  const rationale = readOptionalString(
    args.rationale,
    "agent_team_create_workflow rationale"
  );
  if (rationale !== undefined && typeof rationale !== "string") {
    return rationale;
  }
  const goal = parseWorkflowGoalArgs(args.goal);
  if (isJsonToolResult(goal)) {
    return goal;
  }
  if (!Array.isArray(args.slices) || args.slices.length === 0) {
    return validationError("agent_team_create_workflow requires a non-empty slices array.");
  }
  const slices: CreateWorkflowSliceInput[] = [];
  for (const [index, slice] of args.slices.entries()) {
    const parsed = parseWorkflowSliceArgs(slice, index);
    if (isJsonToolResult(parsed)) {
      return parsed;
    }
    slices.push(parsed);
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    config,
    goal,
    slices,
    ...(workflowId === undefined ? {} : { workflowId }),
    ...(name === undefined ? {} : { name }),
    ...(rationale === undefined ? {} : { rationale }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.createWorkflowId === undefined ? {} : { createWorkflowId: deps.createWorkflowId })
  };
}

function parseGetWorkflowArgs(
  args: Record<string, unknown>,
  defaultCwd: string,
  toolName: "agent_team_get_workflow"
): GetWorkflowInput | JsonToolResult {
  const workflowId = readString(args.workflowId, `${toolName} requires a non-empty workflowId.`);
  if (isJsonToolResult(workflowId)) {
    return workflowId;
  }
  const cwdValue = readOptionalString(args.cwd, `${toolName} cwd`);
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    workflowId
  };
}

const CODEX_DECISION_CATEGORIES = new Set<string>([
  "technical",
  "product-behavior",
  "user-trust",
  "security-risk",
  "provider-cost",
  "release-posture"
]);
const USER_ESCALATION_CATEGORIES = new Set<string>([
  "product-behavior",
  "user-trust",
  "security-risk",
  "provider-cost",
  "release-posture"
]);
const CONSENSUS_VERDICT_STATUSES = new Set<string>([
  "approve",
  "revise",
  "block",
  "abstain"
]);
const CODEX_DECISION_STATUSES = new Set<string>(["approve", "revise", "block"]);
const SENIOR_REVIEWER_STATUSES = new Set<string>([
  "available",
  "unavailable",
  "skipped"
]);

function readCategory(
  value: unknown,
  field: string,
  allowed: Set<string> = CODEX_DECISION_CATEGORIES
): CodexRationaleCategory | JsonToolResult {
  if (typeof value !== "string" || !allowed.has(value)) {
    return validationError(`${field} must be a supported decision category.`);
  }
  return value as CodexRationaleCategory;
}

function parseConsensusVerdicts(value: unknown): readonly PlanConsensusVerdictInput[] | JsonToolResult {
  if (!Array.isArray(value) || value.length === 0) {
    return validationError("agent_team_plan_consensus requires a non-empty verdicts array.");
  }
  const verdicts: PlanConsensusVerdictInput[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return validationError(`agent_team_plan_consensus verdicts[${index}] must be an object.`);
    }
    const verdict = item as Record<string, unknown>;
    const reviewerRole = readRole(
      verdict.reviewerRole,
      `agent_team_plan_consensus verdicts[${index}].reviewerRole`
    );
    if (isJsonToolResult(reviewerRole)) {
      return reviewerRole;
    }
    const status = readString(verdict.status, `agent_team_plan_consensus verdicts[${index}].status`);
    if (isJsonToolResult(status)) {
      return status;
    }
    if (!CONSENSUS_VERDICT_STATUSES.has(status)) {
      return validationError(
        `agent_team_plan_consensus verdicts[${index}].status must be approve, revise, block, or abstain.`
      );
    }
    const summary = readString(verdict.summary, `agent_team_plan_consensus verdicts[${index}].summary`);
    if (isJsonToolResult(summary)) {
      return summary;
    }
    const reviewerProvider = readOptionalString(
      verdict.reviewerProvider,
      `agent_team_plan_consensus verdicts[${index}].reviewerProvider`
    );
    if (reviewerProvider !== undefined && typeof reviewerProvider !== "string") {
      return reviewerProvider;
    }
    const evidenceRunId = readOptionalString(
      verdict.evidenceRunId,
      `agent_team_plan_consensus verdicts[${index}].evidenceRunId`
    );
    if (evidenceRunId !== undefined && typeof evidenceRunId !== "string") {
      return evidenceRunId;
    }
    verdicts.push({
      reviewerRole,
      ...(reviewerProvider === undefined ? {} : { reviewerProvider }),
      status,
      summary,
      ...(evidenceRunId === undefined ? {} : { evidenceRunId })
    });
  }
  return verdicts;
}

function parseCodexDecision(value: unknown): PlanConsensusInput["codexDecision"] | JsonToolResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return validationError("agent_team_plan_consensus codexDecision must be an object.");
  }
  const decision = value as Record<string, unknown>;
  const status = readString(decision.status, "agent_team_plan_consensus codexDecision.status");
  if (isJsonToolResult(status)) {
    return status;
  }
  if (!CODEX_DECISION_STATUSES.has(status)) {
    return validationError("agent_team_plan_consensus codexDecision.status must be approve, revise, or block.");
  }
  const category = readCategory(decision.category, "agent_team_plan_consensus codexDecision.category");
  if (isJsonToolResult(category)) {
    return category;
  }
  const summary = readString(decision.summary, "agent_team_plan_consensus codexDecision.summary");
  if (isJsonToolResult(summary)) {
    return summary;
  }
  const relatedSliceIds =
    decision.relatedSliceIds === undefined
      ? undefined
      : readStringArray(
          decision.relatedSliceIds,
          "agent_team_plan_consensus codexDecision.relatedSliceIds"
        );
  if (relatedSliceIds !== undefined && isJsonToolResult(relatedSliceIds)) {
    return relatedSliceIds;
  }
  return {
    status: status as PlanConsensusInput["codexDecision"]["status"],
    category,
    summary,
    ...(relatedSliceIds === undefined ? {} : { relatedSliceIds })
  };
}

function parseSeniorReviewerEvidence(
  value: unknown
): PlanConsensusInput["seniorReviewerEvidence"] | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return validationError("agent_team_plan_consensus seniorReviewerEvidence must be an object.");
  }
  const evidence = value as Record<string, unknown>;
  const status = readString(evidence.status, "agent_team_plan_consensus seniorReviewerEvidence.status");
  if (isJsonToolResult(status)) {
    return status;
  }
  if (!SENIOR_REVIEWER_STATUSES.has(status)) {
    return validationError(
      "agent_team_plan_consensus seniorReviewerEvidence.status must be available, unavailable, or skipped."
    );
  }
  const summary = readString(evidence.summary, "agent_team_plan_consensus seniorReviewerEvidence.summary");
  if (isJsonToolResult(summary)) {
    return summary;
  }
  const provider = readOptionalString(
    evidence.provider,
    "agent_team_plan_consensus seniorReviewerEvidence.provider"
  );
  if (provider !== undefined && typeof provider !== "string") {
    return provider;
  }
  const runId = readOptionalString(evidence.runId, "agent_team_plan_consensus seniorReviewerEvidence.runId");
  if (runId !== undefined && typeof runId !== "string") {
    return runId;
  }
  return {
    status: status as WorkflowOpusReviewStatus,
    ...(provider === undefined ? {} : { provider }),
    ...(runId === undefined ? {} : { runId }),
    summary
  };
}

function parseConsensusUserEscalations(
  value: unknown
): readonly PlanConsensusUserEscalationInput[] | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    return validationError("agent_team_plan_consensus userEscalations must be a non-empty array.");
  }
  const escalations: PlanConsensusUserEscalationInput[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return validationError(`agent_team_plan_consensus userEscalations[${index}] must be an object.`);
    }
    const escalation = item as Record<string, unknown>;
    const category = readCategory(
      escalation.category,
      `agent_team_plan_consensus userEscalations[${index}].category`,
      USER_ESCALATION_CATEGORIES
    );
    if (isJsonToolResult(category)) {
      return category;
    }
    const question = readString(
      escalation.question,
      `agent_team_plan_consensus userEscalations[${index}].question`
    );
    if (isJsonToolResult(question)) {
      return question;
    }
    const productImpact = readString(
      escalation.productImpact,
      `agent_team_plan_consensus userEscalations[${index}].productImpact`
    );
    if (isJsonToolResult(productImpact)) {
      return productImpact;
    }
    const options = readStringArray(
      escalation.options,
      `agent_team_plan_consensus userEscalations[${index}].options`
    );
    if (isJsonToolResult(options)) {
      return options;
    }
    escalations.push({
      category,
      question,
      productImpact,
      options
    });
  }
  return escalations;
}

function parsePlanConsensusArgs(
  args: Record<string, unknown>,
  defaultCwd: string,
  deps: Pick<ToolDependencies, "now">
): PlanConsensusInput | JsonToolResult {
  const workflowId = readString(
    args.workflowId,
    "agent_team_plan_consensus requires a non-empty workflowId."
  );
  if (isJsonToolResult(workflowId)) {
    return workflowId;
  }
  const cwdValue = readOptionalString(args.cwd, "agent_team_plan_consensus cwd");
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  const roundMode = readOptionalString(args.roundMode, "agent_team_plan_consensus roundMode");
  if (roundMode !== undefined && typeof roundMode !== "string") {
    return roundMode;
  }
  if (roundMode !== undefined && roundMode !== "default" && roundMode !== "extended") {
    return validationError("agent_team_plan_consensus roundMode must be default or extended.");
  }
  const codexDecision = parseCodexDecision(args.codexDecision);
  if (isJsonToolResult(codexDecision)) {
    return codexDecision;
  }
  const verdicts = parseConsensusVerdicts(args.verdicts);
  if (isJsonToolResult(verdicts)) {
    return verdicts;
  }
  const seniorReviewerEvidence = parseSeniorReviewerEvidence(args.seniorReviewerEvidence);
  if (seniorReviewerEvidence !== undefined && isJsonToolResult(seniorReviewerEvidence)) {
    return seniorReviewerEvidence;
  }
  const userEscalations = parseConsensusUserEscalations(args.userEscalations);
  if (userEscalations !== undefined && isJsonToolResult(userEscalations)) {
    return userEscalations;
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    workflowId,
    ...(roundMode === undefined ? {} : { roundMode }),
    codexDecision,
    verdicts,
    ...(seniorReviewerEvidence === undefined ? {} : { seniorReviewerEvidence }),
    ...(userEscalations === undefined ? {} : { userEscalations }),
    ...(deps.now === undefined ? {} : { now: deps.now })
  };
}

function parseStartWorkflowSlicesArgs(
  args: Record<string, unknown>,
  defaultCwd: string,
  deps: Pick<ToolDependencies, "now">
): StartWorkflowSlicesInput | JsonToolResult {
  const workflowId = readString(
    args.workflowId,
    "agent_team_start_slices requires a non-empty workflowId."
  );
  if (isJsonToolResult(workflowId)) {
    return workflowId;
  }
  const cwdValue = readOptionalString(args.cwd, "agent_team_start_slices cwd");
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  const sliceIds =
    args.sliceIds === undefined
      ? undefined
      : readStringArray(args.sliceIds, "agent_team_start_slices sliceIds");
  if (sliceIds !== undefined && isJsonToolResult(sliceIds)) {
    return sliceIds;
  }
  const provider = readOptionalString(args.provider, "agent_team_start_slices provider");
  if (provider !== undefined && typeof provider !== "string") {
    return provider;
  }
  const timeoutMs = readOptionalTimeout(
    args.timeoutMs,
    "agent_team_start_slices timeoutMs must be positive."
  );
  if (timeoutMs !== undefined && typeof timeoutMs !== "number") {
    return timeoutMs;
  }
  const concurrency = readOptionalPositiveInteger(
    args.concurrency,
    "agent_team_start_slices concurrency"
  );
  if (concurrency !== undefined && typeof concurrency !== "number") {
    return concurrency;
  }
  if (typeof concurrency === "number" && concurrency > 8) {
    return validationError("agent_team_start_slices concurrency must be at most 8.");
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    workflowId,
    ...(sliceIds === undefined ? {} : { sliceIds }),
    ...(provider === undefined ? {} : { provider }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    concurrency: concurrency ?? 4,
    ...(deps.now === undefined ? {} : { now: deps.now })
  };
}

function parseDependencyEvidence(
  value: unknown
): readonly UnblockDependencyEvidenceInput[] | JsonToolResult {
  if (!Array.isArray(value) || value.length === 0) {
    return validationError("agent_team_unblock_slice requires non-empty dependencyEvidence.");
  }
  const evidence: UnblockDependencyEvidenceInput[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return validationError(`agent_team_unblock_slice dependencyEvidence[${index}] must be an object.`);
    }
    const entry = item as Record<string, unknown>;
    const dependencySliceId = readString(
      entry.dependencySliceId,
      `agent_team_unblock_slice dependencyEvidence[${index}].dependencySliceId`
    );
    if (isJsonToolResult(dependencySliceId)) {
      return dependencySliceId;
    }
    const summary = readString(
      entry.summary,
      `agent_team_unblock_slice dependencyEvidence[${index}].summary`
    );
    if (isJsonToolResult(summary)) {
      return summary;
    }
    const changedFiles =
      entry.changedFiles === undefined
        ? undefined
        : readStringArray(
            entry.changedFiles,
            `agent_team_unblock_slice dependencyEvidence[${index}].changedFiles`
          );
    if (changedFiles !== undefined && isJsonToolResult(changedFiles)) {
      return changedFiles;
    }
    const evidencePaths =
      entry.evidencePaths === undefined
        ? undefined
        : readStringArray(
            entry.evidencePaths,
            `agent_team_unblock_slice dependencyEvidence[${index}].evidencePaths`
          );
    if (evidencePaths !== undefined && isJsonToolResult(evidencePaths)) {
      return evidencePaths;
    }
    const sourceRunId = readOptionalString(
      entry.sourceRunId,
      `agent_team_unblock_slice dependencyEvidence[${index}].sourceRunId`
    );
    if (sourceRunId !== undefined && typeof sourceRunId !== "string") {
      return sourceRunId;
    }
    evidence.push({
      dependencySliceId,
      summary,
      ...(changedFiles === undefined ? {} : { changedFiles }),
      ...(evidencePaths === undefined ? {} : { evidencePaths }),
      ...(sourceRunId === undefined ? {} : { sourceRunId })
    });
  }
  return evidence;
}

function parseUnblockWorkflowSliceArgs(
  args: Record<string, unknown>,
  defaultCwd: string,
  deps: Pick<ToolDependencies, "now">
): UnblockWorkflowSliceInput | JsonToolResult {
  const workflowId = readString(
    args.workflowId,
    "agent_team_unblock_slice requires a non-empty workflowId."
  );
  if (isJsonToolResult(workflowId)) {
    return workflowId;
  }
  const sliceId = readString(args.sliceId, "agent_team_unblock_slice requires a non-empty sliceId.");
  if (isJsonToolResult(sliceId)) {
    return sliceId;
  }
  const cwdValue = readOptionalString(args.cwd, "agent_team_unblock_slice cwd");
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  const dependencyEvidence = parseDependencyEvidence(args.dependencyEvidence);
  if (isJsonToolResult(dependencyEvidence)) {
    return dependencyEvidence;
  }
  const notifyRunIds =
    args.notifyRunIds === undefined
      ? undefined
      : readStringArray(args.notifyRunIds, "agent_team_unblock_slice notifyRunIds");
  if (notifyRunIds !== undefined && isJsonToolResult(notifyRunIds)) {
    return notifyRunIds;
  }
  const message = readOptionalString(args.message, "agent_team_unblock_slice message");
  if (message !== undefined && typeof message !== "string") {
    return message;
  }
  const correlationId = readOptionalString(
    args.correlationId,
    "agent_team_unblock_slice correlationId"
  );
  if (correlationId !== undefined && typeof correlationId !== "string") {
    return correlationId;
  }
  const concurrency = readOptionalPositiveInteger(
    args.concurrency,
    "agent_team_unblock_slice concurrency"
  );
  if (concurrency !== undefined && typeof concurrency !== "number") {
    return concurrency;
  }
  if (typeof concurrency === "number" && concurrency > 8) {
    return validationError("agent_team_unblock_slice concurrency must be at most 8.");
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    workflowId,
    sliceId,
    dependencyEvidence,
    ...(notifyRunIds === undefined ? {} : { notifyRunIds }),
    ...(message === undefined ? {} : { message }),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(deps.now === undefined ? {} : { now: deps.now })
  };
}

function parseImplementationEvidence(
  value: unknown
): SliceImplementationEvidenceInput | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return validationError("agent_team_review_slice implementationEvidence must be an object.");
  }
  const evidence = value as Record<string, unknown>;
  const summary = readString(
    evidence.summary,
    "agent_team_review_slice implementationEvidence.summary"
  );
  if (isJsonToolResult(summary)) {
    return summary;
  }
  const changedFiles = readStringArray(
    evidence.changedFiles,
    "agent_team_review_slice implementationEvidence.changedFiles"
  );
  if (isJsonToolResult(changedFiles)) {
    return changedFiles;
  }
  const testsRun = readStringArray(
    evidence.testsRun,
    "agent_team_review_slice implementationEvidence.testsRun"
  );
  if (isJsonToolResult(testsRun)) {
    return testsRun;
  }
  const evidencePaths = readStringArray(
    evidence.evidencePaths,
    "agent_team_review_slice implementationEvidence.evidencePaths"
  );
  if (isJsonToolResult(evidencePaths)) {
    return evidencePaths;
  }
  const sourceRunId = readOptionalString(
    evidence.sourceRunId,
    "agent_team_review_slice implementationEvidence.sourceRunId"
  );
  if (sourceRunId !== undefined && typeof sourceRunId !== "string") {
    return sourceRunId;
  }
  const worktreePath = readOptionalString(
    evidence.worktreePath,
    "agent_team_review_slice implementationEvidence.worktreePath"
  );
  if (worktreePath !== undefined && typeof worktreePath !== "string") {
    return worktreePath;
  }
  const knownRisks =
    evidence.knownRisks === undefined
      ? undefined
      : readStringArray(
          evidence.knownRisks,
          "agent_team_review_slice implementationEvidence.knownRisks"
        );
  if (knownRisks !== undefined && isJsonToolResult(knownRisks)) {
    return knownRisks;
  }
  return {
    summary,
    changedFiles,
    testsRun,
    evidencePaths,
    ...(sourceRunId === undefined ? {} : { sourceRunId }),
    ...(worktreePath === undefined ? {} : { worktreePath }),
    ...(knownRisks === undefined ? {} : { knownRisks })
  };
}

function parseReviewVerdicts(value: unknown): readonly ReviewVerdictInput[] | JsonToolResult {
  const parsed = parseConsensusVerdicts(value);
  return parsed;
}

function parseReviewUserEscalations(
  value: unknown
): readonly ReviewUserEscalationInput[] | JsonToolResult | undefined {
  const parsed = parseConsensusUserEscalations(value);
  return parsed;
}

function parseReviewWorkflowSliceArgs(
  args: Record<string, unknown>,
  defaultCwd: string,
  deps: Pick<ToolDependencies, "now">
): ReviewWorkflowSliceInput | JsonToolResult {
  const workflowId = readString(
    args.workflowId,
    "agent_team_review_slice requires a non-empty workflowId."
  );
  if (isJsonToolResult(workflowId)) {
    return workflowId;
  }
  const sliceId = readString(args.sliceId, "agent_team_review_slice requires a non-empty sliceId.");
  if (isJsonToolResult(sliceId)) {
    return sliceId;
  }
  const cwdValue = readOptionalString(args.cwd, "agent_team_review_slice cwd");
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  const roundMode = readOptionalString(args.roundMode, "agent_team_review_slice roundMode");
  if (roundMode !== undefined && typeof roundMode !== "string") {
    return roundMode;
  }
  if (roundMode !== undefined && roundMode !== "default" && roundMode !== "extended") {
    return validationError("agent_team_review_slice roundMode must be default or extended.");
  }
  const implementationEvidence = parseImplementationEvidence(args.implementationEvidence);
  if (implementationEvidence !== undefined && isJsonToolResult(implementationEvidence)) {
    return implementationEvidence;
  }
  const codexDecision = parseCodexDecision(args.codexDecision);
  if (isJsonToolResult(codexDecision)) {
    return codexDecision;
  }
  const verdicts = parseReviewVerdicts(args.verdicts);
  if (isJsonToolResult(verdicts)) {
    return verdicts;
  }
  const seniorReviewerEvidence = parseSeniorReviewerEvidence(args.seniorReviewerEvidence);
  if (seniorReviewerEvidence !== undefined && isJsonToolResult(seniorReviewerEvidence)) {
    return seniorReviewerEvidence;
  }
  const userEscalations = parseReviewUserEscalations(args.userEscalations);
  if (userEscalations !== undefined && isJsonToolResult(userEscalations)) {
    return userEscalations;
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    workflowId,
    sliceId,
    ...(roundMode === undefined ? {} : { roundMode }),
    ...(implementationEvidence === undefined ? {} : { implementationEvidence }),
    codexDecision,
    verdicts,
    ...(seniorReviewerEvidence === undefined ? {} : { seniorReviewerEvidence }),
    ...(userEscalations === undefined ? {} : { userEscalations }),
    ...(deps.now === undefined ? {} : { now: deps.now })
  };
}

function parseBuildWorkflowIntegrationQueueArgs(
  args: Record<string, unknown>,
  defaultCwd: string,
  deps: Pick<ToolDependencies, "now">
): BuildWorkflowIntegrationQueueInput | JsonToolResult {
  const workflowId = readString(
    args.workflowId,
    "agent_team_integration_queue requires a non-empty workflowId."
  );
  if (isJsonToolResult(workflowId)) {
    return workflowId;
  }
  const cwdValue = readOptionalString(args.cwd, "agent_team_integration_queue cwd");
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  const sliceIds =
    args.sliceIds === undefined
      ? undefined
      : readStringArray(args.sliceIds, "agent_team_integration_queue sliceIds");
  if (sliceIds !== undefined && isJsonToolResult(sliceIds)) {
    return sliceIds;
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    workflowId,
    ...(sliceIds === undefined ? {} : { sliceIds }),
    ...(deps.now === undefined ? {} : { now: deps.now })
  };
}

function parseVerificationInput(value: unknown): readonly RecordWorkflowVerificationInput[] | JsonToolResult {
  if (!Array.isArray(value) || value.length === 0) {
    return validationError("agent_team_record_integration verification must be a non-empty array.");
  }
  const verification: RecordWorkflowVerificationInput[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return validationError(`agent_team_record_integration verification[${index}] must be an object.`);
    }
    const evidence = item as Record<string, unknown>;
    const command = readString(
      evidence.command,
      `agent_team_record_integration verification[${index}].command`
    );
    if (isJsonToolResult(command)) {
      return command;
    }
    const status = readString(
      evidence.status,
      `agent_team_record_integration verification[${index}].status`
    );
    if (isJsonToolResult(status)) {
      return status;
    }
    if (status !== "passed" && status !== "failed" && status !== "skipped") {
      return validationError(
        `agent_team_record_integration verification[${index}].status must be passed, failed, or skipped.`
      );
    }
    const summary = readString(
      evidence.summary,
      `agent_team_record_integration verification[${index}].summary`
    );
    if (isJsonToolResult(summary)) {
      return summary;
    }
    const evidencePath = readOptionalString(
      evidence.evidencePath,
      `agent_team_record_integration verification[${index}].evidencePath`
    );
    if (evidencePath !== undefined && typeof evidencePath !== "string") {
      return evidencePath;
    }
    verification.push({
      command,
      status,
      summary,
      ...(evidencePath === undefined ? {} : { evidencePath })
    });
  }
  return verification;
}

function parseRecordWorkflowIntegrationArgs(
  args: Record<string, unknown>,
  defaultCwd: string,
  deps: Pick<ToolDependencies, "now">
): RecordWorkflowIntegrationInput | JsonToolResult {
  const workflowId = readString(
    args.workflowId,
    "agent_team_record_integration requires a non-empty workflowId."
  );
  if (isJsonToolResult(workflowId)) {
    return workflowId;
  }
  const sliceId = readString(
    args.sliceId,
    "agent_team_record_integration requires a non-empty sliceId."
  );
  if (isJsonToolResult(sliceId)) {
    return sliceId;
  }
  const cwdValue = readOptionalString(args.cwd, "agent_team_record_integration cwd");
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  const integrationMethod = readString(
    args.integrationMethod,
    "agent_team_record_integration integrationMethod"
  );
  if (isJsonToolResult(integrationMethod)) {
    return integrationMethod;
  }
  const summary = readString(args.summary, "agent_team_record_integration summary");
  if (isJsonToolResult(summary)) {
    return summary;
  }
  const changedFiles = readStringArray(
    args.changedFiles,
    "agent_team_record_integration changedFiles"
  );
  if (isJsonToolResult(changedFiles)) {
    return changedFiles;
  }
  const verification = parseVerificationInput(args.verification);
  if (isJsonToolResult(verification)) {
    return verification;
  }
  const evidencePaths =
    args.evidencePaths === undefined
      ? undefined
      : readStringArray(args.evidencePaths, "agent_team_record_integration evidencePaths");
  if (evidencePaths !== undefined && isJsonToolResult(evidencePaths)) {
    return evidencePaths;
  }
  const retainedWorktreePath = readOptionalString(
    args.retainedWorktreePath,
    "agent_team_record_integration retainedWorktreePath"
  );
  if (retainedWorktreePath !== undefined && typeof retainedWorktreePath !== "string") {
    return retainedWorktreePath;
  }
  const cleanupRecommendation = readOptionalString(
    args.cleanupRecommendation,
    "agent_team_record_integration cleanupRecommendation"
  );
  if (cleanupRecommendation !== undefined && typeof cleanupRecommendation !== "string") {
    return cleanupRecommendation;
  }
  if (
    cleanupRecommendation !== undefined &&
    cleanupRecommendation !== "retain-for-review" &&
    cleanupRecommendation !== "eligible-after-evidence-saved" &&
    cleanupRecommendation !== "manual-cleanup-required"
  ) {
    return validationError(
      "agent_team_record_integration cleanupRecommendation must be retain-for-review, eligible-after-evidence-saved, or manual-cleanup-required."
    );
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    workflowId,
    sliceId,
    integrationMethod,
    summary,
    changedFiles,
    verification,
    ...(evidencePaths === undefined ? {} : { evidencePaths }),
    ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
    ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation }),
    ...(deps.now === undefined ? {} : { now: deps.now })
  };
}

function parseBuildWorkflowReportArgs(
  args: Record<string, unknown>,
  defaultCwd: string
): BuildWorkflowReportInput | JsonToolResult {
  const workflowId = readString(
    args.workflowId,
    "agent_team_workflow_report requires a non-empty workflowId."
  );
  if (isJsonToolResult(workflowId)) {
    return workflowId;
  }
  const cwdValue = readOptionalString(args.cwd, "agent_team_workflow_report cwd");
  if (cwdValue !== undefined && typeof cwdValue !== "string") {
    return cwdValue;
  }
  const includeWorkflow = readOptionalBoolean(
    args.includeWorkflow,
    "agent_team_workflow_report includeWorkflow must be a boolean."
  );
  if (includeWorkflow !== undefined && typeof includeWorkflow !== "boolean") {
    return includeWorkflow;
  }
  return {
    workspaceRoot: cwdValue ?? defaultCwd,
    workflowId,
    ...(includeWorkflow === undefined ? {} : { includeWorkflow })
  };
}

function readOptionalTimeout(
  value: unknown,
  message: string
): number | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || value <= 0) {
    return validationError(message);
  }
  return value;
}

function parseParallelStartArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentParallelStartRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_start_parallel requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_start_parallel cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const defaultProvider = readOptionalString(
    args.provider,
    "agent_team_start_parallel provider must be a string."
  );
  if (typeof defaultProvider === "object") {
    return defaultProvider;
  }

  const defaultTimeoutMs = readOptionalTimeout(
    args.timeoutMs,
    "agent_team_start_parallel timeoutMs must be a positive number."
  );
  if (typeof defaultTimeoutMs === "object") {
    return defaultTimeoutMs;
  }

  const concurrency = args.concurrency === undefined ? 3 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_start_parallel concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentParallelStartRun[] = [];
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_start_parallel runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.role !== "string" || !ROLE_IDS.has(run.role)) {
      return validationError(`agent_team_start_parallel runs[${index}] requires a valid role.`);
    }
    if (typeof run.task !== "string" || run.task.trim().length === 0) {
      return validationError(
        `agent_team_start_parallel runs[${index}] requires a non-empty task.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_start_parallel runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const itemProvider = readOptionalString(
      run.provider,
      `agent_team_start_parallel runs[${index}] provider must be a string.`
    );
    if (typeof itemProvider === "object") {
      return itemProvider;
    }

    const itemTimeoutMs = readOptionalTimeout(
      run.timeoutMs,
      `agent_team_start_parallel runs[${index}] timeoutMs must be a positive number.`
    );
    if (typeof itemTimeoutMs === "object") {
      return itemTimeoutMs;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_start_parallel runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const provider = itemProvider ?? defaultProvider;
    const timeoutMs = itemTimeoutMs ?? defaultTimeoutMs;
    runs.push({
      role: run.role as RoleId,
      task: run.task,
      cwd: itemCwd ?? defaultCwd ?? cwd,
      ...(provider === undefined ? {} : { provider }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    batchId: createRunId().replace(/^run_/, "batch_"),
    runs,
    concurrency
  };
}

function parseStatusManyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentStatusManyRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_status_many requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_status_many cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_status_many concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentStatusManyRun[] = [];
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_status_many runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_status_many runs[${index}] requires a non-empty runId.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_status_many runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_status_many runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    runs.push({
      runId: run.runId,
      cwd: itemCwd ?? defaultCwd ?? cwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    runs,
    concurrency
  };
}

function parseSummaryArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentTeamSummaryRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_summary requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_summary cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_summary concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentTeamSummaryRunRequest[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_summary runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(`agent_team_summary runs[${index}] requires a non-empty runId.`);
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_summary runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_summary runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_summary runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    runs,
    concurrency
  };
}

function parseCreateTeamArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentTeamCreateRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_create_team requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_create_team cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const name = readOptionalString(
    args.name,
    "agent_team_create_team name must be a string."
  );
  if (typeof name === "object") {
    return name;
  }

  const description = readOptionalString(
    args.description,
    "agent_team_create_team description must be a string."
  );
  if (typeof description === "object") {
    return description;
  }

  const runs: AgentTeamRunRef[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_create_team runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_create_team runs[${index}] requires a non-empty runId.`
      );
    }
    if (!isSafeRunId(run.runId)) {
      return validationError(
        `agent_team_create_team runs[${index}] requires a safe run_ id.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_create_team runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_create_team runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_create_team runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    cwd: defaultCwd ?? cwd,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    runs
  };
}

function parseTeamIdArgs(
  args: Record<string, unknown>,
  cwd: string,
  toolName: "agent_team_get_team"
): { readonly teamId: string; readonly cwd: string } | JsonToolResult {
  if (typeof args.teamId !== "string" || args.teamId.trim().length === 0) {
    return validationError(`${toolName} requires a non-empty teamId.`);
  }
  if (!isSafeTeamId(args.teamId)) {
    return validationError(`${toolName} requires a safe team_ id.`);
  }
  const workspaceRoot = readOptionalString(args.cwd, `${toolName} cwd must be a string.`);
  if (typeof workspaceRoot === "object") {
    return workspaceRoot;
  }
  return {
    teamId: args.teamId,
    cwd: workspaceRoot ?? cwd
  };
}

function parseListTeamsArgs(
  args: Record<string, unknown>,
  cwd: string
): { readonly cwd: string } | JsonToolResult {
  const workspaceRoot = readOptionalString(
    args.cwd,
    "agent_team_list_teams cwd must be a string."
  );
  if (typeof workspaceRoot === "object") {
    return workspaceRoot;
  }
  return {
    cwd: workspaceRoot ?? cwd
  };
}

function parseDashboardArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentTeamDashboardRequest | JsonToolResult {
  const hasTeamId = args.teamId !== undefined;
  const hasRuns = args.runs !== undefined;
  if (hasTeamId === hasRuns) {
    return validationError("agent_team_dashboard requires exactly one of teamId or runs.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_dashboard cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_dashboard concurrency must be an integer from 1 to 8."
    );
  }

  const workspaceRoot = defaultCwd ?? cwd;
  if (hasTeamId) {
    if (typeof args.teamId !== "string" || args.teamId.trim().length === 0) {
      return validationError("agent_team_dashboard requires a non-empty teamId.");
    }
    if (!isSafeTeamId(args.teamId)) {
      return validationError("agent_team_dashboard requires a safe team_ id.");
    }
    return {
      cwd: workspaceRoot,
      teamId: args.teamId,
      concurrency
    };
  }

  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_dashboard requires a non-empty runs array.");
  }

  const runs: AgentTeamSummaryRunRequest[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_dashboard runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_dashboard runs[${index}] requires a non-empty runId.`
      );
    }
    if (!isSafeRunId(run.runId)) {
      return validationError(
        `agent_team_dashboard runs[${index}] requires a safe run_ id.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_dashboard runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_dashboard runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? workspaceRoot;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_dashboard runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    cwd: workspaceRoot,
    runs,
    concurrency
  };
}

function parseMessageArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentMessageRequest | JsonToolResult {
  if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
    return validationError("agent_team_message requires a non-empty runId.");
  }
  if (typeof args.message !== "string" || args.message.trim().length === 0) {
    return validationError("agent_team_message requires a non-empty message.");
  }
  if (args.cwd !== undefined && typeof args.cwd !== "string") {
    return validationError("agent_team_message cwd must be a string.");
  }
  if (args.messageType !== undefined && typeof args.messageType !== "string") {
    return validationError("agent_team_message messageType must be a string.");
  }
  if (args.correlationId !== undefined && typeof args.correlationId !== "string") {
    return validationError("agent_team_message correlationId must be a string.");
  }

  return {
    runId: args.runId,
    cwd: args.cwd ?? cwd,
    message: args.message,
    ...(args.messageType === undefined ? {} : { messageType: args.messageType }),
    ...(args.correlationId === undefined ? {} : { correlationId: args.correlationId })
  };
}

function parseMessageManyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentMessageManyRequest | JsonToolResult {
  if (!Array.isArray(args.messages) || args.messages.length === 0) {
    return validationError("agent_team_message_many requires a non-empty messages array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_message_many cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_message_many concurrency must be an integer from 1 to 8."
    );
  }

  const messages: AgentMessageManyItemRequest[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.messages.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_message_many messages[${index}] must be an object.`);
    }

    const item = value as Record<string, unknown>;
    if (typeof item.runId !== "string" || item.runId.trim().length === 0) {
      return validationError(
        `agent_team_message_many messages[${index}] requires a non-empty runId.`
      );
    }
    if (typeof item.message !== "string" || item.message.trim().length === 0) {
      return validationError(
        `agent_team_message_many messages[${index}] requires a non-empty message.`
      );
    }

    const itemCwd = readOptionalString(
      item.cwd,
      `agent_team_message_many messages[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const messageType = readOptionalString(
      item.messageType,
      `agent_team_message_many messages[${index}] messageType must be a string.`
    );
    if (typeof messageType === "object") {
      return messageType;
    }

    const correlationId = readOptionalString(
      item.correlationId,
      `agent_team_message_many messages[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${item.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_message_many messages[${index}] duplicates target ${item.runId}.`
      );
    }
    seenTargets.add(targetKey);

    messages.push({
      runId: item.runId,
      cwd: resolvedCwd,
      message: item.message,
      ...(messageType === undefined ? {} : { messageType }),
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    messages,
    concurrency
  };
}

function parseCancelManyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentCancelManyRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_cancel_many requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_cancel_many cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_cancel_many concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentCancelManyRun[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_cancel_many runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_cancel_many runs[${index}] requires a non-empty runId.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_cancel_many runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_cancel_many runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_cancel_many runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    runs,
    concurrency
  };
}

function parseWindDownManyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentWindDownManyRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_wind_down_many requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_wind_down_many cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_wind_down_many concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentWindDownManyRun[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_wind_down_many runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_wind_down_many runs[${index}] requires a non-empty runId.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_wind_down_many runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_wind_down_many runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_wind_down_many runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    runs,
    concurrency
  };
}

function parseReplyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentReplyRequest | JsonToolResult {
  if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
    return validationError("agent_team_reply requires a non-empty runId.");
  }
  if (
    args.message !== undefined &&
    (typeof args.message !== "string" || args.message.trim().length === 0)
  ) {
    return validationError("agent_team_reply message must be a non-empty string when provided.");
  }
  if (args.cwd !== undefined && typeof args.cwd !== "string") {
    return validationError("agent_team_reply cwd must be a string.");
  }
  if (args.provider !== undefined && typeof args.provider !== "string") {
    return validationError("agent_team_reply provider must be a string.");
  }
  if (args.messageType !== undefined && typeof args.messageType !== "string") {
    return validationError("agent_team_reply messageType must be a string.");
  }
  if (args.correlationId !== undefined && typeof args.correlationId !== "string") {
    return validationError("agent_team_reply correlationId must be a string.");
  }
  if (
    args.timeoutMs !== undefined &&
    (typeof args.timeoutMs !== "number" || args.timeoutMs <= 0)
  ) {
    return validationError("agent_team_reply timeoutMs must be a positive number.");
  }

  return {
    runId: args.runId,
    cwd: args.cwd ?? cwd,
    ...(args.message === undefined ? {} : { message: args.message }),
    ...(args.messageType === undefined ? {} : { messageType: args.messageType }),
    ...(args.correlationId === undefined ? {} : { correlationId: args.correlationId }),
    ...(args.provider === undefined ? {} : { provider: args.provider }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  };
}

function parseCleanupArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentCleanupRequest | JsonToolResult {
  if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
    return validationError("agent_team_cleanup requires a non-empty runId.");
  }
  if (args.cwd !== undefined && typeof args.cwd !== "string") {
    return validationError("agent_team_cleanup cwd must be a string.");
  }
  if (typeof args.force !== "boolean") {
    return validationError("agent_team_cleanup force must be a boolean.");
  }

  return {
    runId: args.runId,
    cwd: args.cwd ?? cwd,
    force: args.force
  };
}

export function createToolHandlers(deps: ToolDependencies = {}): {
  readonly handleToolCall: (
    name: ToolName,
    args: Record<string, unknown>
  ) => Promise<JsonToolResult>;
} {
  const dispatch = deps.dispatch ?? dispatchReadOnlyAgent;
  const doctor = deps.doctor ?? runDoctor;
  const workflowCreate = deps.createWorkflow ?? createWorkflow;
  const workflowGet = deps.getWorkflow ?? getWorkflow;
  const workflowList = deps.listWorkflows ?? listWorkflows;
  const workflowConsensus = deps.planConsensus ?? planConsensus;
  const workflowStartSlices = deps.startWorkflowSlices ?? startWorkflowSlices;
  const workflowUnblockSlice = deps.unblockWorkflowSlice ?? unblockWorkflowSlice;
  const workflowReviewSlice = deps.reviewWorkflowSlice ?? reviewWorkflowSlice;
  const workflowIntegrationQueue =
    deps.buildWorkflowIntegrationQueue ?? buildWorkflowIntegrationQueue;
  const workflowRecordIntegration =
    deps.recordWorkflowIntegration ?? recordWorkflowIntegration;
  const workflowReport = deps.buildWorkflowReport ?? buildWorkflowReport;
  const cwd = deps.cwd ?? process.cwd;
  const lifecycleRegistry =
    deps.lifecycleRegistry ??
    (deps.lifecycleFactory === undefined
      ? defaultLifecycleRegistry
      : new LifecycleRegistry<LifecycleLike>({
          createLifecycle: deps.lifecycleFactory
        }));

  async function config(workspaceRoot: string): Promise<AgentTeamConfig> {
    return deps.config ?? loadAgentTeamConfig(workspaceRoot);
  }

  async function lifecycleFor(
    workspaceRoot: string
  ): Promise<LifecycleLike> {
    if (deps.lifecycle !== undefined) {
      return deps.lifecycle;
    }
    const resolvedConfig = await config(workspaceRoot);
    return lifecycleRegistry.get(workspaceRoot, resolvedConfig);
  }

  return {
    async handleToolCall(name, args): Promise<JsonToolResult> {
      if (name === "agent_team_list_roles") {
        return jsonToolResult({ roles: listRoles() });
      }

      if (name === "agent_team_list_providers") {
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError("agent_team_list_providers cwd must be a string.");
        }
        const workspaceRoot = args.cwd ?? cwd();
        return jsonToolResult({ providers: listProviders({ config: await config(workspaceRoot) }) });
      }

      if (name === "agent_team_doctor") {
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError("agent_team_doctor cwd must be a string.");
        }
        const workspaceRoot = args.cwd ?? cwd();
        return jsonToolResult({ ...(await doctor({ workspaceRoot })) });
      }

      if (name === "agent_team_dispatch") {
        const parsed = parseDispatchArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return jsonToolResult({ ...(await dispatch(parsed)) });
      }

      if (name === "agent_team_start") {
        const parsed = parseDispatchArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).startRun(parsed)) })
        });
      }

      if (name === "agent_team_start_parallel") {
        const parsed = parseParallelStartArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }

        return jsonToolResult({
          ...(await startAgentTeamInParallel(parsed, {
            startRun: async (request) =>
              (await lifecycleFor(request.cwd)).startRun(request)
          }))
        });
      }

      if (name === "agent_team_message") {
        const parsed = parseMessageArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          runId: parsed.runId,
          operation: name,
          action: async () =>
            jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).messageRun(parsed)) })
        });
      }

      if (name === "agent_team_message_many") {
        const parsed = parseMessageManyArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }

        return jsonToolResult({
          ...(await sendAgentMessages(parsed, {
            messageRun: async (request) =>
              (await lifecycleFor(request.cwd)).messageRun(request),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_reply") {
        const parsed = parseReplyArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          runId: parsed.runId,
          operation: name,
          action: async () =>
            jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).replyRun(parsed)) })
        });
      }

      if (name === "agent_team_status") {
        if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
          return validationError("agent_team_status requires a non-empty runId.");
        }
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError("agent_team_status cwd must be a string.");
        }
        const runId = args.runId;
        const workspaceRoot = args.cwd ?? cwd();
        return recoverableLifecycleTool({
          workspaceRoot,
          runId,
          operation: name,
          action: async () =>
            jsonToolResult({
              run: await (await lifecycleFor(workspaceRoot)).getStatus(
                workspaceRoot,
                runId
              )
            })
        });
      }

      if (name === "agent_team_status_many") {
        const parsed = parseStatusManyArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }

        return jsonToolResult({
          ...(await readAgentStatuses(parsed, {
            getStatus: async (workspaceRoot, runId) =>
              (await lifecycleFor(workspaceRoot)).getStatus(workspaceRoot, runId),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_summary") {
        const parsed = parseSummaryArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }

        return jsonToolResult({
          ...(await summarizeAgentTeam(parsed, {
            readRun: async (workspaceRoot, runId) =>
              readRunSidecar(workspaceRoot, runId),
            readMailbox: async (workspaceRoot, runId, kind) =>
              readMailboxRecords(workspaceRoot, runId, kind),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_create_team") {
        const parsed = parseCreateTeamArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await createAgentTeamRecord(parsed))
            })
        });
      }

      if (name === "agent_team_get_team") {
        const parsed = parseTeamIdArgs(args, cwd(), name);
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await getAgentTeamRecord(parsed))
            })
        });
      }

      if (name === "agent_team_list_teams") {
        const parsed = parseListTeamsArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await listAgentTeamRecords(parsed.cwd))
            })
        });
      }

      if (name === "agent_team_create_workflow") {
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError("agent_team_create_workflow cwd must be a string.");
        }
        const workspaceRoot = args.cwd ?? cwd();
        const parsed = parseCreateWorkflowArgs(
          args,
          cwd(),
          await config(workspaceRoot),
          deps
        );
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowCreate(parsed))
            })
        });
      }

      if (name === "agent_team_get_workflow") {
        const parsed = parseGetWorkflowArgs(args, cwd(), name);
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowGet(parsed))
            })
        });
      }

      if (name === "agent_team_list_workflows") {
        const parsed = parseListTeamsArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowList(parsed.cwd))
            })
        });
      }

      if (name === "agent_team_plan_consensus") {
        const parsed = parsePlanConsensusArgs(args, cwd(), deps);
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowConsensus(parsed))
            })
        });
      }

      if (name === "agent_team_start_slices") {
        const parsed = parseStartWorkflowSlicesArgs(args, cwd(), deps);
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowStartSlices(parsed, {
                startRun: async (request) =>
                  (await lifecycleFor(request.cwd)).startRun(request)
              }))
            })
        });
      }

      if (name === "agent_team_unblock_slice") {
        const parsed = parseUnblockWorkflowSliceArgs(args, cwd(), deps);
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowUnblockSlice(parsed, {
                messageRun: async (request) =>
                  (await lifecycleFor(request.cwd)).messageRun(request),
                recoverStateCorruption: async (input) => recoverStateCorruption(input)
              }))
            })
        });
      }

      if (name === "agent_team_review_slice") {
        const parsed = parseReviewWorkflowSliceArgs(args, cwd(), deps);
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowReviewSlice(parsed))
            })
        });
      }

      if (name === "agent_team_integration_queue") {
        const parsed = parseBuildWorkflowIntegrationQueueArgs(args, cwd(), deps);
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowIntegrationQueue(parsed))
            })
        });
      }

      if (name === "agent_team_record_integration") {
        const parsed = parseRecordWorkflowIntegrationArgs(args, cwd(), deps);
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowRecordIntegration(parsed))
            })
        });
      }

      if (name === "agent_team_workflow_report") {
        const parsed = parseBuildWorkflowReportArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.workspaceRoot,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await workflowReport(parsed))
            })
        });
      }

      if (name === "agent_team_dashboard") {
        const parsed = parseDashboardArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        try {
          const team =
            parsed.teamId === undefined
              ? undefined
              : (await getAgentTeamRecord({
                  cwd: parsed.cwd,
                  teamId: parsed.teamId
                })).team;
          const runs = team?.runs ?? parsed.runs ?? [];
          const summary = await summarizeAgentTeam(
            {
              runs,
              concurrency: parsed.concurrency
            },
            {
              readRun: async (workspaceRoot, runId) =>
                readRunSidecar(workspaceRoot, runId),
              readMailbox: async (workspaceRoot, runId, kind) =>
                readMailboxRecords(workspaceRoot, runId, kind),
              recoverStateCorruption: async (input) =>
                reportStateCorruption({ ...input, operation: name })
            }
          );
          return jsonToolResult({
            ...buildAgentTeamDashboard({
              source:
                team === undefined
                  ? { kind: "runs" }
                  : {
                      kind: "team",
                      teamId: team.teamId,
                      evidencePath: team.evidencePath
                    },
              summary,
              generatedAt: new Date().toISOString()
            })
          });
        } catch (error) {
          if (error instanceof StateCorruptionError) {
            const recovery = reportStateCorruption({
              workspaceRoot: parsed.cwd,
              operation: name,
              error
            });
            return jsonToolResult({
              ...buildAgentTeamDashboardStateCorrupt({
                source:
                  parsed.teamId === undefined
                    ? { kind: "runs" }
                    : {
                        kind: "team",
                        teamId: parsed.teamId,
                        evidencePath:
                          recovery.originalPath ?? teamRecordPath(parsed.cwd, parsed.teamId)
                      },
                issue: {
                  status: "state_corrupt",
                  target: "team_record",
                  recovery
                },
                generatedAt: new Date().toISOString()
              })
            });
          }
          throw error;
        }
      }

      if (name === "agent_team_cancel" || name === "agent_team_wind_down") {
        if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
          return validationError(`${name} requires a non-empty runId.`);
        }
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError(`${name} cwd must be a string.`);
        }
        const runId = args.runId;
        const workspaceRoot = args.cwd ?? cwd();
        return recoverableLifecycleTool({
          workspaceRoot,
          runId,
          operation: name,
          action: async () => {
            const lifecycle = await lifecycleFor(workspaceRoot);
            const result =
              name === "agent_team_cancel"
                ? await lifecycle.cancelRun(workspaceRoot, runId)
                : await lifecycle.windDownRun(workspaceRoot, runId);
            return jsonToolResult({ ...result });
          }
        });
      }

      if (name === "agent_team_cancel_many") {
        const parsed = parseCancelManyArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }

        return jsonToolResult({
          ...(await cancelAgentRuns(parsed, {
            cancelRun: async (workspaceRoot, runId) =>
              (await lifecycleFor(workspaceRoot)).cancelRun(workspaceRoot, runId),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_wind_down_many") {
        const parsed = parseWindDownManyArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }

        return jsonToolResult({
          ...(await windDownAgentRuns(parsed, {
            windDownRun: async (workspaceRoot, runId) =>
              (await lifecycleFor(workspaceRoot)).windDownRun(workspaceRoot, runId),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_cleanup") {
        const parsed = parseCleanupArgs(args, cwd());
        if (isJsonToolResult(parsed)) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          runId: parsed.runId,
          operation: name,
          action: async () => {
            const lifecycle = await lifecycleFor(parsed.cwd);
            if (lifecycle.cleanupRunWorkspace === undefined) {
              throw new Error("Lifecycle does not support workspace cleanup.");
            }
            return jsonToolResult({ ...(await lifecycle.cleanupRunWorkspace(parsed)) });
          }
        });
      }

      return jsonToolResult({
        status: "unknown_tool",
        tool: name
      });
    }
  };
}

export async function handleToolCall(
  name: ToolName,
  args: Record<string, unknown>
): Promise<JsonToolResult> {
  return createToolHandlers().handleToolCall(name, args);
}
