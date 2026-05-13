import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { STATE_DIR } from "./state/paths.js";
import { PROVIDER_CAPABILITIES } from "./types.js";
import type { AgentTeamConfig, RoleId } from "./types.js";
import { listRoles } from "./roles.js";

export class AgentTeamConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTeamConfigError";
  }
}

export const AGENT_TEAM_CONFIG_SCHEMA_VERSION = 1;

export const DEFAULT_AGENT_TEAM_CONFIG: AgentTeamConfig = {
  schemaVersion: AGENT_TEAM_CONFIG_SCHEMA_VERSION,
  writeMode: {
    enabled: false,
    requireIsolatedWorktree: true
  },
  auth: {
    allowApiKeyFallback: false
  },
  routing: {
    rolePins: {},
    providerOrder: []
  },
  policy: {
    allowedRoles: [],
    allowedProviderSelectors: [],
    allowWriteMode: true,
    allowedWorktreeRoots: [],
    liveSmokeEnabled: false,
    auditEnabled: true
  },
  providers: {
    claudeCodeCli: {
      profiles: []
    },
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
    },
    ollamaClaudeCode: {
      enabled: false,
      apiKeyEnv: "OLLAMA_API_KEY",
      profiles: []
    },
    grok: {
      enabled: false,
      profiles: []
    },
    gemini: {
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

function readStrictBoolean(input: unknown, fallback: boolean, context: string): boolean {
  if (input === undefined) {
    return fallback;
  }
  if (typeof input !== "boolean") {
    throw new AgentTeamConfigError(`${context} must be a boolean.`);
  }
  return input;
}

function parseConfigSchemaVersion(parsed: unknown): 1 {
  if (typeof parsed !== "object" || parsed === null || !("schemaVersion" in parsed)) {
    return AGENT_TEAM_CONFIG_SCHEMA_VERSION;
  }
  const version = (parsed as Record<string, unknown>).schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version <= 0) {
    throw new AgentTeamConfigError("schemaVersion must be an integer greater than zero.");
  }
  if (version !== AGENT_TEAM_CONFIG_SCHEMA_VERSION) {
    throw new AgentTeamConfigError(
      `Unsupported config schemaVersion ${version}; supported version is ${AGENT_TEAM_CONFIG_SCHEMA_VERSION}.`
    );
  }
  return AGENT_TEAM_CONFIG_SCHEMA_VERSION;
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

function optionalArrayField(input: unknown, key: string, context: string): readonly unknown[] {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return [];
  }
  const value = input[key as keyof typeof input];
  if (!Array.isArray(value)) {
    throw new AgentTeamConfigError(`${context} must be an array.`);
  }
  return value;
}

function readRequiredId(input: unknown, fallback: string): string {
  return readString(input) ?? fallback;
}

const ROLE_IDS = new Set<RoleId>(listRoles().map((role) => role.id));
const PROVIDER_CAPABILITY_SET = new Set<string>(PROVIDER_CAPABILITIES);

function assertRoutingSelector(selector: string): void {
  const capabilityPrefix = "capability:";
  if (selector.startsWith(capabilityPrefix)) {
    const capability = selector.slice(capabilityPrefix.length);
    if (!PROVIDER_CAPABILITY_SET.has(capability)) {
      throw new AgentTeamConfigError(
        `Routing selector ${selector} references unsupported capability ${capability}.`
      );
    }
  }
}

function readRoutingSelector(input: unknown, context: string): string {
  const selector = readString(input);
  if (selector === undefined) {
    throw new AgentTeamConfigError(`${context} must be a non-empty string.`);
  }
  assertRoutingSelector(selector);
  return selector;
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
      const subject =
        input.profileId === "provider"
          ? `${input.providerName} provider`
          : `${input.providerName} profile ${input.profileId}`;
      throw new AgentTeamConfigError(
        `${subject} does not support capability ${capability}.`
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

function parseClaudeCodeCliProviderConfig(
  providers: Record<string, unknown>
): AgentTeamConfig["providers"]["claudeCodeCli"] {
  const claudeCodeCli = objectField(providers, "claudeCodeCli");
  const seenIds = new Set<string>();
  const profiles = arrayField(claudeCodeCli, "profiles").map((profile, index) => {
    const profileObject = typeof profile === "object" && profile !== null
      ? (profile as Record<string, unknown>)
      : {};
    const profileId = readRequiredId(profileObject.id, `profile-${index + 1}`);
    if (seenIds.has(profileId)) {
      throw new AgentTeamConfigError(`Duplicate Claude Code CLI profile id: ${profileId}`);
    }
    seenIds.add(profileId);
    const capabilities = objectField(profileObject, "capabilities");
    const model = readString(profileObject.model);
    const displayName = readString(profileObject.displayName);

    return {
      id: profileId,
      ...(model === undefined ? {} : { model }),
      ...(displayName === undefined ? {} : { displayName }),
      writeValidated: readBoolean(profileObject.writeValidated, false),
      capabilities: {
        structuredOutput: readBoolean(capabilities.structuredOutput, true),
        longContext: readBoolean(capabilities.longContext, false),
        tools: readBoolean(capabilities.tools, true),
        sessionResume: readBoolean(capabilities.sessionResume, true),
        cancellation: readBoolean(capabilities.cancellation, true),
        reasoning: readBoolean(capabilities.reasoning, false),
        edits: readBoolean(capabilities.edits, false),
        workspaceIsolation: readBoolean(capabilities.workspaceIsolation, false)
      }
    };
  });

  return { profiles };
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

function parseOllamaClaudeCodeProviderConfig(
  providers: Record<string, unknown>
): AgentTeamConfig["providers"]["ollamaClaudeCode"] {
  const ollamaClaudeCode = objectField(providers, "ollamaClaudeCode");
  const baseUrl = readString(ollamaClaudeCode.baseUrl);
  const apiKeyEnv =
    readString(ollamaClaudeCode.apiKeyEnv) ??
    DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode.apiKeyEnv;
  const seenIds = new Set<string>();
  const profiles = arrayField(ollamaClaudeCode, "profiles").map((profile, index) => {
    const profileObject = typeof profile === "object" && profile !== null
      ? (profile as Record<string, unknown>)
      : {};
    const profileId = readRequiredId(profileObject.id, `profile-${index + 1}`);
    if (seenIds.has(profileId)) {
      throw new AgentTeamConfigError(`Duplicate Ollama Claude Code profile id: ${profileId}`);
    }
    seenIds.add(profileId);
    const capabilities = objectField(profileObject, "capabilities");
    const model = readString(profileObject.model);
    const displayName = readString(profileObject.displayName);

    return {
      id: profileId,
      ...(model === undefined ? {} : { model }),
      ...(displayName === undefined ? {} : { displayName }),
      writeValidated: readBoolean(profileObject.writeValidated, false),
      capabilities: {
        structuredOutput: readBoolean(capabilities.structuredOutput, true),
        longContext: readBoolean(capabilities.longContext, false),
        tools: readBoolean(capabilities.tools, true),
        sessionResume: readBoolean(capabilities.sessionResume, true),
        cancellation: readBoolean(capabilities.cancellation, true),
        reasoning: readBoolean(capabilities.reasoning, false),
        edits: readBoolean(capabilities.edits, false),
        workspaceIsolation: readBoolean(capabilities.workspaceIsolation, false)
      }
    };
  });

  return {
    enabled: readBoolean(
      ollamaClaudeCode.enabled,
      DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode.enabled
    ),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    apiKeyEnv,
    profiles
  };
}

function parseGrokProviderConfig(
  providers: Record<string, unknown>
): AgentTeamConfig["providers"]["grok"] {
  const grok = objectField(providers, "grok");
  const seenIds = new Set<string>();
  const profiles = arrayField(grok, "profiles").map((profile, index) => {
    const profileObject = typeof profile === "object" && profile !== null
      ? (profile as Record<string, unknown>)
      : {};
    const profileId = readRequiredId(profileObject.id, `profile-${index + 1}`);
    if (seenIds.has(profileId)) {
      throw new AgentTeamConfigError(`Duplicate Grok profile id: ${profileId}`);
    }
    seenIds.add(profileId);
    const capabilities = objectField(profileObject, "capabilities");
    assertSupportedProfileCapabilities({
      providerName: "Grok",
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
    enabled: readBoolean(grok.enabled, DEFAULT_AGENT_TEAM_CONFIG.providers.grok.enabled),
    profiles
  };
}

function parseGeminiProviderConfig(
  providers: Record<string, unknown>
): AgentTeamConfig["providers"]["gemini"] {
  const gemini = objectField(providers, "gemini");
  const capabilities = objectField(gemini, "capabilities");
  assertSupportedProfileCapabilities({
    providerName: "Gemini",
    profileId: "provider",
    capabilities
  });
  const baseUrl = readString(gemini.baseUrl);
  const model = readString(gemini.model);
  const apiKeyEnv = readString(gemini.apiKeyEnv);
  const displayName = readString(gemini.displayName);

  return {
    enabled: readBoolean(gemini.enabled, DEFAULT_AGENT_TEAM_CONFIG.providers.gemini.enabled),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(model === undefined ? {} : { model }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(displayName === undefined ? {} : { displayName }),
    capabilities: {
      structuredOutput: readBoolean(
        capabilities.structuredOutput,
        DEFAULT_AGENT_TEAM_CONFIG.providers.gemini.capabilities.structuredOutput
      ),
      longContext: readBoolean(
        capabilities.longContext,
        DEFAULT_AGENT_TEAM_CONFIG.providers.gemini.capabilities.longContext
      ),
      reasoning: readBoolean(
        capabilities.reasoning,
        DEFAULT_AGENT_TEAM_CONFIG.providers.gemini.capabilities.reasoning
      )
    }
  };
}

function parseRoutingConfig(
  parsed: unknown
): AgentTeamConfig["routing"] {
  const routing = objectField(parsed, "routing");
  const rolePinsInput = objectField(routing, "rolePins");
  const rolePins: Partial<Record<RoleId, string>> = {};
  for (const [roleId, selectorInput] of Object.entries(rolePinsInput)) {
    if (!ROLE_IDS.has(roleId as RoleId)) {
      throw new AgentTeamConfigError(`Invalid routing role pin: ${roleId}`);
    }
    rolePins[roleId as RoleId] = readRoutingSelector(
      selectorInput,
      `Routing selector for ${roleId}`
    );
  }

  const providerOrder = arrayField(routing, "providerOrder").map((selectorInput, index) =>
    readRoutingSelector(selectorInput, `routing.providerOrder[${index}]`)
  );

  return {
    rolePins,
    providerOrder
  };
}

function parsePolicyConfig(parsed: unknown): AgentTeamConfig["policy"] {
  const policy = objectField(parsed, "policy");
  const allowedRoles = optionalArrayField(
    policy,
    "allowedRoles",
    "policy.allowedRoles"
  ).map((roleInput, index) => {
    const roleId = readString(roleInput);
    if (roleId === undefined || !ROLE_IDS.has(roleId as RoleId)) {
      throw new AgentTeamConfigError(`Invalid policy.allowedRoles[${index}].`);
    }
    return roleId as RoleId;
  });

  const allowedProviderSelectors = optionalArrayField(
    policy,
    "allowedProviderSelectors",
    "policy.allowedProviderSelectors"
  ).map((selectorInput, index) =>
    readRoutingSelector(selectorInput, `policy.allowedProviderSelectors[${index}]`)
  );

  const allowedWorktreeRoots = optionalArrayField(
    policy,
    "allowedWorktreeRoots",
    "policy.allowedWorktreeRoots"
  ).map((rootInput, index) => {
    const root = readString(rootInput);
    if (root === undefined) {
      throw new AgentTeamConfigError(`policy.allowedWorktreeRoots[${index}] must be a non-empty string.`);
    }
    return root;
  });

  return {
    allowedRoles,
    allowedProviderSelectors,
    allowWriteMode: readStrictBoolean(
      policy.allowWriteMode,
      DEFAULT_AGENT_TEAM_CONFIG.policy.allowWriteMode,
      "policy.allowWriteMode"
    ),
    allowedWorktreeRoots,
    liveSmokeEnabled: readStrictBoolean(
      policy.liveSmokeEnabled,
      DEFAULT_AGENT_TEAM_CONFIG.policy.liveSmokeEnabled,
      "policy.liveSmokeEnabled"
    ),
    auditEnabled: readStrictBoolean(
      policy.auditEnabled,
      DEFAULT_AGENT_TEAM_CONFIG.policy.auditEnabled,
      "policy.auditEnabled"
    )
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
    schemaVersion: parseConfigSchemaVersion(parsed),
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
    routing: parseRoutingConfig(parsed),
    providers: {
      claudeCodeCli: parseClaudeCodeCliProviderConfig(providers),
      openaiCompatible: parseOpenAICompatibleProviderConfig(providers),
      ollamaCloud: parseOllamaCloudProviderConfig(providers),
      ollamaClaudeCode: parseOllamaClaudeCodeProviderConfig(providers),
      grok: parseGrokProviderConfig(providers),
      gemini: parseGeminiProviderConfig(providers)
    },
    policy: parsePolicyConfig(parsed)
  };

  if (config.writeMode.enabled && !config.writeMode.requireIsolatedWorktree) {
    throw new AgentTeamConfigError("writeMode.enabled requires isolated worktrees.");
  }

  return config;
}
