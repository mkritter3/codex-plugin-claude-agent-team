import { execFile as nodeExecFile } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceLease } from "./types.js";

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
