import { startAgentTeamInParallel } from "./parallel-start.js";
import { sendAgentMessages } from "./message-many.js";
import { isSafeRunId, isSafeWorkflowId } from "./state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "./state/workflow-store.js";
import type { StateCorruptionRecoveryInput } from "./state/recovery.js";
import type {
  AgentDispatchRequest,
  AgentMessageManyItem,
  AgentMessageRequest,
  AgentMessageResult,
  AgentParallelStartRunResult,
  AgentStartResult,
  RoleId
} from "./types.js";
import type {
  WorkflowRecord,
  WorkflowSlice,
  WorkflowSliceRunEvidence,
  WorkflowSliceStartFailureEvidence,
  WorkflowSliceUnblockEvidence
} from "./workflow-types.js";
import { toWorkflowView, type WorkflowView } from "./workflow-view.js";

export interface StartWorkflowSlicesInput {
  readonly workspaceRoot: string;
  readonly workflowId: string;
  readonly sliceIds?: readonly string[];
  readonly provider?: string;
  readonly timeoutMs?: number;
  readonly concurrency: number;
  readonly now?: () => Date;
}

export interface StartWorkflowSlicesDependencies {
  readonly startRun: (request: AgentDispatchRequest) => Promise<AgentStartResult>;
}

export interface StartWorkflowSlicesStarted {
  readonly status: "started";
  readonly index: number;
  readonly sliceId: string;
  readonly run: AgentStartResult;
}

export interface StartWorkflowSlicesFailed {
  readonly status: "failed";
  readonly index: number;
  readonly sliceId: string;
  readonly error: string;
}

export type StartWorkflowSlicesItem =
  | StartWorkflowSlicesStarted
  | StartWorkflowSlicesFailed;

export interface StartWorkflowSlicesResult {
  readonly status: "started" | "partial_failure";
  readonly batchId: string;
  readonly concurrency: number;
  readonly slices: readonly StartWorkflowSlicesItem[];
  readonly workflow: WorkflowView;
}

export interface UnblockDependencyEvidenceInput {
  readonly dependencySliceId: string;
  readonly summary: string;
  readonly changedFiles?: readonly string[];
  readonly evidencePaths?: readonly string[];
  readonly sourceRunId?: string;
}

export interface UnblockWorkflowSliceInput {
  readonly workspaceRoot: string;
  readonly workflowId: string;
  readonly sliceId: string;
  readonly dependencyEvidence: readonly UnblockDependencyEvidenceInput[];
  readonly notifyRunIds?: readonly string[];
  readonly message?: string;
  readonly correlationId?: string;
  readonly concurrency?: number;
  readonly now?: () => Date;
}

export interface UnblockWorkflowSliceDependencies {
  readonly messageRun: (request: AgentMessageRequest) => Promise<AgentMessageResult>;
  readonly recoverStateCorruption?: (
    input: StateCorruptionRecoveryInput
  ) => Promise<unknown>;
}

export interface UnblockWorkflowSliceResult {
  readonly status: "ready" | "blocked" | "partial_failure";
  readonly sliceId: string;
  readonly workflow: WorkflowView;
  readonly notifications: readonly AgentMessageManyItem[];
}

