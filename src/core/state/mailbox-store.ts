import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
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

  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}
