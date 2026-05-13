import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
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
  const warnings: string[] = [];
  if (config.providers.ollamaClaudeCode.baseUrl === undefined) {
    warnings.push("Ollama Claude Code provider is missing baseUrl.");
  }
  if (config.providers.ollamaClaudeCode.apiKeyEnv.trim().length === 0) {
    warnings.push("Ollama Claude Code provider is missing apiKeyEnv.");
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
  profile: OllamaClaudeCodeProfileConfig
): AgentProviderDescriptor {
  const capabilities = profileCapabilities(profile);
  const warnings = profileWarnings(config, profile);
  return {
    id: ollamaClaudeCodeProviderId(profile.id),
    displayName: profile.displayName ?? `Ollama Claude Code ${profile.model ?? profile.id}`,
    authMode: "api-key",
    capabilities,
    available: warnings.length === 0,
    ...(profile.model === undefined ? {} : { model: profile.model }),
    ...(warnings.length === 0 ? {} : { warnings })
  };
}

export function listOllamaClaudeCodeProviders(
  config: AgentTeamConfig
): readonly AgentProviderDescriptor[] {
  const ollamaClaudeCode =
    config.providers.ollamaClaudeCode ??
    DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode;
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
    ollamaClaudeCodeProfileDescriptor(config, profile)
  );
}

export function scopedOllamaClaudeCodeEnv(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
}): NodeJS.ProcessEnv {
  const token = input.env[input.apiKeyEnv];
  return {
    ...input.env,
    ANTHROPIC_BASE_URL: input.baseUrl,
    ...(token === undefined || token.trim().length === 0
      ? {}
      : {
          OLLAMA_API_KEY: token,
          ANTHROPIC_AUTH_TOKEN: token,
          ANTHROPIC_API_KEY: ""
        })
  };
}
