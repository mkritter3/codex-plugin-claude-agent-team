import type { AgentTeamConfig, RoleId } from "./types.js";
import { listRoles } from "./roles.js";
import { isSafeWorkflowId, workflowRecordPath } from "./state/paths.js";
import {
  listWorkflowRecords,
  readWorkflowRecord,
  writeWorkflowRecord
} from "./state/workflow-store.js";
import { deriveInitialSliceState } from "./workflow-planning-state.js";
import type {
  CodexRationaleCategory,
  WorkflowBlockedMode,
  WorkflowGoalPacket,
  WorkflowRecord,
  WorkflowRiskLevel,
  WorkflowSlice
} from "./workflow-types.js";
import { toWorkflowView, type WorkflowView } from "./workflow-view.js";

export interface CreateWorkflowSliceInput {
  readonly sliceId: string;
  readonly title: string;
  readonly ownerRole: string;
  readonly state?: string;
  readonly dependencies?: readonly string[];
  readonly writeScope: readonly string[];
  readonly readScope?: readonly string[];
  readonly acceptanceTests: readonly string[];
  readonly expectedEvidence: readonly string[];
  readonly riskLevel?: string;
  readonly requiredReviewers?: readonly string[];
  readonly integrationOrderHint?: number;
  readonly blockedMode?: string;
}

export interface CreateWorkflowInput {
  readonly workspaceRoot: string;
  readonly config: AgentTeamConfig;
  readonly goal: WorkflowGoalPacket;
  readonly slices: readonly CreateWorkflowSliceInput[];
  readonly name?: string;
  readonly workflowId?: string;
  readonly rationale?: string;
  readonly now?: () => Date;
  readonly createWorkflowId?: () => string;
}

export interface GetWorkflowInput {
  readonly workspaceRoot: string;
  readonly workflowId: string;
}

const ROLE_IDS = new Set<RoleId>(listRoles().map((role) => role.id));
const RISK_LEVELS = new Set<string>(["low", "medium", "high"]);
const BLOCKED_MODES = new Set<string>(["deferred-start", "prep-then-wait"]);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(
  value: readonly string[] | undefined,
  field: string,
  options: { readonly allowEmpty?: boolean } = {}
): readonly string[] {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
    throw new Error(`${field} must contain at least one item`);
  }
  return value.map((item, index) => requireNonEmptyString(item, `${field}[${index}]`));
}

function optionalStringArray(
  value: readonly string[] | undefined,
  field: string
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireStringArray(value, field);
}

function normalizeGoal(goal: WorkflowGoalPacket): WorkflowGoalPacket {
  return {
    title: requireNonEmptyString(goal.title, "goal.title"),
    successCriteria: requireStringArray(goal.successCriteria, "goal.successCriteria"),
    constraints: requireStringArray(goal.constraints, "goal.constraints"),
    nonGoals: requireStringArray(goal.nonGoals, "goal.nonGoals")
  };
}

function defaultWorkflowId(date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, "");
  return `workflow_${timestamp}`;
}

function normalizeWorkflowId(input: {
  readonly workflowId?: string;
  readonly createWorkflowId?: () => string;
  readonly now: Date;
}): string {
  const workflowId =
    input.workflowId ?? input.createWorkflowId?.() ?? defaultWorkflowId(input.now);
  if (!isSafeWorkflowId(workflowId)) {
    throw new Error(`Invalid workflow id: ${workflowId}`);
  }
  return workflowId;
}

function normalizeRiskLevel(value: string | undefined): WorkflowRiskLevel | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!RISK_LEVELS.has(value)) {
    throw new Error("riskLevel must be low, medium, or high");
  }
  return value as WorkflowRiskLevel;
}

function normalizeBlockedMode(value: string | undefined): WorkflowBlockedMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!BLOCKED_MODES.has(value)) {
    throw new Error("blockedMode must be deferred-start or prep-then-wait");
  }
  return value as WorkflowBlockedMode;
}

