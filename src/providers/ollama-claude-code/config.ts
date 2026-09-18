import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  OllamaClaudeCodeLaunchMode,
  OllamaClaudeCodeProfileConfig,
  ProviderCapability
} from "../../core/types.js";
import { AgentTeamConfigError, DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";

export const OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX = "ollama-claude-code";

export function ollamaClaudeCodeProviderId(profileId: string): string {
  return `${OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:${profileId}`;
}

export function ollamaClaudeCodeProfileIdFromProviderId(
  providerId: string
): string | undefined {
  const prefix = `${OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:`;
  return providerId.startsWith(prefix) ? providerId.slice(prefix.length) : undefined;
}

export function isOllamaClaudeCodeProviderId(providerId: string): boolean {
  return ollamaClaudeCodeProfileIdFromProviderId(providerId) !== undefined;
}

export function resolveOllamaClaudeCodeProfile(
  config: AgentTeamConfig,
  providerId: string
): OllamaClaudeCodeProfileConfig | undefined {
  const profileId = ollamaClaudeCodeProfileIdFromProviderId(providerId);
  if (profileId === undefined) {
    return undefined;
  }
  return config.providers.ollamaClaudeCode.profiles.find(
    (profile) => profile.id === profileId
  );
}

export function ollamaClaudeCodeSettings(
  config: AgentTeamConfig
): AgentTeamConfig["providers"]["ollamaClaudeCode"] {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode,
    ...config.providers.ollamaClaudeCode
  };
}

function isDirectApiLaunchMode(launchMode: OllamaClaudeCodeLaunchMode): boolean {
  return launchMode === "direct-api";
}

function profileCapabilities(
  profile: OllamaClaudeCodeProfileConfig
): readonly ProviderCapability[] {
  const capabilities: ProviderCapability[] = [];
  if (profile.capabilities.structuredOutput !== false) {
    capabilities.push("structuredOutput");
  }
  if (profile.capabilities.longContext) {
    capabilities.push("longContext");
  }
  if (profile.capabilities.tools !== false) {
    capabilities.push("tools");
  }
  if (profile.capabilities.sessionResume !== false) {
    capabilities.push("sessionResume");
  }
  if (profile.capabilities.cancellation !== false) {
    capabilities.push("cancellation");
  }
  if (profile.capabilities.reasoning) {
    capabilities.push("reasoning");
  }
  if (profile.writeValidated && profile.capabilities.edits) {
    capabilities.push("edits");
  }
  if (profile.writeValidated && profile.capabilities.workspaceIsolation) {
    capabilities.push("workspaceIsolation");
  }
  return capabilities;
}

function profileWarnings(
  config: AgentTeamConfig,
  profile: OllamaClaudeCodeProfileConfig
): readonly string[] {
  const settings = ollamaClaudeCodeSettings(config);
  const warnings: string[] = [];
  if (settings.baseUrl === undefined) {
    warnings.push("Ollama Claude Code provider is missing baseUrl.");
  }
  if (isDirectApiLaunchMode(settings.launchMode) && settings.apiKeyEnv.trim().length === 0) {
    warnings.push("Ollama Claude Code provider is missing apiKeyEnv.");
  }
  if (!isDirectApiLaunchMode(settings.launchMode) && settings.authToken.trim().length === 0) {
    warnings.push("Ollama Claude Code provider is missing authToken.");
  }
  if (settings.launchMode === "ollama-launch" && settings.executable.trim().length === 0) {
    warnings.push("Ollama Claude Code launch mode is missing executable.");
  }
  if (profile.model === undefined) {
    warnings.push(`Ollama Claude Code profile ${profile.id} is missing model.`);
  }
  if (
    !profile.writeValidated &&
    (profile.capabilities.edits || profile.capabilities.workspaceIsolation)
  ) {
    warnings.push(
      `Ollama Claude Code profile ${profile.id} declares write capabilities without writeValidated.`
    );
  }
  if (profileCapabilities(profile).length === 0) {
    warnings.push(
      `Ollama Claude Code profile ${profile.id} declares no supported capabilities.`
    );
  }
  return warnings;
}

