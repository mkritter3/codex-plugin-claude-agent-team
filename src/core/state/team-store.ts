import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { StateCorruptionError } from "../errors.js";
import type { AgentTeamRecord } from "../types.js";
import { readJsonFile, writeJsonAtomic } from "./atomic-json.js";
import { isSafeRunId, isSafeTeamId, teamRecordPath, teamsDir } from "./paths.js";

const TEAM_RECORD_KEYS = new Set([
  "teamId",
  "name",
  "description",
  "createdAt",
  "updatedAt",
  "runs",
  "evidencePath"
]);
const TEAM_RUN_REF_KEYS = new Set(["runId", "cwd", "correlationId"]);

function corruption(path: string, reason: string): StateCorruptionError {
  return new StateCorruptionError(`Invalid team record at ${path}: ${reason}`, {
    path,
    kind: "json"
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectNonEmptyString(
  value: unknown,
  path: string,
  field: string
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw corruption(path, `${field} must be a non-empty string`);
  }
  return value;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  path: string,
  allowedKeys: ReadonlySet<string>,
  label: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw corruption(path, `${label} contains unsupported field ${key}`);
    }
  }
}

function parseTeamRecord(value: unknown, path: string): AgentTeamRecord {
  if (!isObject(value)) {
    throw corruption(path, "record must be an object");
  }
  assertKnownKeys(value, path, TEAM_RECORD_KEYS, "record");

  const teamId = expectNonEmptyString(value.teamId, path, "teamId");
  if (!isSafeTeamId(teamId)) {
    throw corruption(path, "teamId is not a safe team id");
  }
  if (basename(path) !== `${teamId}.json`) {
    throw corruption(path, "teamId must match the team record file name");
  }

  const createdAt = expectNonEmptyString(value.createdAt, path, "createdAt");
  const updatedAt = expectNonEmptyString(value.updatedAt, path, "updatedAt");
  const evidencePath = expectNonEmptyString(value.evidencePath, path, "evidencePath");
  if (evidencePath !== path) {
    throw corruption(path, "evidencePath must match the team record path");
  }

  if (!Array.isArray(value.runs) || value.runs.length === 0) {
    throw corruption(path, "runs must be a non-empty array");
  }

  const runs = value.runs.map((run, index) => {
    if (!isObject(run)) {
      throw corruption(path, `runs[${index}] must be an object`);
    }
    assertKnownKeys(run, path, TEAM_RUN_REF_KEYS, `runs[${index}]`);

    const runId = expectNonEmptyString(run.runId, path, `runs[${index}].runId`);
    if (!isSafeRunId(runId)) {
      throw corruption(path, `runs[${index}].runId is not a safe run id`);
    }
    const cwd = expectNonEmptyString(run.cwd, path, `runs[${index}].cwd`);
    const correlationId =
      run.correlationId === undefined
        ? undefined
        : expectNonEmptyString(
            run.correlationId,
            path,
            `runs[${index}].correlationId`
          );

    return {
      runId,
      cwd,
      ...(correlationId === undefined ? {} : { correlationId })
    };
  });

  const name =
    value.name === undefined ? undefined : expectNonEmptyString(value.name, path, "name");
  const description =
    value.description === undefined
      ? undefined
      : expectNonEmptyString(value.description, path, "description");

  return {
    teamId,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    createdAt,
    updatedAt,
    runs,
    evidencePath
  };
}

async function readTeamRecordPath(path: string): Promise<AgentTeamRecord> {
  return parseTeamRecord(await readJsonFile<unknown>(path), path);
}

export async function writeTeamRecord(
  workspaceRoot: string,
  record: AgentTeamRecord
): Promise<void> {
  const path = teamRecordPath(workspaceRoot, record.teamId);
  await writeJsonAtomic(path, parseTeamRecord(record, path));
}

export async function readTeamRecord(
  workspaceRoot: string,
  teamId: string
): Promise<AgentTeamRecord> {
  return readTeamRecordPath(teamRecordPath(workspaceRoot, teamId));
}

export async function listTeamRecords(
  workspaceRoot: string
): Promise<readonly AgentTeamRecord[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(teamsDir(workspaceRoot));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => {
        const teamId = entry.slice(0, -5);
        const path = join(teamsDir(workspaceRoot), entry);
        if (!isSafeTeamId(teamId)) {
          throw corruption(path, "team record file name is not a safe team id");
        }
        return readTeamRecordPath(path);
      })
  );

  return records.sort((left, right) => {
    const created = left.createdAt.localeCompare(right.createdAt);
    return created === 0 ? left.teamId.localeCompare(right.teamId) : created;
  });
}
