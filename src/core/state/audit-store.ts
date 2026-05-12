import { appendFile, mkdir, readFile, rmdir } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { StateCorruptionError } from "../errors.js";
import type { AgentTeamAuditRecord, AgentTeamAuditRecordInput } from "../types.js";
import { auditEventsPath } from "./paths.js";

const FORBIDDEN_DETAIL_KEYS = new Set([
  "apikey",
  "commandargs",
  "payload",
  "processid",
  "prompt",
  "prompthash",
  "providercommandargs",
  "providersessionid",
  "secret"
]);

async function acquireAuditLock(path: string): Promise<() => Promise<void>> {
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
        throw new StateCorruptionError(`Timed out acquiring audit lock: ${lockPath}`);
      }
      attempt += 1;
      await delay(Math.min(20, attempt));
    }
  }
}

function assertSafeDetails(value: unknown, path: readonly string[] = []): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (FORBIDDEN_DETAIL_KEYS.has(normalized)) {
      throw new Error(`Forbidden audit detail key: ${[...path, key].join(".")}`);
    }
    assertSafeDetails(child, [...path, key]);
  }
}

export async function readAuditRecords(
  workspaceRoot: string
): Promise<readonly AgentTeamAuditRecord[]> {
  const path = auditEventsPath(workspaceRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records: AgentTeamAuditRecord[] = [];
  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  for (const [index, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line) as AgentTeamAuditRecord);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StateCorruptionError(
        `Invalid audit JSONL at ${path}:${index + 1}: ${message}`,
        { path, kind: "jsonl" }
      );
    }
  }
  return records;
}

export async function appendAuditRecord(
  workspaceRoot: string,
  input: AgentTeamAuditRecordInput
): Promise<AgentTeamAuditRecord> {
  assertSafeDetails(input.details);
  const path = auditEventsPath(workspaceRoot);
  await mkdir(dirname(path), { recursive: true });
  const release = await acquireAuditLock(path);
  try {
    const existing = await readAuditRecords(workspaceRoot);
    const record: AgentTeamAuditRecord = {
      sequence: existing.length + 1,
      createdAt: input.createdAt ?? new Date().toISOString(),
      eventType: input.eventType,
      operation: input.operation,
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      decision: input.decision,
      reason: input.reason,
      details: input.details
    };
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  } finally {
    await release();
  }
}
