import { isSafeWorkflowId } from "./state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "./state/workflow-store.js";
import type {
  WorkflowIntegrationQueueItem,
  WorkflowRecord,
  WorkflowRiskLevel,
  WorkflowSlice,
  WorkflowSliceState
} from "./workflow-types.js";
import { toWorkflowView, type WorkflowView } from "./workflow-view.js";

export interface BuildWorkflowIntegrationQueueInput {
  readonly workspaceRoot: string;
  readonly workflowId: string;
  readonly sliceIds?: readonly string[];
  readonly now?: () => Date;
}

export interface WorkflowIntegrationQueueExcluded {
  readonly sliceId: string;
  readonly state: WorkflowSliceState;
  readonly reason: string;
}

export interface BuildWorkflowIntegrationQueueResult {
  readonly workflow: WorkflowView;
  readonly queue: readonly WorkflowIntegrationQueueItem[];
  readonly excluded: readonly WorkflowIntegrationQueueExcluded[];
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
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

function selectSlices(record: WorkflowRecord, sliceIds: readonly string[] | undefined): readonly WorkflowSlice[] {
  if (record.planningStatus !== "approved") {
    throw new Error(`Workflow ${record.workflowId} must be approved before building an integration queue`);
  }
  if (sliceIds === undefined) {
    return record.slices.filter((slice) => slice.state === "approved");
  }
  if (!Array.isArray(sliceIds) || sliceIds.length === 0) {
    throw new Error("sliceIds must contain at least one item");
  }
  const seen = new Set<string>();
  const selected: WorkflowSlice[] = [];
  for (const item of sliceIds) {
    const sliceId = requireNonEmptyString(item, "sliceIds[]");
    if (seen.has(sliceId)) {
      throw new Error(`Duplicate workflow slice id: ${sliceId}`);
    }
    seen.add(sliceId);
    const slice = findSlice(record, sliceId);
    if (slice.state !== "approved") {
      throw new Error(`Workflow slice ${slice.sliceId} is ${slice.state}, not approved`);
    }
    selected.push(slice);
  }
  return selected;
}

function validateSelectedSlices(record: WorkflowRecord, selected: readonly WorkflowSlice[]): void {
  for (const slice of selected) {
    if (slice.implementationEvidence === undefined) {
      throw new Error(`Workflow slice ${slice.sliceId} requires implementation evidence before integration queueing`);
    }
    if (slice.implementationEvidence.worktreePath === undefined) {
      throw new Error(`Workflow slice ${slice.sliceId} requires retained worktree evidence before integration queueing`);
    }
    for (const dependencyId of slice.dependencies) {
      const dependency = findSlice(record, dependencyId);
      if (dependency.state !== "approved" && dependency.state !== "integrated") {
        throw new Error(`Workflow slice ${slice.sliceId} depends on ${dependencyId}, which is ${dependency.state}`);
      }
    }
  }
}

const RISK_WEIGHT: Record<WorkflowRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
};

function topologicalOrder(selected: readonly WorkflowSlice[], record: WorkflowRecord): readonly WorkflowSlice[] {
  const selectedIds = new Set(selected.map((slice) => slice.sliceId));
  const remaining = new Map(selected.map((slice) => [slice.sliceId, slice]));
  const ordered: WorkflowSlice[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((slice) =>
        slice.dependencies.every((dependencyId) => {
          if (!selectedIds.has(dependencyId)) {
            return true;
          }
          const dependency = findSlice(record, dependencyId);
          return dependency.state === "integrated" || !remaining.has(dependencyId);
        })
      )
      .sort(compareSlices);
    const next = ready[0];
    if (next === undefined) {
      throw new Error("Workflow integration queue contains a dependency cycle");
    }
    ordered.push(next);
    remaining.delete(next.sliceId);
  }

  return ordered;
}

function compareSlices(left: WorkflowSlice, right: WorkflowSlice): number {
  const leftHint = left.integrationOrderHint ?? Number.MAX_SAFE_INTEGER;
  const rightHint = right.integrationOrderHint ?? Number.MAX_SAFE_INTEGER;
  if (leftHint !== rightHint) {
    return leftHint - rightHint;
  }
  const leftRisk = RISK_WEIGHT[left.riskLevel ?? "medium"];
  const rightRisk = RISK_WEIGHT[right.riskLevel ?? "medium"];
  if (leftRisk !== rightRisk) {
    return leftRisk - rightRisk;
  }
  return left.sliceId.localeCompare(right.sliceId);
}

