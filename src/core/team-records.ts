import { resolve } from "node:path";
import { createRunId } from "./run-ids.js";
import { readRunSidecar } from "./state/run-store.js";
import {
  listTeamRecords,
  readTeamRecord,
  writeTeamRecord
} from "./state/team-store.js";
import { teamRecordPath } from "./state/paths.js";
import type {
  AgentTeamCreateRequest,
  AgentTeamCreateResult,
  AgentTeamGetRequest,
  AgentTeamGetResult,
  AgentTeamListResult,
  AgentTeamRecord,
  RunSidecar
} from "./types.js";

export interface TeamRecordDependencies {
  readonly createTeamId?: () => string;
  readonly now?: () => string;
  readonly readRun?: (cwd: string, runId: string) => Promise<RunSidecar>;
  readonly writeTeam?: (workspaceRoot: string, record: AgentTeamRecord) => Promise<void>;
  readonly readTeam?: (workspaceRoot: string, teamId: string) => Promise<AgentTeamRecord>;
  readonly listTeams?: (workspaceRoot: string) => Promise<readonly AgentTeamRecord[]>;
}

function defaultCreateTeamId(): string {
  return createRunId().replace(/^run_/, "team_");
}

function defaultNow(): string {
  return new Date().toISOString();
}

function assertUniqueRunRefs(request: AgentTeamCreateRequest): void {
  const seen = new Set<string>();
  for (const run of request.runs) {
    const key = `${resolve(run.cwd)}\0${run.runId}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate team run ref: ${run.runId}`);
    }
    seen.add(key);
  }
}

export async function createAgentTeamRecord(
  request: AgentTeamCreateRequest,
  deps: TeamRecordDependencies = {}
): Promise<AgentTeamCreateResult> {
  assertUniqueRunRefs(request);

  const readRun = deps.readRun ?? readRunSidecar;
  for (const run of request.runs) {
    await readRun(run.cwd, run.runId);
  }

  const teamId = (deps.createTeamId ?? defaultCreateTeamId)();
  const timestamp = (deps.now ?? defaultNow)();
  const team: AgentTeamRecord = {
    teamId,
    ...(request.name === undefined ? {} : { name: request.name }),
    ...(request.description === undefined ? {} : { description: request.description }),
    createdAt: timestamp,
    updatedAt: timestamp,
    runs: request.runs,
    evidencePath: teamRecordPath(request.cwd, teamId)
  };

  await (deps.writeTeam ?? writeTeamRecord)(request.cwd, team);

  return {
    status: "created",
    team
  };
}

export async function getAgentTeamRecord(
  request: AgentTeamGetRequest,
  deps: TeamRecordDependencies = {}
): Promise<AgentTeamGetResult> {
  return {
    status: "ok",
    team: await (deps.readTeam ?? readTeamRecord)(request.cwd, request.teamId)
  };
}

export async function listAgentTeamRecords(
  workspaceRoot: string,
  deps: TeamRecordDependencies = {}
): Promise<AgentTeamListResult> {
  return {
    status: "ok",
    teams: await (deps.listTeams ?? listTeamRecords)(workspaceRoot)
  };
}
