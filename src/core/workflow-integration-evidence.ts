import { isSafeWorkflowId } from "./state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "./state/workflow-store.js";
import type {
  WorkflowCleanupRecommendation,
  WorkflowIntegrationQueueItem,
  WorkflowRecord,
  WorkflowSlice,
  WorkflowSliceIntegrationEvidence,
  WorkflowVerificationEvidence,
  WorkflowVerificationStatus
} from "./workflow-types.js";
import { toWorkflowView, type WorkflowSliceView, type WorkflowView } from "./workflow-view.js";

export interface RecordWorkflowVerificationInput {
  readonly command: string;
  readonly status: WorkflowVerificationStatus;
  readonly summary: string;
  readonly evidencePath?: string;
}

export interface RecordWorkflowIntegrationInput {
  readonly workspaceRoot: string;
  readonly workflowId: string;
  readonly sliceId: string;
  readonly integrationMethod: string;
  readonly summary: string;
  readonly changedFiles: readonly string[];
  readonly verification: readonly RecordWorkflowVerificationInput[];
  readonly evidencePaths?: readonly string[];
  readonly retainedWorktreePath?: string;
  readonly cleanupRecommendation?: WorkflowCleanupRecommendation;
  readonly now?: () => Date;
}

export interface RecordWorkflowIntegrationResult {
  readonly workflow: WorkflowView;
  readonly slice: WorkflowSliceView;
  readonly queueItem: WorkflowIntegrationQueueItem;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireNonEmptyStringArray(value: readonly string[] | undefined, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must contain at least one item`);
  }
  return value.map((item, index) => requireNonEmptyString(item, `${field}[${index}]`));
}

function findSlice(record: WorkflowRecord, sliceId: string): WorkflowSlice {
  const slice = record.slices.find((candidate) => candidate.sliceId === sliceId);
  if (slice === undefined) {
    throw new Error(`Unknown workflow slice id: ${sliceId}`);
  }
  return slice;
}

function findQueueItem(
  record: WorkflowRecord,
  sliceId: string
): { readonly item: WorkflowIntegrationQueueItem; readonly index: number } {
  const index = record.integrationQueue.findIndex((item) => item.sliceId === sliceId);
  if (index < 0) {
    throw new Error(`Workflow slice ${sliceId} must be queued before recording integration evidence`);
  }
  return {
    item: record.integrationQueue[index]!,
    index
  };
}

function verificationEvidence(
  verification: readonly RecordWorkflowVerificationInput[],
  sliceId: string
): readonly WorkflowVerificationEvidence[] {
  if (!Array.isArray(verification) || verification.length === 0) {
    throw new Error(`Workflow slice ${sliceId} requires final verification evidence before integrated marking`);
  }
  const evidence = verification.map((item, index) => ({
    command: requireNonEmptyString(item.command, `verification[${index}].command`),
    status: item.status,
    summary: requireNonEmptyString(item.summary, `verification[${index}].summary`),
    ...(item.evidencePath === undefined
      ? {}
      : { evidencePath: requireNonEmptyString(item.evidencePath, `verification[${index}].evidencePath`) })
  }));
  const failed = evidence.find((item) => item.status !== "passed");
  if (failed !== undefined) {
    throw new Error(`Workflow slice ${sliceId} cannot be marked integrated with failed verification`);
  }
  return evidence;
}

export async function recordWorkflowIntegration(
  input: RecordWorkflowIntegrationInput
): Promise<RecordWorkflowIntegrationResult> {
  if (!isSafeWorkflowId(input.workflowId)) {
    throw new Error(`Invalid workflow id: ${input.workflowId}`);
  }
  const sliceId = requireNonEmptyString(input.sliceId, "sliceId");
  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  if (record.planningStatus !== "approved") {
    throw new Error(`Workflow ${record.workflowId} must be approved before recording integration evidence`);
  }
  const slice = findSlice(record, sliceId);
  if (slice.state !== "approved") {
    throw new Error(`Workflow slice ${slice.sliceId} is ${slice.state}, not approved`);
  }
  if (slice.implementationEvidence === undefined) {
    throw new Error(`Workflow slice ${slice.sliceId} requires implementation evidence before integration recording`);
  }
  const retainedWorktreePath =
    input.retainedWorktreePath ?? slice.implementationEvidence.worktreePath;
  if (retainedWorktreePath === undefined) {
    throw new Error(`Workflow slice ${slice.sliceId} requires retained worktree evidence before integration recording`);
  }
  const queue = findQueueItem(record, slice.sliceId);
  if (queue.item.state !== "queued" && queue.item.state !== "integrating") {
    throw new Error(`Workflow slice ${slice.sliceId} queue item is ${queue.item.state}, not queued`);
  }
  const changedFiles = requireNonEmptyStringArray(input.changedFiles, "changedFiles");
  const evidencePaths =
    input.evidencePaths === undefined
      ? undefined
      : requireNonEmptyStringArray(input.evidencePaths, "evidencePaths");
  const timestamp = (input.now?.() ?? new Date()).toISOString();
  const integrationEvidence: WorkflowSliceIntegrationEvidence = {
    integratedAt: timestamp,
    integrationMethod: requireNonEmptyString(input.integrationMethod, "integrationMethod"),
    summary: requireNonEmptyString(input.summary, "summary"),
    changedFiles,
    verification: verificationEvidence(input.verification, slice.sliceId),
    ...(evidencePaths === undefined ? {} : { evidencePaths }),
    retainedWorktreePath: requireNonEmptyString(retainedWorktreePath, "retainedWorktreePath"),
    ...(input.cleanupRecommendation === undefined
      ? {}
      : { cleanupRecommendation: input.cleanupRecommendation })
  };
  const updatedSlice: WorkflowSlice = {
    ...slice,
    state: "integrated",
    integrationEvidence: [...(slice.integrationEvidence ?? []), integrationEvidence]
  };
  const updatedQueueItem: WorkflowIntegrationQueueItem = {
    ...queue.item,
    state: "integrated",
    integratedAt: timestamp,
    finalGateStatus: "passed",
    ...(evidencePaths === undefined ? {} : { integrationEvidencePaths: evidencePaths }),
    ...(input.cleanupRecommendation === undefined
      ? {}
      : { cleanupRecommendation: input.cleanupRecommendation })
  };
  const updatedRecord: WorkflowRecord = {
    ...record,
    updatedAt: timestamp,
    slices: record.slices.map((candidate) =>
      candidate.sliceId === updatedSlice.sliceId ? updatedSlice : candidate
    ),
    integrationQueue: record.integrationQueue.map((item, index) =>
      index === queue.index ? updatedQueueItem : item
    )
  };
  await writeWorkflowRecord(input.workspaceRoot, updatedRecord);
  const workflow = toWorkflowView(updatedRecord);
  const updatedSliceView = workflow.slices.find((candidate) => candidate.sliceId === slice.sliceId);
  if (updatedSliceView === undefined) {
    throw new Error(`Workflow slice ${slice.sliceId} was not found after integration recording`);
  }
  return {
    workflow,
    slice: updatedSliceView,
    queueItem: updatedQueueItem
  };
}
