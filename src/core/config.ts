import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STATE_DIR } from "./state/paths.js";
import type { AgentTeamConfig } from "./types.js";

export class AgentTeamConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTeamConfigError";
  }
}

export const DEFAULT_AGENT_TEAM_CONFIG: AgentTeamConfig = {
  writeMode: {
    enabled: false,
    requireIsolatedWorktree: true
  },
  auth: {
    allowApiKeyFallback: false
  }
};

function readBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function objectField(input: unknown, key: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return {};
  }
  const value = input[key as keyof typeof input];
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export async function loadAgentTeamConfig(
  workspaceRoot: string
): Promise<AgentTeamConfig> {
  const path = join(workspaceRoot, STATE_DIR, "config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return DEFAULT_AGENT_TEAM_CONFIG;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AgentTeamConfigError(`Invalid agent-team config at ${path}: ${message}`);
  }

  const writeMode = objectField(parsed, "writeMode");
  const auth = objectField(parsed, "auth");
  const config: AgentTeamConfig = {
    writeMode: {
      enabled: readBoolean(
        writeMode.enabled,
        DEFAULT_AGENT_TEAM_CONFIG.writeMode.enabled
      ),
      requireIsolatedWorktree: readBoolean(
        writeMode.requireIsolatedWorktree,
        DEFAULT_AGENT_TEAM_CONFIG.writeMode.requireIsolatedWorktree
      )
    },
    auth: {
      allowApiKeyFallback: readBoolean(
        auth.allowApiKeyFallback,
        DEFAULT_AGENT_TEAM_CONFIG.auth.allowApiKeyFallback
      )
    }
  };

  if (config.writeMode.enabled && !config.writeMode.requireIsolatedWorktree) {
    throw new AgentTeamConfigError("writeMode.enabled requires isolated worktrees.");
  }

  return config;
}
