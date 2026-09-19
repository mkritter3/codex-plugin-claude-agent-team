import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isSafeWorkflowId, runLogPath, runSidecarPath, workflowRecordPath } from "./state/paths.js";
import { readWorkflowRecord, writeWorkflowRecord } from "./state/workflow-store.js";
import type { RunSidecar } from "./types.js";

/** Records a reply child before its provider can write, making uncertain launches block retries. */
export async function reserveWorkflowContinuation(input: {
  readonly workspaceRoot: string;
  readonly workflowId: string;
  readonly sliceId: string;
  readonly parent: RunSidecar;
  readonly childRunId: string;
  readonly createdAt: string;
}): Promise<readonly string[]> {
  if (!isSafeWorkflowId(input.workflowId)) throw new Error(`Invalid workflow id: ${input.workflowId}`);
  const lock = `${workflowRecordPath(input.workspaceRoot, input.workflowId)}.continuation.lock`;
  await mkdir(dirname(lock), { recursive: true });
  const started = Date.now();
  while (true) {
    try { await mkdir(lock); break; } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (Date.now() - started > 5_000) throw new Error("Timed out waiting for workflow continuation lock");
      await delay(10);
    }
  }
  try {
  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  if (record.planningStatus !== "approved") throw new Error(`Workflow ${record.workflowId} must be approved before continuation`);
  const slice = record.slices.find((item) => item.sliceId === input.sliceId);
  if (slice === undefined) throw new Error(`Unknown workflow slice ${input.sliceId}`);
  if (input.parent.workflowId !== input.workflowId || input.parent.sliceId !== input.sliceId || input.parent.writeScope === undefined) {
    throw new Error("Workflow-linked write continuation lacks preserved scope context; start a fresh approved isolated run.");
  }
  if (input.parent.writeScope.length !== slice.writeScope.length || input.parent.writeScope.some((path, index) => path !== slice.writeScope[index])) {
    throw new Error("Workflow-linked write continuation scope changed; start a fresh approved isolated run.");
  }
  if (!(slice.runIds ?? []).includes(input.parent.runId)) throw new Error("Parent run does not belong to the workflow slice");
  if (!['running', 'needs-revision'].includes(slice.state)) throw new Error(`Workflow slice ${slice.sliceId} is ${slice.state}, not eligible for continuation`);
  if (slice.ownerRole !== input.parent.role) throw new Error("Parent role does not match the workflow slice assignment");
  if (slice.dependencies.some((id) => !record.slices.some((candidate) => candidate.sliceId === id && ['approved', 'integrated'].includes(candidate.state)))) {
    throw new Error("Workflow continuation is blocked by unresolved dependencies");
  }
  const target = slice.implementationTarget ?? record.orchestration?.implementation;
  if (target?.kind !== 'provider' || target.provider !== input.parent.provider || target.model !== input.parent.model) {
    throw new Error("Parent provider/model does not match the selected workflow implementation target");
  }
  const previous = (slice.runEvidence ?? []).find((item) => item.parentRunId === input.parent.runId);
  if (previous !== undefined && previous.runId !== input.childRunId) {
    throw new Error(`Workflow continuation ${previous.runId} is already reserved; inspect its sidecar before retrying.`);
  }
  if (previous !== undefined) return slice.writeScope;
  await writeWorkflowRecord(input.workspaceRoot, {
    ...record,
    updatedAt: input.createdAt,
    slices: record.slices.map((item) => item.sliceId !== slice.sliceId ? item : {
      ...item,
      state: 'running' as const,
      runIds: [...(item.runIds ?? []), input.childRunId],
      runEvidence: [...(item.runEvidence ?? []), {
        runId: input.childRunId,
        parentRunId: input.parent.runId,
        startedAt: input.createdAt,
        provider: input.parent.provider,
        role: input.parent.role,
        sidecarPath: runSidecarPath(input.workspaceRoot, input.childRunId),
        logPath: runLogPath(input.workspaceRoot, input.childRunId),
        ...(input.parent.executionCwd === undefined ? {} : { executionCwd: input.parent.executionCwd })
      }]
    })
  });
  return slice.writeScope;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