function normalizeSlices(slices: readonly CreateWorkflowSliceInput[]): readonly WorkflowSlice[] {
  if (!Array.isArray(slices) || slices.length === 0) {
    throw new Error("slices must contain at least one item");
  }

  const seen = new Set<string>();
  for (const slice of slices) {
    const sliceId = requireNonEmptyString(slice.sliceId, "sliceId");
    if (seen.has(sliceId)) {
      throw new Error(`Duplicate workflow slice id: ${sliceId}`);
    }
    seen.add(sliceId);
  }

  return slices.map((slice, index) => {
    const sliceId = requireNonEmptyString(slice.sliceId, `slices[${index}].sliceId`);
    const ownerRole = requireNonEmptyString(slice.ownerRole, `slices[${index}].ownerRole`);
    if (!ROLE_IDS.has(ownerRole as RoleId)) {
      throw new Error(`Invalid workflow slice owner role: ${ownerRole}`);
    }
    const dependencies = slice.dependencies ?? [];
    for (const dependency of dependencies) {
      if (dependency === sliceId) {
        throw new Error(`Workflow slice ${sliceId} cannot depend on itself`);
      }
      if (!seen.has(dependency)) {
        throw new Error(`Workflow slice ${sliceId} references unknown dependency ${dependency}`);
      }
    }

    const readScope = optionalStringArray(slice.readScope, `slices[${index}].readScope`);
    const requiredReviewers = optionalStringArray(
      slice.requiredReviewers,
      `slices[${index}].requiredReviewers`
    );
    const riskLevel = normalizeRiskLevel(slice.riskLevel);
    const blockedMode = normalizeBlockedMode(slice.blockedMode);

    return {
      sliceId,
      title: requireNonEmptyString(slice.title, `slices[${index}].title`),
      state: deriveInitialSliceState({
        dependencies,
        requestedState: slice.state
      }),
      ownerRole,
      dependencies,
      writeScope: requireStringArray(slice.writeScope, "writeScope", { allowEmpty: true }),
      ...(readScope === undefined ? {} : { readScope }),
      acceptanceTests: requireStringArray(slice.acceptanceTests, "acceptanceTests"),
      expectedEvidence: requireStringArray(slice.expectedEvidence, "expectedEvidence"),
      ...(riskLevel === undefined ? {} : { riskLevel }),
      ...(requiredReviewers === undefined ? {} : { requiredReviewers }),
      ...(slice.integrationOrderHint === undefined
        ? {}
        : { integrationOrderHint: slice.integrationOrderHint }),
      ...(blockedMode === undefined ? {} : { blockedMode })
    };
  });
}

export async function createWorkflow(input: CreateWorkflowInput): Promise<{
  readonly workflow: WorkflowView;
}> {
  const now = input.now?.() ?? new Date();
  const timestamp = now.toISOString();
  const workflowId = normalizeWorkflowId({
    ...(input.workflowId === undefined ? {} : { workflowId: input.workflowId }),
    ...(input.createWorkflowId === undefined ? {} : { createWorkflowId: input.createWorkflowId }),
    now
  });
  const path = workflowRecordPath(input.workspaceRoot, workflowId);
  const slices = normalizeSlices(input.slices);
  const relatedSliceIds = slices.map((slice) => slice.sliceId);
  const rationaleSummary =
    input.rationale === undefined
      ? undefined
      : requireNonEmptyString(input.rationale, "rationale");

  const record: WorkflowRecord = {
    workflowId,
    ...(input.name === undefined ? {} : { name: requireNonEmptyString(input.name, "name") }),
    createdAt: timestamp,
    updatedAt: timestamp,
    planningStatus: "draft",
    goal: normalizeGoal(input.goal),
    seniorReview: input.config.seniorReview,
    slices,
    consensusRounds: [],
    userEscalations: [],
    opusReviewEvidence: [],
    integrationQueue: [],
    codexRationale:
      rationaleSummary === undefined
        ? []
        : [
            {
              rationaleId: `${workflowId}_rationale_1`,
              createdAt: timestamp,
              category: "technical" satisfies CodexRationaleCategory,
              summary: rationaleSummary,
              relatedSliceIds
            }
          ],
    evidencePath: path
  };

  await writeWorkflowRecord(input.workspaceRoot, record);
  return { workflow: toWorkflowView(record) };
}

export async function getWorkflow(input: GetWorkflowInput): Promise<{
  readonly workflow: WorkflowView;
}> {
  return {
    workflow: toWorkflowView(
      await readWorkflowRecord(input.workspaceRoot, input.workflowId)
    )
  };
}

export async function listWorkflows(workspaceRoot: string): Promise<{
  readonly workflows: readonly WorkflowView[];
}> {
  return {
    workflows: (await listWorkflowRecords(workspaceRoot)).map(toWorkflowView)
  };
}
