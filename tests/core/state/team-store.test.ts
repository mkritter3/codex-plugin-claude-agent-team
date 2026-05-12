import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../../src/core/errors.js";
import {
  listTeamRecords,
  readTeamRecord,
  writeTeamRecord
} from "../../../src/core/state/team-store.js";
import { teamRecordPath } from "../../../src/core/state/paths.js";
import type { AgentTeamRecord } from "../../../src/core/types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-team-store-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function record(teamId: string, createdAt: string): AgentTeamRecord {
  return {
    teamId,
    name: `Team ${teamId}`,
    description: "Review slice",
    createdAt,
    updatedAt: createdAt,
    runs: [
      {
        runId: "run_1",
        cwd: "/repo",
        correlationId: "reviewer"
      }
    ],
    evidencePath: teamRecordPath(workspace, teamId)
  };
}

describe("team-store", () => {
  it("writes and reads a durable team record atomically", async () => {
    const team = record("team_123", "2026-05-12T10:00:00.000Z");

    await writeTeamRecord(workspace, team);

    await expect(readTeamRecord(workspace, "team_123")).resolves.toEqual(team);
    expect(teamRecordPath(workspace, "team_123")).toBe(
      join(workspace, ".agent-team", "teams", "team_123.json")
    );
  });

  it("lists team records sorted by created time then team id", async () => {
    const latest = record("team_c", "2026-05-12T10:00:02.000Z");
    const firstB = record("team_b", "2026-05-12T10:00:00.000Z");
    const firstA = record("team_a", "2026-05-12T10:00:00.000Z");

    await writeTeamRecord(workspace, latest);
    await writeTeamRecord(workspace, firstB);
    await writeTeamRecord(workspace, firstA);

    await expect(listTeamRecords(workspace)).resolves.toEqual([firstA, firstB, latest]);
  });

  it("returns an empty list when no teams directory exists", async () => {
    await expect(listTeamRecords(workspace)).resolves.toEqual([]);
  });

  it("reports corrupt team record path and kind", async () => {
    const path = teamRecordPath(workspace, "team_corrupt");
    await mkdir(join(workspace, ".agent-team", "teams"), { recursive: true });
    await writeFile(path, "{ nope", "utf8");

    await expect(readTeamRecord(workspace, "team_corrupt")).rejects.toMatchObject({
      name: "StateCorruptionError",
      path,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });

  it("rejects unsafe team ids before resolving a state path", async () => {
    await expect(readTeamRecord(workspace, "../runs/run_escape")).rejects.toThrow(
      "Invalid team id"
    );
  });

  it("reports shape-invalid team JSON as corrupt state", async () => {
    const path = teamRecordPath(workspace, "team_poisoned");
    await mkdir(join(workspace, ".agent-team", "teams"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        teamId: "team_poisoned",
        createdAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:00:00.000Z",
        evidencePath: path,
        provider: "claude-code-cli"
      }),
      "utf8"
    );

    await expect(readTeamRecord(workspace, "team_poisoned")).rejects.toMatchObject({
      name: "StateCorruptionError",
      path,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });

  it("reports team id and file name mismatch as corrupt state", async () => {
    const path = teamRecordPath(workspace, "team_path");
    await mkdir(join(workspace, ".agent-team", "teams"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        ...record("team_other", "2026-05-12T10:00:00.000Z"),
        evidencePath: path
      }),
      "utf8"
    );

    await expect(readTeamRecord(workspace, "team_path")).rejects.toMatchObject({
      name: "StateCorruptionError",
      path,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });

  it("reports a poisoned record while listing instead of leaking it", async () => {
    const good = record("team_good", "2026-05-12T10:00:00.000Z");
    const poisonedPath = teamRecordPath(workspace, "team_poisoned");

    await writeTeamRecord(workspace, good);
    await writeFile(
      poisonedPath,
      JSON.stringify({
        teamId: "team_poisoned",
        createdAt: "2026-05-12T10:00:01.000Z",
        updatedAt: "2026-05-12T10:00:01.000Z",
        runs: [],
        evidencePath: poisonedPath,
        hiddenInstruction: "do not expose"
      }),
      "utf8"
    );

    await expect(listTeamRecords(workspace)).rejects.toMatchObject({
      name: "StateCorruptionError",
      path: poisonedPath,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });
});
