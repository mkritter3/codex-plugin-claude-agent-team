import { mkdir, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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

const ALLOWED_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["queued", "starting", "running", "failed", "expired"],
  starting: ["starting", "running", "failed", "expired"],
  running: [
    "running",
    "awaiting-input",
    "winding-down",
    "cancelling",
    "completed",
    "failed",
    "expired"
  ],
  "awaiting-input": [
    "awaiting-input",
    "running",
    "winding-down",
    "cancelling",
    "failed",
    "expired"
  ],
  "winding-down": [
    "winding-down",
    "completed",
    "failed",
    "expired",
    "cancelling",
    "cancelled"
  ],
  cancelling: ["cancelling", "cancelled", "failed"],
  completed: ["completed"],
  cancelled: ["cancelled"],
  failed: ["failed"],
  expired: ["expired"]
};

async function acquireRunSidecarLock(
  workspaceRoot: string,
  runId: string
): Promise<() => Promise<void>> {
  const lockPath = `${runSidecarPath(workspaceRoot, runId)}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    try {
      await mkdir(lockPath);
      return async () => {
        try {
          await rmdir(lockPath);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw error;
          }
        }
      };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      if (Date.now() - startedAt > 5_000) {
        throw new Error(`Timed out acquiring run sidecar lock: ${lockPath}`);
      }
      attempt += 1;
      await delay(Math.min(20, attempt));
    }
  }
}

export async function withRunSidecarLock<T>(
  workspaceRoot: string,
  runId: string,
  fn: () => Promise<T>
): Promise<T> {
  const release = await acquireRunSidecarLock(workspaceRoot, runId);
  try {
    return await fn();
  } finally {
    await release();
  }
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
  return withRunSidecarLock(workspaceRoot, runId, async () => {
    const current = await readRunSidecar(workspaceRoot, runId);
    const next = update(current);

    if (!ALLOWED_TRANSITIONS[current.status].includes(next.status)) {
      throw new InvalidRunTransitionError(current.status, next.status);
    }

    await writeRunSidecar(workspaceRoot, next);
    return next;
  });
}
