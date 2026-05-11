import { join } from "node:path";
import type { MailboxKind } from "../types.js";

export const STATE_DIR = ".agent-team";

export function stateRoot(workspaceRoot: string): string {
  return join(workspaceRoot, STATE_DIR);
}

export function runsDir(workspaceRoot: string): string {
  return join(stateRoot(workspaceRoot), "runs");
}

export function runSidecarPath(workspaceRoot: string, runId: string): string {
  return join(runsDir(workspaceRoot), `${runId}.json`);
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
