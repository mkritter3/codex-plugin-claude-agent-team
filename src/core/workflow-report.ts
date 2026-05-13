import { isSafeWorkflowId } from "./state/paths.js";
import { readWorkflowRecord } from "./state/workflow-store.js";
import type {
  WorkflowCleanupRecommendation,
  WorkflowIntegrationQueueItem,
  WorkflowRecord,
  WorkflowSlice,
  WorkflowSliceState
} from "./workflow-types.js";
import { toWorkflowView, type WorkflowView } from "./workflow-view.js";

export type WorkflowCompletionStatus = "complete" | "incomplete" | "blocked";

export type WorkflowReportCategory =
  | "integrated"
  | "cleanup-ready"
  | "ready-to-integrate"
  | "in-progress"
  | "blocked"
  | "deferred"
  | "missing-evidence";

export interface BuildWorkflowReportInput {
  readonly workspaceRoot: string;
  readonly workflowId: string;
  readonly includeWorkflow?: boolean;
}

export interface WorkflowReportCounts {
  readonly total: number;
  readonly integrated: number;
  readonly readyToIntegrate: number;
  readonly inProgress: number;
  readonly blocked: number;
  readonly deferred: number;
  readonly missingEvidence: number;
  readonly cleanupReady: number;
}

export interface WorkflowReportRow {
  readonly sliceId: string;
  readonly title: string;
  readonly state: WorkflowSliceState;
  readonly category: WorkflowReportCategory;
  readonly completionReady: boolean;
  readonly blockers: readonly string[];
  readonly reasons: readonly string[];
  readonly evidencePaths: readonly string[];
  readonly retainedWorktreePath?: string;
  readonly cleanupRecommendation?: WorkflowCleanupRecommendation;
}

export interface BuildWorkflowReportResult {
  readonly workflowId: string;
  readonly completionStatus: WorkflowCompletionStatus;
  readonly counts: WorkflowReportCounts;
  readonly rows: readonly WorkflowReportRow[];
  readonly report: string;
  readonly workflow?: WorkflowView;
}

function queueItemFor(
  record: WorkflowRecord,
  sliceId: string
): WorkflowIntegrationQueueItem | undefined {
  return record.integrationQueue.find((item) => item.sliceId === sliceId);
}

function integrationEvidencePaths(slice: WorkflowSlice): readonly string[] {
  return (slice.integrationEvidence ?? []).flatMap((evidence) => evidence.evidencePaths ?? []);
}

function latestRetainedWorktreePath(slice: WorkflowSlice): string | undefined {
  const latestIntegration = slice.integrationEvidence?.at(-1);
  return latestIntegration?.retainedWorktreePath ?? slice.implementationEvidence?.worktreePath;
}

function latestCleanupRecommendation(
  slice: WorkflowSlice,
  queueItem: WorkflowIntegrationQueueItem | undefined
): WorkflowCleanupRecommendation | undefined {
  return slice.integrationEvidence?.at(-1)?.cleanupRecommendation ?? queueItem?.cleanupRecommendation;
}

function hasPassedFinalVerification(slice: WorkflowSlice): boolean {
  const integrationEvidence = slice.integrationEvidence ?? [];
  if (integrationEvidence.length === 0) {
    return false;
  }
  return integrationEvidence.every((evidence) =>
    evidence.verification.length > 0 &&
    evidence.verification.every((verification) => verification.status === "passed")
  );
}

