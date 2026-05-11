import type { RunSidecar, RunStatus } from "../types.js";
import { readJsonFile, writeJsonAtomic } from "./atomic-json.js";
import { runSidecarPath } from "./paths.js";

export class InvalidRunTransitionError extends Error {
  constructor(
    public readonly currentStatus: RunStatus,
    public readonly nextStatus: RunStatus
  ) {
    super(`Invalid run transition: ${currentStatus} -> ${nextStatus}`);
    this.name = "InvalidRunTransitionError";
  }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (
    status === "completed" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "expired"
  );
}

export async function writeRunSidecar(
  workspaceRoot: string,
  sidecar: RunSidecar
): Promise<void> {
  await writeJsonAtomic(runSidecarPath(workspaceRoot, sidecar.runId), sidecar);
}

export async function readRunSidecar(
  workspaceRoot: string,
  runId: string
): Promise<RunSidecar> {
  return readJsonFile<RunSidecar>(runSidecarPath(workspaceRoot, runId));
}

export async function transitionRunSidecar(
  workspaceRoot: string,
  runId: string,
  update: (current: RunSidecar) => RunSidecar
): Promise<RunSidecar> {
  const current = await readRunSidecar(workspaceRoot, runId);
  const next = update(current);

  if (
    isTerminalRunStatus(current.status) &&
    next.status !== current.status
  ) {
    throw new InvalidRunTransitionError(current.status, next.status);
  }

  await writeRunSidecar(workspaceRoot, next);
  return next;
}
