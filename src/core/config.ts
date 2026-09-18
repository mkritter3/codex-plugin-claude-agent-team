import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentTeamConfigError } from "./errors.js";
import { STATE_DIR } from "./state/paths.js";
import { PROVIDER_CAPABILITIES } from "./types.js";
import type { AgentTeamConfig, RoleId } from "./types.js";
import { listRoles } from "./roles.js";
import { parseSeniorReviewPolicyConfig } from "./workflow-policy.js";
import { DEFAULT_SENIOR_REVIEW_POLICY } from "./workflow-types.js";

export { AgentTeamConfigError } from "./errors.js";

export const AGENT_TEAM_CONFIG_SCHEMA_VERSION = 1;

export const DEFAULT_AGENT_TEAM_CONFIG: AgentTeamConfig = {
  schemaVersion: AGENT_TEAM_CONFIG_SCHEMA_VERSION,
  writeMode: {
    enabled: true,
    requireIsolatedWorktree: true
  },
  auth: {
    allowApiKeyFallback: false
  },
  routing: {
    rolePins: {},
    providerOrder: [
      "family:ollama-claude-code",
      "claude-code-cli",
      "family:ollama-cloud",
      "gemini-cli",
      "codex-cli"
    ]
  },
  policy: {
    allowedRoles: [],
    allowedProviderSelectors: [],
    allowWriteMode: true,
    allowedWorktreeRoots: [],
    liveSmokeEnabled: false,
    auditEnabled: true
  },
  seniorReview: DEFAULT_SENIOR_REVIEW_POLICY,
  providers: {
    claudeCodeCli: {
      profiles: [
        {
          id: "opus",
          model: "opus",
          displayName: "Claude Opus - planning and senior review",
          writeValidated: false,
          capabilities: {
            structuredOutput: true,
            longContext: true,
            tools: true,
            sessionResume: true,
            cancellation: true,
            reasoning: true,
            edits: false,
            workspaceIsolation: false
          }
        }
      ]
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
      enabled: true,
      profiles: [
        {
          id: "glm-5.2",
          baseUrl: "https://ollama.com/v1",
          model: "glm-5.2",
          apiKeyEnv: "OLLAMA_API_KEY",
          displayName: "GLM 5.2",
          capabilities: {
            structuredOutput: true,
            longContext: true,
            reasoning: false
          }
        },
        {
          id: "kimi-k2.7-code",
          baseUrl: "https://ollama.com/v1",
          model: "kimi-k2.7-code",
          apiKeyEnv: "OLLAMA_API_KEY",
          displayName: "Kimi K2.7 Code",
          capabilities: {
            structuredOutput: true,
            longContext: true,
            reasoning: false
          }
        }
      ]
    },
    ollamaClaudeCode: {
      enabled: true,
      launchMode: "ollama-launch",
      baseUrl: "http://localhost:11434",
      authToken: "ollama",
      executable: "ollama",
      apiKeyEnv: "OLLAMA_API_KEY",
      profiles: [
        {
          id: "glm-5.2",
          model: "glm-5.2:cloud",
          displayName: "GLM 5.2",
          writeValidated: true,
          capabilities: {
            structuredOutput: true,
            longContext: true,
            tools: true,
            sessionResume: true,
            cancellation: true,
            reasoning: false,
            edits: true,
            workspaceIsolation: true
          }
        },
        {
          id: "kimi-k2.7-code",
          model: "kimi-k2.7-code:cloud",
          displayName: "Kimi K2.7 Code",
          writeValidated: true,
          capabilities: {
            structuredOutput: true,
            longContext: true,
            tools: true,
            sessionResume: true,
            cancellation: true,
            reasoning: false,
            edits: true,
            workspaceIsolation: true
          }
        }
      ]
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
    },
    geminiCli: {
      enabled: true,
      executable: "gemini",
      projectEnv: "GOOGLE_CLOUD_PROJECT",
      writeValidated: true,
      capabilities: {
        structuredOutput: true,
        longContext: true,
        reasoning: true,
        tools: true,
        edits: true,
        sessionResume: true,
        cancellation: true,
        workspaceIsolation: true
      }
    },
    codexCli: {
      enabled: true,
      executable: "codex",
      writeValidated: true,
      capabilities: {
        structuredOutput: true,
        longContext: true,
        reasoning: true,
        tools: true,
        edits: true,
        sessionResume: true,
        cancellation: true,
        workspaceIsolation: true
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
  const rawProfiles = "profiles" in claudeCodeCli
    ? arrayField(claudeCodeCli, "profiles")
    : DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli.profiles;
  const profiles = rawProfiles.map((profile, index) => {
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
  const rawProfiles = "profiles" in ollamaCloud
    ? arrayField(ollamaCloud, "profiles")
    : DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaCloud.profiles;
  const profiles = rawProfiles.map((profile, index) => {
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
  const defaultConfig = DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode;
  const launchModeValue = readString(ollamaClaudeCode.launchMode) ?? defaultConfig.launchMode;
  if (
    launchModeValue !== "ollama-launch" &&
    launchModeValue !== "local-anthropic" &&
    launchModeValue !== "direct-api"
  ) {
    throw new AgentTeamConfigError(
      'providers.ollamaClaudeCode.launchMode must be "ollama-launch", "local-anthropic", or "direct-api".'
    );
  }
  const configuredBaseUrl = readString(ollamaClaudeCode.baseUrl);
  const baseUrl =
    configuredBaseUrl ??
    (launchModeValue === "direct-api" ? "https://ollama.com" : defaultConfig.baseUrl);
  const authToken = readString(ollamaClaudeCode.authToken) ?? defaultConfig.authToken;
  const executable = readString(ollamaClaudeCode.executable) ?? defaultConfig.executable;
  const apiKeyEnv =
    readString(ollamaClaudeCode.apiKeyEnv) ??
    defaultConfig.apiKeyEnv;
  const seenIds = new Set<string>();
  const defaultProfiles =
    launchModeValue === "direct-api"
      ? defaultConfig.profiles.map((profile) => ({
          ...profile,
          model: profile.id,
          writeValidated: false,
          capabilities: {
            ...profile.capabilities,
            edits: false,
            workspaceIsolation: false
          }
        }))
      : defaultConfig.profiles;
  const rawProfiles = "profiles" in ollamaClaudeCode
    ? arrayField(ollamaClaudeCode, "profiles")
    : defaultProfiles;
  const profiles = rawProfiles.map((profile, index) => {
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
      defaultConfig.enabled
    ),
    launchMode: launchModeValue,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    authToken,
    executable,
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

function parseGeminiCliProviderConfig(
  providers: Record<string, unknown>
): AgentTeamConfig["providers"]["geminiCli"] {
  const geminiCli = objectField(providers, "geminiCli");
  const capabilities = objectField(geminiCli, "capabilities");
  const driver = readString(geminiCli.driver);
  const agyWriteEnabled = readBoolean(geminiCli.writeValidated, false);
  if (driver !== undefined && driver !== "gemini" && driver !== "agy") throw new AgentTeamConfigError("geminiCli.driver must be gemini or agy");
  const executable =
    readString(geminiCli.executable) ??
    (driver === "agy" ? "agy" : DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.executable);
  const model = readString(geminiCli.model);
  const displayName = readString(geminiCli.displayName);
  const projectEnv =
    readString(geminiCli.projectEnv) ??
    DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.projectEnv;

  return {
    ...(driver === undefined ? {} : { driver }),
    enabled: readBoolean(
      geminiCli.enabled,
      DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.enabled
    ),
    executable,
    ...(model === undefined ? {} : { model }),
    ...(displayName === undefined ? {} : { displayName }),
    projectEnv,
    writeValidated: readBoolean(
      geminiCli.writeValidated,
      driver === "agy" ? false : DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.writeValidated
    ),
    capabilities: {
      structuredOutput: readBoolean(
        capabilities.structuredOutput,
        DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.capabilities.structuredOutput
      ),
      longContext: readBoolean(
        capabilities.longContext,
        DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.capabilities.longContext
      ),
      reasoning: readBoolean(
        capabilities.reasoning,
        DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.capabilities.reasoning
      ),
      tools: readBoolean(
        capabilities.tools,
        driver === "agy" && !agyWriteEnabled ? false : DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.capabilities.tools
      ),
      edits: readBoolean(
        capabilities.edits,
        driver === "agy" && !agyWriteEnabled ? false : DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.capabilities.edits
      ),
      sessionResume: readBoolean(
        capabilities.sessionResume,
        DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.capabilities.sessionResume
      ),
      cancellation: readBoolean(
        capabilities.cancellation,
        DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.capabilities.cancellation
      ),
      workspaceIsolation: readBoolean(
        capabilities.workspaceIsolation,
        driver === "agy" && !agyWriteEnabled ? false : DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli.capabilities.workspaceIsolation
      )
    }
  };
}

function parseCodexCliProviderConfig(
  providers: Record<string, unknown>
): AgentTeamConfig["providers"]["codexCli"] {
  const codexCli = objectField(providers, "codexCli");
  const capabilities = objectField(codexCli, "capabilities");
  const executable =
    readString(codexCli.executable) ??
    DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.executable;
  const model = readString(codexCli.model);
  const displayName = readString(codexCli.displayName);

  return {
    enabled: readBoolean(
      codexCli.enabled,
      DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.enabled
    ),
    executable,
    ...(model === undefined ? {} : { model }),
    ...(displayName === undefined ? {} : { displayName }),
    writeValidated: readBoolean(
      codexCli.writeValidated,
      DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.writeValidated
    ),
    capabilities: {
      structuredOutput: readBoolean(
        capabilities.structuredOutput,
        DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.capabilities.structuredOutput
      ),
      longContext: readBoolean(
        capabilities.longContext,
        DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.capabilities.longContext
      ),
      reasoning: readBoolean(
        capabilities.reasoning,
        DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.capabilities.reasoning
      ),
      tools: readBoolean(
        capabilities.tools,
        DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.capabilities.tools
      ),
      edits: readBoolean(
        capabilities.edits,
        DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.capabilities.edits
      ),
      sessionResume: readBoolean(
        capabilities.sessionResume,
        DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.capabilities.sessionResume
      ),
      cancellation: readBoolean(
        capabilities.cancellation,
        DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.capabilities.cancellation
      ),
      workspaceIsolation: readBoolean(
        capabilities.workspaceIsolation,
        DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli.capabilities.workspaceIsolation
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

  const providerOrderInput =
    "providerOrder" in routing
      ? arrayField(routing, "providerOrder")
      : DEFAULT_AGENT_TEAM_CONFIG.routing.providerOrder;
  const providerOrder = providerOrderInput.map((selectorInput, index) =>
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
      return {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        seniorReview: parseSeniorReviewPolicyConfig({})
      };
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
      gemini: parseGeminiProviderConfig(providers),
      geminiCli: parseGeminiCliProviderConfig(providers),
      codexCli: parseCodexCliProviderConfig(providers)
    },
    seniorReview: parseSeniorReviewPolicyConfig(parsed),
    policy: parsePolicyConfig(parsed)
  };

  if (config.writeMode.enabled && !config.writeMode.requireIsolatedWorktree) {
    throw new AgentTeamConfigError("writeMode.enabled requires isolated worktrees.");
  }

  return config;
}
