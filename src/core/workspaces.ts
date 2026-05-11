import { execFile as nodeExecFile } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
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

const execFileAsync = promisify(nodeExecFile);

const defaultExecFile: ExecFileLike = async (file, args) => {
  const { stdout, stderr } = await execFileAsync(file, [...args]);
  return { stdout, stderr };
};

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, "-");
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

export async function allocateIsolatedWorktree(input: {
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

  try {
    await execFile("git", [
      "-C",
      sourceRoot,
      "worktree",
      "add",
      executionCwd,
      "-b",
      branchName,
      baseRef
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkspaceLeaseError(`Unable to allocate isolated worktree: ${message}`);
  }

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