function overlaps(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function conflictRisk(input: {
  readonly slice: WorkflowSlice;
  readonly earlier: readonly WorkflowIntegrationQueueItem[];
}): { readonly risk: WorkflowRiskLevel; readonly reasons: readonly string[] } {
  const changedFiles = input.slice.implementationEvidence?.changedFiles ?? [];
  const reasons: string[] = [];
  for (const item of input.earlier) {
    const changedOverlap = overlaps(changedFiles, item.changedFiles ?? []);
    const earlierWriteScope = item.riskReasons
      ?.filter((reason) => reason.startsWith("scope:"))
      .map((reason) => reason.slice("scope:".length)) ?? [];
    const actualScopeOverlap = overlaps(input.slice.writeScope, earlierWriteScope);
    for (const scope of actualScopeOverlap) {
      reasons.push(`write scope overlaps earlier queued slice ${item.sliceId}: ${scope}`);
    }
    for (const file of changedOverlap) {
      reasons.push(`changed file overlaps earlier queued slice ${item.sliceId}: ${file}`);
    }
  }
  return {
    risk: reasons.length > 0 ? "high" : "low",
    reasons
  };
}

function queueItem(input: {
  readonly record: WorkflowRecord;
  readonly slice: WorkflowSlice;
  readonly position: number;
  readonly queuedAt: string;
  readonly earlier: readonly WorkflowIntegrationQueueItem[];
}): WorkflowIntegrationQueueItem {
  const implementation = input.slice.implementationEvidence;
  if (implementation === undefined || implementation.worktreePath === undefined) {
    throw new Error(`Workflow slice ${input.slice.sliceId} requires implementation evidence before integration queueing`);
  }
  const risk = conflictRisk({ slice: input.slice, earlier: input.earlier });
  const reviewRunIds = (input.slice.reviewEvidence ?? [])
    .flatMap((evidence) => evidence.reviewerRunIds ?? []);
  const scopeMarkers = input.slice.writeScope.map((scope) => `scope:${scope}`);
  return {
    queuePosition: input.position,
    sliceId: input.slice.sliceId,
    state: "queued",
    worktreePath: implementation.worktreePath,
    branchName: `codex/${input.record.workflowId}/${input.slice.sliceId}`,
    reviewRunIds,
    conflictRisk: risk.risk,
    riskReasons: [...scopeMarkers, ...risk.reasons],
    changedFiles: implementation.changedFiles,
    dependencySliceIds: input.slice.dependencies,
    focusedTests: [...input.slice.acceptanceTests, ...implementation.testsRun],
    queuedAt: input.queuedAt
  };
}

function excludedSlices(record: WorkflowRecord, selected: readonly WorkflowSlice[]): readonly WorkflowIntegrationQueueExcluded[] {
  const selectedIds = new Set(selected.map((slice) => slice.sliceId));
  return record.slices
    .filter((slice) => !selectedIds.has(slice.sliceId) && slice.state !== "integrated")
    .map((slice) => ({
      sliceId: slice.sliceId,
      state: slice.state,
      reason: slice.state === "approved"
        ? "slice was outside explicit selection"
        : `slice is ${slice.state}, not approved`
    }));
}

function publicQueue(item: WorkflowIntegrationQueueItem): WorkflowIntegrationQueueItem {
  const riskReasons = item.riskReasons?.filter((reason) => !reason.startsWith("scope:"));
  return {
    ...item,
    ...(riskReasons === undefined || riskReasons.length === 0 ? {} : { riskReasons })
  };
}

export async function buildWorkflowIntegrationQueue(
  input: BuildWorkflowIntegrationQueueInput
): Promise<BuildWorkflowIntegrationQueueResult> {
  if (!isSafeWorkflowId(input.workflowId)) {
    throw new Error(`Invalid workflow id: ${input.workflowId}`);
  }
  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  const selected = selectSlices(record, input.sliceIds);
  validateSelectedSlices(record, selected);
  const ordered = topologicalOrder(selected, record);
  const timestamp = (input.now?.() ?? new Date()).toISOString();
  const queue: WorkflowIntegrationQueueItem[] = [];
  for (const [index, slice] of ordered.entries()) {
    queue.push(queueItem({
      record,
      slice,
      position: index + 1,
      queuedAt: timestamp,
      earlier: queue
    }));
  }
  const publicItems = queue.map(publicQueue);
  const updated: WorkflowRecord = {
    ...record,
    updatedAt: timestamp,
    integrationQueue: publicItems
  };
  await writeWorkflowRecord(input.workspaceRoot, updated);
  return {
    workflow: toWorkflowView(updated),
    queue: publicItems,
    excluded: excludedSlices(record, selected)
  };
}
