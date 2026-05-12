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
    },
    ollamaCloud: {
      enabled: false,
      profiles: []
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

function arrayField(input: unknown, key: string): readonly unknown[] {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return [];
  }
  const value = input[key as keyof typeof input];
  return Array.isArray(value) ? value : [];
}

function readRequiredId(input: unknown, fallback: string): string {
  return readString(input) ?? fallback;
}

function assertSupportedProfileCapabilities(input: {
  readonly providerName: string;
  readonly profileId: string;
  readonly capabilities: Record<string, unknown>;
}): void {
  const unsupportedCapabilities = [
    "tools",
    "edits",
    "sessionResume",
    "cancellation",
    "workspaceIsolation",
    "parallelDispatch"
  ];

  for (const capability of unsupportedCapabilities) {
    if (input.capabilities[capability] === true) {
      throw new AgentTeamConfigError(
        `${input.providerName} profile ${input.profileId} does not support capability ${capability}.`
      );
    }
  }
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

function parseOllamaCloudProviderConfig(
  providers: Record<string, unknown>
): AgentTeamConfig["providers"]["ollamaCloud"] {
  const ollamaCloud = objectField(providers, "ollamaCloud");
  const seenIds = new Set<string>();
  const profiles = arrayField(ollamaCloud, "profiles").map((profile, index) => {
    const profileObject = typeof profile === "object" && profile !== null
      ? (profile as Record<string, unknown>)
      : {};
    const profileId = readRequiredId(profileObject.id, `profile-${index + 1}`);
    if (seenIds.has(profileId)) {
      throw new AgentTeamConfigError(`Duplicate Ollama Cloud profile id: ${profileId}`);
    }
    seenIds.add(profileId);
    const capabilities = objectField(profileObject, "capabilities");
    assertSupportedProfileCapabilities({
      providerName: "Ollama Cloud",
      profileId,
      capabilities
    });
    const baseUrl = readString(profileObject.baseUrl);
    const model = readString(profileObject.model);
    const apiKeyEnv = readString(profileObject.apiKeyEnv);
    const displayName = readString(profileObject.displayName);

    return {
      id: profileId,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(model === undefined ? {} : { model }),
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
      ...(displayName === undefined ? {} : { displayName }),
      capabilities: {
        structuredOutput: readBoolean(capabilities.structuredOutput, false),
        longContext: readBoolean(capabilities.longContext, false),
        reasoning: readBoolean(capabilities.reasoning, false)
      }
    };
  });

  return {
    enabled: readBoolean(
      ollamaCloud.enabled,
      DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaCloud.enabled
    ),
    profiles
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
      openaiCompatible: parseOpenAICompatibleProviderConfig(providers),
      ollamaCloud: parseOllamaCloudProviderConfig(providers)
    }
  };

  if (config.writeMode.enabled && !config.writeMode.requireIsolatedWorktree) {
    throw new AgentTeamConfigError("writeMode.enabled requires isolated worktrees.");
  }

  return config;
}
