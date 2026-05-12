import { StateCorruptionError } from "./errors.js";
import { mailboxPath, runSidecarPath } from "./state/paths.js";
import type { StateCorruptionRecoveryInput } from "./state/recovery.js";
import type {
  AgentTeamSummaryEvidence,
  AgentTeamSummaryGroups,
  AgentTeamSummaryMailboxEvidence,
  AgentTeamSummaryOk,
  AgentTeamSummaryOperationalState,
  AgentTeamSummaryRecovered,
  AgentTeamSummaryRequest,
  AgentTeamSummaryResult,
  AgentTeamSummaryRunResult,
  AgentTeamSummaryRunState,
  MailboxKind,
  MailboxRecord,
  RunSidecar,
  RunStatus
} from "./types.js";

const MAILBOX_KINDS: readonly MailboxKind[] = [
  "inbox",
  "outbox",
  "control",
  "events"
];

const TERMINAL_STATUSES = new Set<RunStatus>([
  "completed",
  "cancelled",
  "failed",
  "expired"
]);

type MutableGroups = {
  -readonly [Key in keyof AgentTeamSummaryGroups]: string[];
};

export interface TeamSummaryDependencies {
  readonly readRun: (cwd: string, runId: string) => Promise<RunSidecar>;
  readonly readMailbox: (
    cwd: string,
    runId: string,
    kind: MailboxKind
  ) => Promise<readonly MailboxRecord[]>;
  readonly recoverStateCorruption: (
    input: StateCorruptionRecoveryInput
  ) => Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function operationalState(status: RunStatus): AgentTeamSummaryOperationalState {
  if (status === "awaiting-input") {
    return "awaitingInput";
  }
  if (status === "winding-down") {
    return "windingDown";
  }
  if (TERMINAL_STATUSES.has(status)) {
    return "terminal";
  }
  return "running";
}

function hasRetainedWorktree(run: RunSidecar): boolean {
  return (
    run.executionCwd !== undefined &&
    run.workspaceRetention === "retain-until-integrated" &&
    run.workspaceCleanup !== "removed"
  );
}

function hasCleanupBlocked(run: RunSidecar): boolean {
  return TERMINAL_STATUSES.has(run.status) && hasRetainedWorktree(run);
}

function mailboxEvidence(
  workspaceRoot: string,
  runId: string,
  kind: MailboxKind,
  records: readonly MailboxRecord[]
): AgentTeamSummaryMailboxEvidence {
  const last = records.at(-1);
  return {
    path: mailboxPath(workspaceRoot, runId, kind),
    count: records.length,
    ...(last === undefined ? {} : { lastSequence: last.sequence })
  };
}

function runState(run: RunSidecar): AgentTeamSummaryRunState {
  const retainedWorktree = hasRetainedWorktree(run);
  return {
    runId: run.runId,
    role: run.role,
    provider: run.provider,
    status: run.status,
    operationalState: operationalState(run.status),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    detached: run.detached === true,
    retainedWorktree,
    cleanupBlocked: hasCleanupBlocked(run),
    ...(run.detachedAt === undefined ? {} : { detachedAt: run.detachedAt }),
    ...(run.sourceCwd === undefined ? {} : { sourceCwd: run.sourceCwd }),
    ...(run.executionCwd === undefined ? {} : { executionCwd: run.executionCwd }),
    ...(run.workspaceBranchName === undefined
      ? {}
      : { workspaceBranchName: run.workspaceBranchName }),
    ...(run.workspaceBaseRef === undefined ? {} : { workspaceBaseRef: run.workspaceBaseRef }),
    ...(run.workspaceIsolation === undefined
      ? {}
      : { workspaceIsolation: run.workspaceIsolation }),
    ...(run.workspaceRetention === undefined
      ? {}
      : { workspaceRetention: run.workspaceRetention }),
    ...(run.workspaceCleanup === undefined
      ? {}
      : { workspaceCleanup: run.workspaceCleanup }),
    ...(run.workspaceStatus === undefined ? {} : { workspaceStatus: run.workspaceStatus }),
    ...(run.outputSummary === undefined ? {} : { outputSummary: run.outputSummary }),
    ...(run.awaitingInputSince === undefined
      ? {}
      : { awaitingInputSince: run.awaitingInputSince }),
    ...(run.pendingOutboxRequest === undefined
      ? {}
      : { pendingOutboxRequest: run.pendingOutboxRequest }),
    ...(run.outboxRequestIds === undefined
      ? {}
      : { outboxRequestIds: run.outboxRequestIds }),
    ...(run.warnings === undefined ? {} : { warnings: run.warnings }),
    ...(run.recentActivities === undefined
      ? {}
      : { recentActivities: run.recentActivities }),
    ...(run.currentActivity === undefined ? {} : { currentActivity: run.currentActivity })
  };
}

function evidence(
  workspaceRoot: string,
  run: RunSidecar,
  mailboxes: Record<MailboxKind, AgentTeamSummaryMailboxEvidence>
): AgentTeamSummaryEvidence {
  return {
    sidecarPath: runSidecarPath(workspaceRoot, run.runId),
    mailboxes,
    ...(run.logPath === undefined ? {} : { logPath: run.logPath }),
    ...(run.transcriptPath === undefined ? {} : { transcriptPath: run.transcriptPath }),
    ...(run.workspaceDiffPath === undefined
      ? {}
      : { workspaceDiffPath: run.workspaceDiffPath }),
    ...(run.workspaceStatus === undefined ? {} : { workspaceStatus: run.workspaceStatus }),
    ...(run.evidencePaths.length === 0 ? {} : { evidencePaths: run.evidencePaths }),
    ...(run.changedFiles === undefined ? {} : { changedFiles: run.changedFiles }),
    ...(run.verdict === undefined ? {} : { verdict: run.verdict })
  };
}

function emptyGroups(): MutableGroups {
  return {
    running: [],
    awaitingInput: [],
    windingDown: [],
    terminal: [],
    failed: [],
    detached: [],
    cleanupBlocked: [],
    retainedWorktree: []
  };
}

function addToGroups(groups: MutableGroups, run: AgentTeamSummaryRunState): void {
  groups[run.operationalState].push(run.runId);
  if (run.status === "failed") {
    groups.failed.push(run.runId);
  }
  if (run.detached) {
    groups.detached.push(run.runId);
  }
  if (run.cleanupBlocked) {
    groups.cleanupBlocked.push(run.runId);
  }
  if (run.retainedWorktree) {
    groups.retainedWorktree.push(run.runId);
  }
}

async function readOne(
  request: AgentTeamSummaryRequest,
  index: number,
  deps: TeamSummaryDependencies
): Promise<AgentTeamSummaryRunResult> {
  const item = request.runs[index]!;
  try {
    const sidecar = await deps.readRun(item.cwd, item.runId);
    const mailboxEntries = await Promise.all(
      MAILBOX_KINDS.map(async (kind) => {
        const records = await deps.readMailbox(item.cwd, item.runId, kind);
        return [kind, mailboxEvidence(item.cwd, item.runId, kind, records)] as const;
      })
    );
    const mailboxMap = Object.fromEntries(mailboxEntries) as Record<
      MailboxKind,
      AgentTeamSummaryMailboxEvidence
    >;
    const run = runState(sidecar);
    const ok: AgentTeamSummaryOk = {
      status: "ok",
      index,
      runId: item.runId,
      cwd: item.cwd,
      ...(item.correlationId === undefined ? {} : { correlationId: item.correlationId }),
      run,
      evidence: evidence(item.cwd, sidecar, mailboxMap)
    };
    return ok;
  } catch (error) {
    if (error instanceof StateCorruptionError) {
      try {
        const recovery = await deps.recoverStateCorruption({
          workspaceRoot: item.cwd,
          runId: item.runId,
          operation: "agent_team_summary",
          error
        });
        const recovered: AgentTeamSummaryRecovered = {
          status: "state_corrupt",
          index,
          runId: item.runId,
          cwd: item.cwd,
          ...(item.correlationId === undefined
            ? {}
            : { correlationId: item.correlationId }),
          recovery
        };
        return recovered;
      } catch (recoveryError) {
        return {
          status: "failed",
          index,
          runId: item.runId,
          cwd: item.cwd,
          ...(item.correlationId === undefined
            ? {}
            : { correlationId: item.correlationId }),
          error: `state recovery failed: ${errorMessage(recoveryError)}`
        };
      }
    }

    return {
      status: "failed",
      index,
      runId: item.runId,
      cwd: item.cwd,
      ...(item.correlationId === undefined ? {} : { correlationId: item.correlationId }),
      error: errorMessage(error)
    };
  }
}

export async function summarizeAgentTeam(
  request: AgentTeamSummaryRequest,
  deps: TeamSummaryDependencies
): Promise<AgentTeamSummaryResult> {
  const results = new Array<AgentTeamSummaryRunResult>(request.runs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (request.runs[index] === undefined) {
        return;
      }
      results[index] = await readOne(request, index, deps);
    }
  }

  const workerCount = Math.min(request.concurrency, request.runs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const groups = emptyGroups();
  for (const result of results) {
    if (result.status === "ok") {
      addToGroups(groups, result.run);
    }
  }

  return {
    status: results.some((result) => result.status !== "ok")
      ? "partial_failure"
      : "ok",
    groups,
    runs: results
  };
}
