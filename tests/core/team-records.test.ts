import { describe, expect, it, vi } from "vitest";
import { StateCorruptionError } from "../../src/core/errors.js";
import {
  createAgentTeamRecord,
  getAgentTeamRecord,
  listAgentTeamRecords
} from "../../src/core/team-records.js";
import type { AgentTeamRecord, RunSidecar } from "../../src/core/types.js";

const now = "2026-05-12T10:00:00.000Z";

function sidecar(runId: string): RunSidecar {
  return {
    runId,
    role: "planner",
    provider: "claude-code-cli",
    status: "running",
    createdAt: now,
    updatedAt: now,
    capabilitiesUsed: ["structuredOutput"],
    evidencePaths: []
  };
}

describe("team-records", () => {
  it("creates a durable team record after verifying every referenced run", async () => {
    const readRun = vi.fn(async (_cwd: string, runId: string) => sidecar(runId));
    const writeTeam = vi.fn(async () => {});

    const result = await createAgentTeamRecord(
      {
        cwd: "/repo",
        name: "Review Team",
        description: "Parallel review",
        runs: [
          { runId: "run_a", cwd: "/repo", correlationId: "architect" },
          { runId: "run_b", cwd: "/other" }
        ]
      },
      {
        createTeamId: () => "team_fixed",
        now: () => now,
        readRun,
        writeTeam
      }
    );

    expect(readRun).toHaveBeenCalledWith("/repo", "run_a");
    expect(readRun).toHaveBeenCalledWith("/other", "run_b");
    expect(writeTeam).toHaveBeenCalledTimes(1);
    expect(writeTeam).toHaveBeenCalledWith(
      "/repo",
      expect.objectContaining({
        teamId: "team_fixed",
        name: "Review Team",
        description: "Parallel review",
        createdAt: now,
        updatedAt: now,
        runs: [
          { runId: "run_a", cwd: "/repo", correlationId: "architect" },
          { runId: "run_b", cwd: "/other" }
        ],
        evidencePath: "/repo/.agent-team/teams/team_fixed.json"
      })
    );
    expect(result).toEqual({
      status: "created",
      team: expect.objectContaining({
        teamId: "team_fixed",
        runs: [
          { runId: "run_a", cwd: "/repo", correlationId: "architect" },
          { runId: "run_b", cwd: "/other" }
        ]
      })
    });
  });

  it("generates team-prefixed ids by default", async () => {
    const result = await createAgentTeamRecord(
      {
        cwd: "/repo",
        runs: [{ runId: "run_a", cwd: "/repo" }]
      },
      {
        now: () => now,
        async readRun(_cwd, runId) {
          return sidecar(runId);
        },
        async writeTeam() {}
      }
    );

    expect(result.team.teamId).toMatch(/^team_/);
  });

  it("rejects duplicate run refs before reading or writing state", async () => {
    const readRun = vi.fn(async (_cwd: string, runId: string) => sidecar(runId));
    const writeTeam = vi.fn(async () => {});

    await expect(
      createAgentTeamRecord(
        {
          cwd: "/repo",
          runs: [
            { runId: "run_a", cwd: "/repo", correlationId: "one" },
            { runId: "run_a", cwd: "/repo", correlationId: "two" }
          ]
        },
        {
          createTeamId: () => "team_fixed",
          now: () => now,
          readRun,
          writeTeam
        }
      )
    ).rejects.toThrow("Duplicate team run ref: run_a");

    expect(readRun).not.toHaveBeenCalled();
    expect(writeTeam).not.toHaveBeenCalled();
  });

  it("does not write a team record when a referenced run sidecar is corrupt", async () => {
    const writeTeam = vi.fn(async () => {});

    await expect(
      createAgentTeamRecord(
        {
          cwd: "/repo",
          runs: [{ runId: "run_corrupt", cwd: "/repo" }]
        },
        {
          createTeamId: () => "team_fixed",
          now: () => now,
          async readRun() {
            throw new StateCorruptionError("Invalid JSON", {
              path: "/repo/.agent-team/runs/run_corrupt.json",
              kind: "json"
            });
          },
          writeTeam
        }
      )
    ).rejects.toThrow(StateCorruptionError);

    expect(writeTeam).not.toHaveBeenCalled();
  });

  it("reads and lists team records without touching run sidecars", async () => {
    const team: AgentTeamRecord = {
      teamId: "team_existing",
      createdAt: now,
      updatedAt: now,
      runs: [{ runId: "run_a", cwd: "/repo" }],
      evidencePath: "/repo/.agent-team/teams/team_existing.json"
    };
    const readTeam = vi.fn(async () => team);
    const listTeams = vi.fn(async () => [team]);
    const readRun = vi.fn(async (_cwd: string, runId: string) => sidecar(runId));

    await expect(
      getAgentTeamRecord(
        { cwd: "/repo", teamId: "team_existing" },
        { readTeam }
      )
    ).resolves.toEqual({ status: "ok", team });
    await expect(
      listAgentTeamRecords("/repo", { listTeams })
    ).resolves.toEqual({ status: "ok", teams: [team] });

    expect(readRun).not.toHaveBeenCalled();
  });
});