const DEFAULT_CONCURRENCY = 4;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(
  value: readonly string[] | undefined,
  field: string
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must contain at least one item`);
  }
  return value.map((item, index) => requireNonEmptyString(item, `${field}[${index}]`));
}

function validateConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("concurrency must be an integer from 1 through 8");
  }
  return concurrency;
}

function findSlice(record: WorkflowRecord, sliceId: string): WorkflowSlice {
  const slice = record.slices.find((candidate) => candidate.sliceId === sliceId);
  if (slice === undefined) {
    throw new Error(`Unknown workflow slice id: ${sliceId}`);
  }
  return slice;
}

function selectSlices(record: WorkflowRecord, sliceIds: readonly string[] | undefined): readonly WorkflowSlice[] {
  if (record.planningStatus !== "approved") {
    throw new Error(`Workflow ${record.workflowId} must be approved before starting slices`);
  }

  if (sliceIds === undefined) {
    const ready = record.slices.filter((slice) => slice.state === "ready");
    if (ready.length === 0) {
      throw new Error("No ready workflow slices to start");
    }
    return ready;
  }

  if (!Array.isArray(sliceIds) || sliceIds.length === 0) {
    throw new Error("sliceIds must contain at least one item");
  }
  const seen = new Set<string>();
  const selected: WorkflowSlice[] = [];
  for (const sliceIdInput of sliceIds) {
    const sliceId = requireNonEmptyString(sliceIdInput, "sliceIds[]");
    if (seen.has(sliceId)) {
      throw new Error(`Duplicate workflow slice id: ${sliceId}`);
    }
    seen.add(sliceId);
    const slice = findSlice(record, sliceId);
    if (slice.state !== "ready") {
      throw new Error(`Workflow slice ${slice.sliceId} is ${slice.state}, not ready`);
    }
    selected.push(slice);
  }
  return selected;
}

function buildSliceTask(record: WorkflowRecord, slice: WorkflowSlice): string {
  return [
    `Workflow: ${record.goal.title}`,
    `Slice: ${slice.title} (${slice.sliceId})`,
    `Role: ${slice.ownerRole}`,
    `Write scope: ${slice.writeScope.join(", ")}`,
    `Read scope: ${(slice.readScope ?? []).join(", ") || "none specified"}`,
    `Dependencies: ${slice.dependencies.join(", ") || "none"}`,
    `Acceptance tests: ${slice.acceptanceTests.join("; ")}`,
    `Expected evidence: ${(slice.expectedEvidence ?? []).join("; ") || "focused tests and diff evidence"}`,
    "Operate only within the assigned write scope and retained isolated worktree policy."
  ].join("\n");
}

function runEvidence(run: AgentStartResult, startedAt: string): WorkflowSliceRunEvidence {
  return {
    runId: run.runId,
    startedAt,
    provider: run.provider,
    role: run.role,
    sidecarPath: run.sidecarPath,
    logPath: run.logPath,
    ...(run.executionCwd === undefined ? {} : { executionCwd: run.executionCwd }),
    ...(run.transcriptPath === undefined ? {} : { transcriptPath: run.transcriptPath }),
    mailboxPaths: run.mailboxPaths
  };
}

function updateSliceAfterStart(
  slice: WorkflowSlice,
  item: AgentParallelStartRunResult,
  timestamp: string
): WorkflowSlice {
  if (item.status === "started") {
    return {
      ...slice,
      state: "running",
      runIds: [...(slice.runIds ?? []), item.run.runId],
      runEvidence: [...(slice.runEvidence ?? []), runEvidence(item.run, timestamp)]
    };
  }
  const failure: WorkflowSliceStartFailureEvidence = {
    failedAt: timestamp,
    error: item.error
  };
  return {
    ...slice,
    state: "failed",
    startFailureEvidence: [...(slice.startFailureEvidence ?? []), failure]
  };
}

export async function startWorkflowSlices(
  input: StartWorkflowSlicesInput,
  deps: StartWorkflowSlicesDependencies
): Promise<StartWorkflowSlicesResult> {
  if (!isSafeWorkflowId(input.workflowId)) {
    throw new Error(`Invalid workflow id: ${input.workflowId}`);
  }
  const concurrency = validateConcurrency(input.concurrency);
  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  const selected = selectSlices(record, input.sliceIds);
  const providers = new Map<string, string>();
  if (record.orchestration !== undefined) {
    for (const slice of selected) {
      const target = slice.implementationTarget ?? record.orchestration.implementation;
      if (target.kind === "native") throw new Error(`Slice ${slice.sliceId} selects a native model; use prepare_assignments, host agent tools and record_native_implementation`);
      if (input.provider !== undefined && input.provider !== target.provider) throw new Error("Implementation provider differs from the selected target; prepare an explicit override first");
      providers.set(slice.sliceId, target.provider);
    }
  }
  const timestamp = (input.now?.() ?? new Date()).toISOString();
  const batchId = `${record.workflowId}_slices`;

  const started = await startAgentTeamInParallel(
    {
      batchId,
      concurrency,
      runs: selected.map((slice) => ({
        role: slice.ownerRole as RoleId,
        task: buildSliceTask(record, slice),
        cwd: input.workspaceRoot,
        correlationId: slice.sliceId,
        ...(providers.get(slice.sliceId) === undefined && input.provider === undefined ? {} : { provider: providers.get(slice.sliceId) ?? input.provider! }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        workflowId: record.workflowId,
        sliceId: slice.sliceId,
        writeScope: slice.writeScope
      }))
    },
    deps
  );

  const bySliceId = new Map<string, WorkflowSlice>();
  for (const [index, slice] of selected.entries()) {
    const item = started.runs[index];
    if (item === undefined) {
      continue;
    }
    bySliceId.set(slice.sliceId, updateSliceAfterStart(slice, item, timestamp));
  }

  const updated: WorkflowRecord = {
    ...record,
    updatedAt: timestamp,
    slices: record.slices.map((slice) => bySliceId.get(slice.sliceId) ?? slice)
  };
  await writeWorkflowRecord(input.workspaceRoot, updated);

  const results: StartWorkflowSlicesItem[] = started.runs.map((item, index) => {
    const sliceId = selected[index]?.sliceId ?? `slice_${index}`;
    return item.status === "started"
      ? {
          status: "started",
          index,
          sliceId,
          run: item.run
        }
      : {
          status: "failed",
          index,
          sliceId,
          error: item.error
        };
  });

  return {
    status: started.status,
    batchId,
    concurrency,
    slices: results,
    workflow: toWorkflowView(updated)
  };
}

function normalizeUnblockEvidence(
  input: readonly UnblockDependencyEvidenceInput[],
  target: WorkflowSlice,
  timestamp: string
): readonly WorkflowSliceUnblockEvidence[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("dependencyEvidence must contain at least one item");
  }
  return input.map((item, index) => {
    const dependencySliceId = requireNonEmptyString(
      item.dependencySliceId,
      `dependencyEvidence[${index}].dependencySliceId`
    );
    if (!target.dependencies.includes(dependencySliceId)) {
      throw new Error(`Workflow slice ${target.sliceId} does not depend on ${dependencySliceId}`);
    }
    const sourceRunId =
      item.sourceRunId === undefined
        ? undefined
        : requireNonEmptyString(item.sourceRunId, `dependencyEvidence[${index}].sourceRunId`);
    if (sourceRunId !== undefined && !isSafeRunId(sourceRunId)) {
      throw new Error(`Invalid source run id: ${sourceRunId}`);
    }
    const changedFiles = requireStringArray(
      item.changedFiles,
      `dependencyEvidence[${index}].changedFiles`
    );
    const evidencePaths = requireStringArray(
      item.evidencePaths,
      `dependencyEvidence[${index}].evidencePaths`
    );
    return {
      dependencySliceId,
      recordedAt: timestamp,
      summary: requireNonEmptyString(item.summary, `dependencyEvidence[${index}].summary`),
      ...(changedFiles === undefined ? {} : { changedFiles }),
      ...(evidencePaths === undefined ? {} : { evidencePaths }),
      ...(sourceRunId === undefined ? {} : { sourceRunId })
    };
  });
}

function dependenciesSatisfied(
  record: WorkflowRecord,
  target: WorkflowSlice,
  evidence: readonly WorkflowSliceUnblockEvidence[]
): boolean {
  const evidenceDeps = new Set([
    ...(target.unblockEvidence ?? []).map((item) => item.dependencySliceId),
    ...evidence.map((item) => item.dependencySliceId)
  ]);
  return target.dependencies.every((dependencyId) => {
    const dependency = findSlice(record, dependencyId);
    return (
      dependency.state === "approved" ||
      dependency.state === "integrated" ||
      evidenceDeps.has(dependencyId)
    );
  });
}

function normalizeNotifyRunIds(runIds: readonly string[] | undefined): readonly string[] {
  if (runIds === undefined) {
    return [];
  }
  if (!Array.isArray(runIds)) {
    throw new Error("notifyRunIds must be an array");
  }
  const seen = new Set<string>();
  return runIds.map((runIdInput, index) => {
    const runId = requireNonEmptyString(runIdInput, `notifyRunIds[${index}]`);
    if (!isSafeRunId(runId)) {
      throw new Error(`Invalid notify run id: ${runId}`);
    }
    if (seen.has(runId)) {
      throw new Error(`Duplicate notify run id: ${runId}`);
    }
    seen.add(runId);
    return runId;
  });
}

export async function unblockWorkflowSlice(
  input: UnblockWorkflowSliceInput,
  deps: UnblockWorkflowSliceDependencies
): Promise<UnblockWorkflowSliceResult> {
  if (!isSafeWorkflowId(input.workflowId)) {
    throw new Error(`Invalid workflow id: ${input.workflowId}`);
  }
  const concurrency = validateConcurrency(input.concurrency);
  const notifyRunIds = normalizeNotifyRunIds(input.notifyRunIds);
  const timestamp = (input.now?.() ?? new Date()).toISOString();
  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  const target = findSlice(record, requireNonEmptyString(input.sliceId, "sliceId"));
  if (target.state !== "blocked") {
    throw new Error(`Workflow slice ${target.sliceId} is ${target.state}, not blocked`);
  }

  const evidence = normalizeUnblockEvidence(input.dependencyEvidence, target, timestamp);
  const nextState = dependenciesSatisfied(record, target, evidence) ? "ready" : "blocked";
  const updatedTarget: WorkflowSlice = {
    ...target,
    state: nextState,
    unblockEvidence: [...(target.unblockEvidence ?? []), ...evidence]
  };
  const updated: WorkflowRecord = {
    ...record,
    updatedAt: timestamp,
    slices: record.slices.map((slice) =>
      slice.sliceId === target.sliceId ? updatedTarget : slice
    )
  };
  await writeWorkflowRecord(input.workspaceRoot, updated);

  const defaultMessage = [
    `Workflow slice ${target.sliceId} is ${nextState}.`,
    `Dependency evidence: ${evidence.map((item) => `${item.dependencySliceId}: ${item.summary}`).join(" | ")}`,
    "Re-check current source state before editing."
  ].join("\n");
  const notifications =
    notifyRunIds.length === 0
      ? []
      : (
          await sendAgentMessages(
            {
              concurrency,
              messages: notifyRunIds.map((runId) => ({
                runId,
                cwd: input.workspaceRoot,
                message: input.message ?? defaultMessage,
                messageType: "workflow_slice_unblocked",
                ...(input.correlationId === undefined
                  ? {}
                  : { correlationId: input.correlationId })
              }))
            },
            {
              messageRun: deps.messageRun,
              recoverStateCorruption:
                deps.recoverStateCorruption ??
                (async (recoveryInput) => ({
                  status: "state_corrupt",
                  operation: recoveryInput.operation
                }))
            }
          )
        ).messages;

  const hasNotificationFailure = notifications.some((item) => item.status !== "ok");

  return {
    status: hasNotificationFailure ? "partial_failure" : nextState,
    sliceId: target.sliceId,
    workflow: toWorkflowView(updated),
    notifications
  };
}
