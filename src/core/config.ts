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
  },
  providers: {
    openaiCompatible: {
      enabled: false,
      capabilities: {
        structuredOutput: false,
        longContext: false,
        reasoning: false
      }
    }
  }
};

function readBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === "boolean" ? input : fallback;
}

function readString(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const trimmed = input.trim();
  return trimmed.length === 0 ? undefined : trimmed;
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

function parseOpenAICompatibleProviderConfig(
  providers: Record<string, unknown>
): AgentTeamConfig["providers"]["openaiCompatible"] {
  const openaiCompatible = objectField(providers, "openaiCompatible");
  const capabilities = objectField(openaiCompatible, "capabilities");
  const baseUrl = readString(openaiCompatible.baseUrl);
  const model = readString(openaiCompatible.model);
  const apiKeyEnv = readString(openaiCompatible.apiKeyEnv);
  const displayName = readString(openaiCompatible.displayName);
  const unsupportedCapabilities = [
    "tools",
    "edits",
    "sessionResume",
    "cancellation",
    "workspaceIsolation",
    "parallelDispatch"
  ];

  for (const capability of unsupportedCapabilities) {
    if (capabilities[capability] === true) {
      throw new AgentTeamConfigError(
        `OpenAI-compatible provider does not support capability ${capability}.`
      );
    }
  }

  return {
    enabled: readBoolean(
      openaiCompatible.enabled,
      DEFAULT_AGENT_TEAM_CONFIG.providers.openaiCompatible.enabled
    ),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(model === undefined ? {} : { model }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(displayName === undefined ? {} : { displayName }),
    capabilities: {
      structuredOutput: readBoolean(
        capabilities.structuredOutput,
        DEFAULT_AGENT_TEAM_CONFIG.providers.openaiCompatible.capabilities
          .structuredOutput
      ),
      longContext: readBoolean(
        capabilities.longContext,
        DEFAULT_AGENT_TEAM_CONFIG.providers.openaiCompatible.capabilities.longContext
      ),
      reasoning: readBoolean(
        capabilities.reasoning,
        DEFAULT_AGENT_TEAM_CONFIG.providers.openaiCompatible.capabilities.reasoning
      )
    }
  };
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
  const providers = objectField(parsed, "providers");
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
    },
    providers: {
      openaiCompatible: parseOpenAICompatibleProviderConfig(providers)
    }
  };

  if (config.writeMode.enabled && !config.writeMode.requireIsolatedWorktree) {
    throw new AgentTeamConfigError("writeMode.enabled requires isolated worktrees.");
  }

  return config;
}