function rowForSlice(record: WorkflowRecord, slice: WorkflowSlice): WorkflowReportRow {
  const queueItem = queueItemFor(record, slice.sliceId);
  const cleanupRecommendation = latestCleanupRecommendation(slice, queueItem);
  const retainedWorktreePath = latestRetainedWorktreePath(slice);
  const evidencePaths = integrationEvidencePaths(slice);
  const blockers = slice.blockedBy ?? [];
  if (slice.state === "integrated") {
    if ((slice.integrationEvidence ?? []).length === 0) {
      return {
        sliceId: slice.sliceId,
        title: slice.title,
        state: slice.state,
        category: "missing-evidence",
        completionReady: false,
        blockers,
        reasons: ["integrated slice is missing integration evidence"],
        evidencePaths,
        ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
        ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation })
      };
    }
    if (!hasPassedFinalVerification(slice)) {
      return {
        sliceId: slice.sliceId,
        title: slice.title,
        state: slice.state,
        category: "missing-evidence",
        completionReady: false,
        blockers,
        reasons: ["final verification is not fully passed"],
        evidencePaths,
        ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
        ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation })
      };
    }
    const cleanupReady = cleanupRecommendation === "eligible-after-evidence-saved";
    return {
      sliceId: slice.sliceId,
      title: slice.title,
      state: slice.state,
      category: cleanupReady ? "cleanup-ready" : "integrated",
      completionReady: true,
      blockers,
      reasons: cleanupReady
        ? ["slice is integrated and retained worktree can be cleaned up after operator approval"]
        : ["slice is integrated with passing final verification"],
      evidencePaths,
      ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
      ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation })
    };
  }

  if (
    slice.state === "blocked" ||
    slice.state === "failed" ||
    slice.state === "cancelled" ||
    slice.state === "needs-revision"
  ) {
    return {
      sliceId: slice.sliceId,
      title: slice.title,
      state: slice.state,
      category: "blocked",
      completionReady: false,
      blockers,
      reasons: [`slice is ${slice.state}`],
      evidencePaths,
      ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
      ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation })
    };
  }

  if (slice.state === "approved" && queueItem?.state === "queued") {
    return {
      sliceId: slice.sliceId,
      title: slice.title,
      state: slice.state,
      category: "ready-to-integrate",
      completionReady: false,
      blockers,
      reasons: ["slice is queued for Codex-owned integration"],
      evidencePaths,
      ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
      ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation })
    };
  }

  if (slice.state === "planned" || slice.state === "ready" || slice.state === "approved") {
    return {
      sliceId: slice.sliceId,
      title: slice.title,
      state: slice.state,
      category: "deferred",
      completionReady: false,
      blockers,
      reasons: [`slice is ${slice.state}`],
      evidencePaths,
      ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
      ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation })
    };
  }

  return {
    sliceId: slice.sliceId,
    title: slice.title,
    state: slice.state,
    category: "in-progress",
    completionReady: false,
    blockers,
    reasons: [`slice is ${slice.state}`],
    evidencePaths,
    ...(retainedWorktreePath === undefined ? {} : { retainedWorktreePath }),
    ...(cleanupRecommendation === undefined ? {} : { cleanupRecommendation })
  };
}

function countsFor(rows: readonly WorkflowReportRow[]): WorkflowReportCounts {
  return {
    total: rows.length,
    integrated: rows.filter((row) => row.category === "integrated" || row.category === "cleanup-ready").length,
    readyToIntegrate: rows.filter((row) => row.category === "ready-to-integrate").length,
    inProgress: rows.filter((row) => row.category === "in-progress").length,
    blocked: rows.filter((row) => row.category === "blocked").length,
    deferred: rows.filter((row) => row.category === "deferred").length,
    missingEvidence: rows.filter((row) => row.category === "missing-evidence").length,
    cleanupReady: rows.filter((row) => row.category === "cleanup-ready").length
  };
}

function completionStatus(
  record: WorkflowRecord,
  rows: readonly WorkflowReportRow[]
): WorkflowCompletionStatus {
  if (rows.some((row) => row.category === "blocked")) {
    return "blocked";
  }
  if (record.planningStatus !== "approved") {
    return "incomplete";
  }
  return rows.every((row) => row.completionReady) ? "complete" : "incomplete";
}

function reportText(input: {
  readonly workflowId: string;
  readonly status: WorkflowCompletionStatus;
  readonly counts: WorkflowReportCounts;
}): string {
  const statusLine =
    input.status === "complete"
      ? `Workflow ${input.workflowId} is complete.`
      : input.status === "blocked"
        ? `Workflow ${input.workflowId} is blocked.`
        : `Workflow ${input.workflowId} is incomplete.`;
  return [
    statusLine,
    `total: ${input.counts.total}`,
    `integrated: ${input.counts.integrated}`,
    `ready-to-integrate: ${input.counts.readyToIntegrate}`,
    `in-progress: ${input.counts.inProgress}`,
    `blocked: ${input.counts.blocked}`,
    `deferred: ${input.counts.deferred}`,
    `missing-evidence: ${input.counts.missingEvidence}`,
    `cleanup-ready: ${input.counts.cleanupReady}`
  ].join("\n");
}

export async function buildWorkflowReport(
  input: BuildWorkflowReportInput
): Promise<BuildWorkflowReportResult> {
  if (!isSafeWorkflowId(input.workflowId)) {
    throw new Error(`Invalid workflow id: ${input.workflowId}`);
  }
  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  const rows = record.slices.map((slice) => rowForSlice(record, slice));
  const counts = countsFor(rows);
  const status = completionStatus(record, rows);
  return {
    workflowId: record.workflowId,
    completionStatus: status,
    counts,
    rows,
    report: reportText({ workflowId: record.workflowId, status, counts }),
    ...((input.includeWorkflow ?? true) ? { workflow: toWorkflowView(record) } : {})
  };
}
