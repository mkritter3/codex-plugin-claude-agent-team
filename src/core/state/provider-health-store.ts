import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJsonFile, writeJsonAtomic } from "./atomic-json.js";
import { stateRoot } from "./paths.js";
import type { ProviderHealthRecord } from "../types.js";

interface ProviderHealthFile {
  readonly schemaVersion: 1;
  readonly records: readonly ProviderHealthRecord[];
}

export function providerHealthPath(workspaceRoot: string): string {
  return join(stateRoot(workspaceRoot), "providers", "health.json");
}

export async function readProviderHealthRecords(
  workspaceRoot: string
): Promise<readonly ProviderHealthRecord[]> {
  try {
    const file = await readJsonFile<ProviderHealthFile>(providerHealthPath(workspaceRoot));
    return [...file.records].sort((a, b) => a.providerId.localeCompare(b.providerId));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function upsertProviderHealthRecord(
  workspaceRoot: string,
  record: ProviderHealthRecord
): Promise<void> {
  const path = providerHealthPath(workspaceRoot);
  await mkdir(dirname(path), { recursive: true });
  const existing = await readProviderHealthRecords(workspaceRoot);
  const next = [
    ...existing.filter((item) => item.providerId !== record.providerId),
    record
  ].sort((a, b) => a.providerId.localeCompare(b.providerId));
  await writeJsonAtomic(path, {
    schemaVersion: 1,
    records: next
  } satisfies ProviderHealthFile);
}
