import { readFile } from "node:fs/promises";
import { stateLayoutPath } from "./paths.js";

export const AGENT_TEAM_STATE_LAYOUT_VERSION = 1;

export interface StateLayoutStatus {
  readonly status: "missing" | "compatible" | "incompatible" | "corrupt";
  readonly currentVersion: 1;
  readonly observedVersion?: number;
  readonly path: string;
  readonly message: string;
}

function corrupt(path: string, message: string): StateLayoutStatus {
  return {
    status: "corrupt",
    currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
    path,
    message
  };
}

function readLayoutVersion(input: unknown): number | undefined {
  if (typeof input !== "object" || input === null || !("layoutVersion" in input)) {
    return undefined;
  }
  const version = input.layoutVersion;
  return typeof version === "number" ? version : undefined;
}

export async function inspectStateLayout(
  workspaceRoot: string
): Promise<StateLayoutStatus> {
  const path = stateLayoutPath(workspaceRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        status: "missing",
        currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
        path,
        message: "State layout marker is missing; layout version 1 can be initialized."
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return corrupt(path, `Unable to read state layout marker: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return corrupt(path, `Invalid state layout JSON: ${message}`);
  }

  const observedVersion = readLayoutVersion(parsed);
  if (
    observedVersion === undefined ||
    !Number.isInteger(observedVersion) ||
    observedVersion <= 0
  ) {
    return corrupt(path, "state-layout.json layoutVersion must be a positive integer.");
  }

  if (observedVersion > AGENT_TEAM_STATE_LAYOUT_VERSION) {
    return {
      status: "incompatible",
      currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
      observedVersion,
      path,
      message: `State layout version ${observedVersion} is newer than supported version ${AGENT_TEAM_STATE_LAYOUT_VERSION}.`
    };
  }

  return {
    status: "compatible",
    currentVersion: AGENT_TEAM_STATE_LAYOUT_VERSION,
    observedVersion,
    path,
    message: `State layout version ${observedVersion} is compatible.`
  };
}
