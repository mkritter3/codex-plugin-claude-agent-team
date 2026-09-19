import { execFile as nodeExecFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ImplementationWorkspaceInspection, WorkspaceLease } from "./types.js";

export interface ExecFileResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type ExecFileLike = (
  file: string,
  args: readonly string[]
) => Promise<ExecFileResult>;

export class WorkspaceLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceLeaseError";
  }
}

export interface GitWorktreeSupportInspection {
  readonly ok: boolean;
  readonly gitVersion?: string;
  readonly sourceRoot?: string;
  readonly worktreeList?: string;
  readonly message?: string;
}

const execFileAsync = promisify(nodeExecFile);

const defaultExecFile: ExecFileLike = async (file, args) => {
  const { stdout, stderr } = await execFileAsync(file, [...args]);
  return { stdout, stderr };
};

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, "-");
}

function isWithinRoot(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function gitSourceRoot(
  sourceCwd: string,
  execFile: ExecFileLike
): Promise<string> {
  try {
    const result = await execFile("git", [
      "-C",
      sourceCwd,
      "rev-parse",
      "--show-toplevel"
    ]);
    const root = result.stdout.trim();
    if (root.length === 0) {
      throw new Error("empty git root");
    }
    return resolve(root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkspaceLeaseError(`Unable to resolve git source root: ${message}`);
  }
}

export async function planIsolatedWorktree(input: {
  readonly sourceCwd: string;
  readonly runId: string;
  readonly execFile?: ExecFileLike;
}): Promise<WorkspaceLease> {
  const execFile = input.execFile ?? defaultExecFile;
  const sourceRoot = await gitSourceRoot(input.sourceCwd, execFile);
  const safeRunId = sanitizeRunId(input.runId);
  const executionCwd = join(
    dirname(sourceRoot),
    ".agent-team-worktrees",
    basename(sourceRoot),
    safeRunId
  );
  const branchName = `agent-team/${safeRunId}`;
  const baseRef = "HEAD";

  return {
    sourceCwd: sourceRoot,
    executionCwd,
    branchName,
    baseRef,
    isolation: "git-worktree",
    retention: "retain-until-integrated",
    cleanup: "retained"
  };
}

export async function allocateIsolatedWorktree(input: {
  readonly sourceCwd: string;
  readonly runId: string;
  readonly allowedExecutionRoots?: readonly string[];
  readonly execFile?: ExecFileLike;
}): Promise<WorkspaceLease> {
  const execFile = input.execFile ?? defaultExecFile;
  const lease = await planIsolatedWorktree(input);
  const allowedExecutionRoots = input.allowedExecutionRoots ?? [];

  if (
    allowedExecutionRoots.length > 0 &&
    !allowedExecutionRoots.some((root) => isWithinRoot(lease.executionCwd, root))
  ) {
    throw new WorkspaceLeaseError(
      `Planned worktree ${lease.executionCwd} is outside allowed execution roots.`
    );
  }

  try {
    await execFile("git", [
      "-C",
      lease.sourceCwd,
      "worktree",
      "add",
      lease.executionCwd,
      "-b",
      lease.branchName,
      lease.baseRef
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkspaceLeaseError(`Unable to allocate isolated worktree: ${message}`);
  }

  return lease;
}

/** Reuses only the exact registered worktree recorded by a prior write run. */
export async function verifyRetainedWorktree(input: {
  readonly lease: WorkspaceLease;
  readonly expectedSourceCwd?: string;
  readonly allowedExecutionRoots: readonly string[];
  readonly execFile?: ExecFileLike;
}): Promise<WorkspaceLease> {
  if (input.lease.cleanup === "removed" || !input.lease.sourceCwd || !input.lease.executionCwd || !input.lease.branchName || !input.lease.baseRef) {
    throw new WorkspaceLeaseError("Retained worktree metadata is incomplete; start a fresh isolated run.");
  }
  let sourceCwd: string;
  let executionCwd: string;
  try {
    [sourceCwd, executionCwd] = await Promise.all([realpath(input.lease.sourceCwd), realpath(input.lease.executionCwd)]);
  } catch {
    throw new WorkspaceLeaseError("Retained worktree no longer exists; start a fresh isolated run.");
  }
  const expectedSourceCwd = input.expectedSourceCwd === undefined ? undefined : await realpath(await gitSourceRoot(input.expectedSourceCwd, input.execFile ?? defaultExecFile));
  if (expectedSourceCwd !== undefined && sourceCwd !== expectedSourceCwd) {
    throw new WorkspaceLeaseError("Retained worktree source does not match this request workspace.");
  }
  if (sourceCwd === executionCwd || (input.allowedExecutionRoots.length > 0 && !input.allowedExecutionRoots.some((root) => isWithinRoot(executionCwd, root)))) {
    throw new WorkspaceLeaseError("Retained worktree is outside the allowed isolated worktree roots.");
  }
  const execFile = input.execFile ?? defaultExecFile;
  try {
    const [sourceCommon, executionCommon, list] = await Promise.all([
      execFile("git", ["-C", sourceCwd, "rev-parse", "--git-common-dir"]),
      execFile("git", ["-C", executionCwd, "rev-parse", "--git-common-dir"]),
      execFile("git", ["-C", sourceCwd, "worktree", "list", "--porcelain"])
    ]);
    if (resolve(sourceCwd, sourceCommon.stdout.trim()) !== resolve(executionCwd, executionCommon.stdout.trim())) {
      throw new WorkspaceLeaseError("Retained worktree belongs to a different repository.");
    }
    const registered = list.stdout.split("\n\n").some((record) => {
      const path = record.match(/^worktree (.+)$/m)?.[1];
      const branch = record.match(/^branch refs\/heads\/(.+)$/m)?.[1];
      return path === executionCwd && branch === input.lease.branchName;
    });
    if (!registered) throw new WorkspaceLeaseError("Retained worktree is missing, replaced, or has an unexpected branch.");
  } catch (error) {
    if (error instanceof WorkspaceLeaseError) throw error;
    throw new WorkspaceLeaseError(`Unable to verify retained worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...input.lease, sourceCwd, executionCwd };
}

export async function cleanupIsolatedWorktree(input: {
  readonly lease: WorkspaceLease;
  readonly force?: boolean;
  readonly execFile?: ExecFileLike;
}): Promise<WorkspaceLease> {
  if (input.force !== true) {
    throw new WorkspaceLeaseError(
      `Worktree ${input.lease.executionCwd} is retained until integrated.`
    );
  }

  const execFile = input.execFile ?? defaultExecFile;
  await execFile("git", [
    "-C",
    input.lease.sourceCwd,
    "worktree",
    "remove",
    "--force",
    input.lease.executionCwd
  ]);

  return {
    ...input.lease,
    cleanup: "removed"
  };
}

function parsePorcelainPath(line: string): string | undefined {
  const path = line.slice(3).trim();
  if (path.length === 0) {
    return undefined;
  }
  const renameSeparator = " -> ";
  const renameIndex = path.indexOf(renameSeparator);
  return renameIndex === -1 ? path : path.slice(renameIndex + renameSeparator.length);
}

function unique<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)];
}

export async function inspectImplementationWorkspace(input: {
  readonly executionCwd: string;
  readonly execFile?: ExecFileLike;
}): Promise<ImplementationWorkspaceInspection> {
  const execFile = input.execFile ?? defaultExecFile;
  try {
    const status = await execFile("git", [
      "-C",
      input.executionCwd,
      "status",
      "--porcelain=v1"
    ]);
    const statusSummary = status.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0);
    const changedFiles = unique(
      statusSummary
        .map((line) => parsePorcelainPath(line))
        .filter((path): path is string => path !== undefined)
    );

    const diff = await execFile("git", [
      "-C",
      input.executionCwd,
      "diff",
      "--binary"
    ]);
    const diffText = diff.stdout.length === 0 ? undefined : diff.stdout;

    return {
      changedFiles,
      statusSummary,
      ...(diffText === undefined ? {} : { diffText })
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkspaceLeaseError(
      `Unable to inspect implementation workspace ${input.executionCwd}: ${message}`
    );
  }
}

/** Hashes HEAD, staged/unstaged tracked changes, and untracked path contents. */
export async function fingerprintImplementationWorkspace(input: {
  readonly executionCwd: string;
  readonly execFile?: ExecFileLike;
}): Promise<string> {
  const execFile = input.execFile ?? defaultExecFile;
  try {
    const [head, staged, unstaged, untracked] = await Promise.all([
      execFile("git", ["-C", input.executionCwd, "rev-parse", "HEAD"]),
      execFile("git", ["-C", input.executionCwd, "diff", "--binary", "--cached"]),
      execFile("git", ["-C", input.executionCwd, "diff", "--binary"]),
      execFile("git", ["-C", input.executionCwd, "ls-files", "--others", "--exclude-standard", "-z"])
    ]);
    const hash = createHash("sha256");
    hash.update(`HEAD\0${head.stdout.trim()}\0STAGED\0${staged.stdout}\0UNSTAGED\0${unstaged.stdout}`);
    for (const path of untracked.stdout.split("\0").filter(Boolean).sort()) {
      hash.update(`UNTRACKED\0${path}\0`);
      hash.update(await readFile(join(input.executionCwd, path)));
      hash.update("\0");
    }
    return hash.digest("hex");
  } catch (error) {
    throw new WorkspaceLeaseError(`Unable to fingerprint implementation workspace ${input.executionCwd}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function inspectGitWorktreeSupport(input: {
  readonly workspaceRoot: string;
  readonly execFile?: ExecFileLike;
}): Promise<GitWorktreeSupportInspection> {
  const execFile = input.execFile ?? defaultExecFile;
  try {
    const version = await execFile("git", ["--version"]);
    const root = await execFile("git", [
      "-C",
      input.workspaceRoot,
      "rev-parse",
      "--show-toplevel"
    ]);
    const sourceRoot = root.stdout.trim();
    const worktrees = await execFile("git", [
      "-C",
      sourceRoot,
      "worktree",
      "list",
      "--porcelain"
    ]);

    return {
      ok: true,
      gitVersion: version.stdout.trim(),
      sourceRoot,
      worktreeList: worktrees.stdout
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
