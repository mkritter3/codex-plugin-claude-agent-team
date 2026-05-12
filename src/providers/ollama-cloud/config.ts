import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  OllamaCloudProfileConfig,
  ProviderCapability
} from "../../core/types.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";

export const OLLAMA_CLOUD_PROVIDER_PREFIX = "ollama-cloud";

export function ollamaCloudProviderId(profileId: string): string {
  return `${OLLAMA_CLOUD_PROVIDER_PREFIX}:${profileId}`;
}

export function ollamaCloudProfileIdFromProviderId(
  providerId: string
): string | undefined {
  const prefix = `${OLLAMA_CLOUD_PROVIDER_PREFIX}:`;
  return providerId.startsWith(prefix) ? providerId.slice(prefix.length) : undefined;
}

export function isOllamaCloudProviderId(providerId: string): boolean {
  return ollamaCloudProfileIdFromProviderId(providerId) !== undefined;
}

export function resolveOllamaCloudProfile(
  config: AgentTeamConfig,
  providerId: string
): OllamaCloudProfileConfig | undefined {
  const profileId = ollamaCloudProfileIdFromProviderId(providerId);
  if (profileId === undefined) {
    return undefined;
  }
  return config.providers.ollamaCloud.profiles.find(
    (profile) => profile.id === profileId
  );
}

function profileCapabilities(
  profile: OllamaCloudProfileConfig
): readonly ProviderCapability[] {
  const capabilities: ProviderCapability[] = [];
  if (profile.capabilities.structuredOutput) {
    capabilities.push("structuredOutput");
  }
  if (profile.capabilities.longContext) {
    capabilities.push("longContext");
  }
  if (profile.capabilities.reasoning) {
    capabilities.push("reasoning");
  }
  return capabilities;
}

function profileWarnings(profile: OllamaCloudProfileConfig): readonly string[] {
  const warnings: string[] = [];
  if (profile.baseUrl === undefined) {
    warnings.push(`Ollama Cloud profile ${profile.id} is missing baseUrl.`);
  }
  if (profile.model === undefined) {
    warnings.push(`Ollama Cloud profile ${profile.id} is missing model.`);
  }
  if (profile.apiKeyEnv === undefined) {
    warnings.push(`Ollama Cloud profile ${profile.id} is missing apiKeyEnv.`);
  }
  if (profileCapabilities(profile).length === 0) {
    warnings.push(`Ollama Cloud profile ${profile.id} declares no supported capabilities.`);
  }
  return warnings;
}

export function ollamaCloudProfileDescriptor(
  profile: OllamaCloudProfileConfig
): AgentProviderDescriptor {
  const capabilities = profileCapabilities(profile);
  const warnings = profileWarnings(profile);
  return {
    id: ollamaCloudProviderId(profile.id),
    displayName: profile.displayName ?? `Ollama Cloud ${profile.model ?? profile.id}`,
    authMode: "api-key",
    capabilities,
    available: warnings.length === 0,
    ...(profile.model === undefined ? {} : { model: profile.model }),
    ...(warnings.length === 0 ? {} : { warnings })
  };
}

export function listOllamaCloudProviders(
  config: AgentTeamConfig
): readonly AgentProviderDescriptor[] {
  const ollamaCloud =
    config.providers.ollamaCloud ?? DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaCloud;
  if (!ollamaCloud.enabled) {
    return [];
  }
  return ollamaCloud.profiles.map(ollamaCloudProfileDescriptor);
}
