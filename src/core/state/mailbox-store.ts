import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { StateCorruptionError } from "../errors.js";
import type { MailboxKind, MailboxRecord, RoleId } from "../types.js";
import { mailboxPath } from "./paths.js";

export interface AppendMailboxInput {
  readonly role: RoleId;
  readonly provider: string;
  readonly messageType: string;
  readonly correlationId: string;
  readonly payload: unknown;
  readonly createdAt?: string;
}

function contentHash(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

async function acquireMailboxLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
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
        throw new StateCorruptionError(`Timed out acquiring mailbox lock: ${lockPath}`);
      }

      attempt += 1;
      await delay(Math.min(20, attempt));
    }
  }
}

export async function readMailboxRecords(
  workspaceRoot: string,
  runId: string,
  kind: MailboxKind
): Promise<readonly MailboxRecord[]> {
  const path = mailboxPath(workspaceRoot, runId, kind);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records: MailboxRecord[] = [];
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  for (const [index, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line) as MailboxRecord);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StateCorruptionError(
        `Invalid JSONL at ${path}:${index + 1}: ${message}`
      );
    }
  }
  return records;
}

export async function appendMailboxRecord(
  workspaceRoot: string,
  runId: string,
  kind: MailboxKind,
  input: AppendMailboxInput
): Promise<MailboxRecord> {
  const path = mailboxPath(workspaceRoot, runId, kind);
  await mkdir(dirname(path), { recursive: true });
  const release = await acquireMailboxLock(path);
  try {
    const existing = await readMailboxRecords(workspaceRoot, runId, kind);
    const record: MailboxRecord = {
      sequence: existing.length + 1,
      runId,
      role: input.role,
      provider: input.provider,
      messageType: input.messageType,
      createdAt: input.createdAt ?? new Date().toISOString(),
      correlationId: input.correlationId,
      contentHash: contentHash(input.payload),
      payload: input.payload
    };

    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  } finally {
    await release();
  }
}

export async function appendControlRecord(
  workspaceRoot: string,
  runId: string,
  input: AppendMailboxInput
): Promise<MailboxRecord> {
  return appendMailboxRecord(workspaceRoot, runId, "control", input);
}

export async function appendEventRecord(
  workspaceRoot: string,
  runId: string,
  input: AppendMailboxInput
): Promise<MailboxRecord> {
  return appendMailboxRecord(workspaceRoot, runId, "events", input);
}