export function ollamaClaudeCodeProfileDescriptor(
  config: AgentTeamConfig,
  profile: OllamaClaudeCodeProfileConfig,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly ollamaAvailable?: boolean;
    readonly claudeAvailable?: boolean;
  } = {}
): AgentProviderDescriptor {
  const settings = ollamaClaudeCodeSettings(config);
  const capabilities = profileCapabilities(profile);
  const warnings = profileWarnings(config, profile);
  const env = options.env ?? process.env;
  const authPresent = (env[settings.apiKeyEnv] ?? "").trim().length > 0;
  const authWarnings = isDirectApiLaunchMode(settings.launchMode) && !authPresent
    ? [`Ollama Claude Code profile ${profile.id} auth env ${settings.apiKeyEnv} is missing.`]
    : [];
  const launchWarnings =
    settings.launchMode === "ollama-launch" && options.ollamaAvailable === false
      ? ["Ollama Claude Code launch mode requires the ollama CLI on PATH."]
      : [];
  const claudeWarnings =
    options.claudeAvailable === false
      ? ["Ollama Claude Code requires the claude CLI on PATH."]
      : [];
  const combinedWarnings = [...warnings, ...authWarnings, ...launchWarnings, ...claudeWarnings];
  return {
    id: ollamaClaudeCodeProviderId(profile.id),
    displayName: profile.displayName ?? `Ollama Claude Code ${profile.model ?? profile.id}`,
    authMode: isDirectApiLaunchMode(settings.launchMode) ? "api-key" : "ollama-local",
    capabilities,
    available: combinedWarnings.length === 0,
    ...(profile.model === undefined ? {} : { model: profile.model }),
    ...(combinedWarnings.length === 0
      ? {}
      : { warnings: combinedWarnings })
  };
}

export function listOllamaClaudeCodeProviders(
  config: AgentTeamConfig,
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly ollamaAvailable?: boolean;
    readonly claudeAvailable?: boolean;
  } = {}
): readonly AgentProviderDescriptor[] {
  const ollamaClaudeCode =
    ollamaClaudeCodeSettings(config);
  if (!ollamaClaudeCode.enabled) {
    return [];
  }
  const seen = new Set<string>();
  for (const profile of ollamaClaudeCode.profiles) {
    if (seen.has(profile.id)) {
      throw new AgentTeamConfigError(`Duplicate Ollama Claude Code profile id: ${profile.id}`);
    }
    seen.add(profile.id);
  }
  return ollamaClaudeCode.profiles.map((profile) =>
    ollamaClaudeCodeProfileDescriptor(config, profile, options)
  );
}

export function scopedOllamaClaudeCodeEnv(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly launchMode: OllamaClaudeCodeLaunchMode;
  readonly baseUrl: string;
  readonly authToken: string;
  readonly apiKeyEnv: string;
}): NodeJS.ProcessEnv {
  const token = input.env[input.apiKeyEnv];
  const {
    ANTHROPIC_API_KEY: _anthropicApiKey,
    ANTHROPIC_AUTH_TOKEN: _anthropicAuthToken,
    ANTHROPIC_BASE_URL: _anthropicBaseUrl,
    CLAUDE_CODE_OAUTH_TOKEN: _claudeCodeOauthToken,
    OLLAMA_API_KEY: _ollamaApiKey,
    ...envWithoutKnownAuth
  } = input.env;
  const baseEnv: NodeJS.ProcessEnv = { ...envWithoutKnownAuth };
  delete baseEnv[input.apiKeyEnv];
  if (isDirectApiLaunchMode(input.launchMode)) {
    return {
      ...baseEnv,
      ANTHROPIC_BASE_URL: input.baseUrl,
      ANTHROPIC_API_KEY: "",
      ...(token === undefined || token.trim().length === 0
        ? {}
        : {
            OLLAMA_API_KEY: token,
            ANTHROPIC_AUTH_TOKEN: token
          })
    };
  }
  return {
    ...baseEnv,
    ANTHROPIC_BASE_URL: input.baseUrl,
    ANTHROPIC_AUTH_TOKEN: input.authToken,
    ANTHROPIC_API_KEY: ""
  };
}
