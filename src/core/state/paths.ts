import { join } from "node:path";
import type { MailboxKind } from "../types.js";

export const STATE_DIR = ".agent-team";
const SAFE_RUN_ID = /^run_[A-Za-z0-9_-]+$/;
const SAFE_TEAM_ID = /^team_[A-Za-z0-9_-]+$/;

export function isSafeRunId(runId: string): boolean {
  return SAFE_RUN_ID.test(runId);
}

export function isSafeTeamId(teamId: string): boolean {
  return SAFE_TEAM_ID.test(teamId);
}

export function stateRoot(workspaceRoot: string): string {
  return join(workspaceRoot, STATE_DIR);
}

export function runsDir(workspaceRoot: string): string {
  return join(stateRoot(workspaceRoot), "runs");
}

export function runSidecarPath(workspaceRoot: string, runId: string): string {
  return join(runsDir(workspaceRoot), `${runId}.json`);
}

export function teamsDir(workspaceRoot: string): string {
  return join(stateRoot(workspaceRoot), "teams");
}

export function teamRecordPath(workspaceRoot: string, teamId: string): string {
  if (!isSafeTeamId(teamId)) {
    throw new Error(`Invalid team id: ${teamId}`);
  }
  return join(teamsDir(workspaceRoot), `${teamId}.json`);
}

export function logsDir(workspaceRoot: string): string {
  return join(stateRoot(workspaceRoot), "logs");
}

export function runLogPath(workspaceRoot: string, runId: string): string {
  return join(logsDir(workspaceRoot), `${runId}.log`);
}

export function workspaceDiffPath(workspaceRoot: string, runId: string): string {
  return join(logsDir(workspaceRoot), `${runId}.diff.patch`);
}

export function mailboxesDir(workspaceRoot: string): string {
  return join(stateRoot(workspaceRoot), "mailboxes");
}

export function runMailboxDir(workspaceRoot: string, runId: string): string {
  return join(mailboxesDir(workspaceRoot), runId);
}

export function mailboxPath(
  workspaceRoot: string,
  runId: string,
  kind: MailboxKind
): string {
  return join(runMailboxDir(workspaceRoot, runId), `${kind}.jsonl`);
}
