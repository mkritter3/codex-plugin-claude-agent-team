import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stateRoot } from "./state/paths.js";

export interface WorktreeOwnershipClaim {
  readonly sourceCwd: string;
  readonly executionCwd: string;
  readonly lineageRootRunId: string;
  readonly activeRunId: string;
  readonly claimToken: string;
  readonly host: string;
  readonly ownerPid: number;
  readonly ownerProcessStartIdentity: string;
  readonly providerPid?: number;
  /** Child start time cannot be proven portably; unknown owners stay fail-closed. */
  readonly providerProcessStartIdentity?: string;
  readonly claimedAt: string;
}

export function currentProcessStartIdentity(): string {
  return `${process.pid}:${Math.floor(Date.now() - process.uptime() * 1_000)}`;
}

export interface WorktreeClaimIdentity {
  readonly sourceCwd: string;
  readonly executionCwd: string;
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    // A test double or a just-removed worktree has no inode to resolve.  A
    // lexical absolute path is still safe for release; existing paths always
    // use their real filesystem identity, which prevents symlink aliases.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return resolve(path);
    throw error;
  }
}

async function canonicalIdentity(sourceCwd: string, executionCwd: string): Promise<WorktreeClaimIdentity> {
  const [source, execution] = await Promise.all([canonicalPath(sourceCwd), canonicalPath(executionCwd)]);
  return { sourceCwd: source, executionCwd: execution };
}

function key(identity: WorktreeClaimIdentity): string {
  return createHash("sha256").update(`${identity.sourceCwd}\0${identity.executionCwd}`).digest("hex");
}

function ownershipPath(identity: WorktreeClaimIdentity): string {
  return join(stateRoot(identity.sourceCwd), "worktree-ownership", `${key(identity)}.json`);
}

async function withMutex<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  await mkdir(dirname(lock), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      if (Date.now() - started > 5_000) throw new Error(`Timed out acquiring worktree ownership lock: ${lock}`);
      await delay(10);
    }
  }
  try { return await operation(); } finally { await rm(lock, { recursive: true, force: true }); }
}

export async function claimWorktree(input: WorktreeOwnershipClaim): Promise<WorktreeClaimIdentity> {
  const identity = await canonicalIdentity(input.sourceCwd, input.executionCwd);
  const claim = { ...input, ...identity };
  const path = ownershipPath(identity);
  await withMutex(path, async () => {
    try {
      const existing = JSON.parse(await readFile(path, "utf8")) as WorktreeOwnershipClaim;
      throw new Error(`Worktree is already claimed by active run ${existing.activeRunId}; verify its provider process before manual recovery.`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    await mkdir(dirname(path), { recursive: true });
    await import("./state/atomic-json.js").then(({ writeJsonAtomic }) => writeJsonAtomic(path, claim));
  });
  return identity;
}

export async function releaseWorktreeClaim(input: {
  readonly sourceCwd: string;
  readonly executionCwd: string;
  readonly claimToken: string;
}): Promise<void> {
  // Release receives the canonical identity returned by claimWorktree.  Do
  // not realpath here: successful cleanup has intentionally removed it.
  const path = ownershipPath({
    sourceCwd: await canonicalPath(input.sourceCwd),
    executionCwd: resolve(input.executionCwd)
  });
  await withMutex(path, async () => {
    try {
      const existing = JSON.parse(await readFile(path, "utf8")) as WorktreeOwnershipClaim;
      if (existing.claimToken !== input.claimToken) throw new Error("Worktree ownership token does not match the active claim.");
      await rm(path, { force: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  });
}

export async function recordClaimedProviderProcess(input: {
  readonly sourceCwd: string;
  readonly executionCwd: string;
  readonly claimToken: string;
  readonly providerPid?: number;
  readonly providerProcessStartIdentity?: string;
}): Promise<void> {
  if (input.providerPid === undefined) return;
  const path = ownershipPath(await canonicalIdentity(input.sourceCwd, input.executionCwd));
  await withMutex(path, async () => {
    const existing = JSON.parse(await readFile(path, "utf8")) as WorktreeOwnershipClaim;
    if (existing.claimToken !== input.claimToken) throw new Error("Worktree ownership token does not match the active claim.");
    await import("./state/atomic-json.js").then(({ writeJsonAtomic }) => writeJsonAtomic(path, {
      ...existing,
      providerPid: input.providerPid,
      providerProcessStartIdentity: input.providerProcessStartIdentity ?? "unknown"
    }));
  });
}

export async function assertWorktreeUnclaimed(sourceCwd: string, executionCwd: string): Promise<void> {
  const path = ownershipPath(await canonicalIdentity(sourceCwd, executionCwd));
  try {
    const existing = JSON.parse(await readFile(path, "utf8")) as WorktreeOwnershipClaim;
    throw new Error(`Worktree is claimed by active run ${existing.activeRunId}; provider process identity ${existing.providerPid ?? "unknown"} must be verified stopped before recovery or cleanup.`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
