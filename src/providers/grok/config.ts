import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  GrokProfileConfig,
  ProviderCapability
} from "../../core/types.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";

export const GROK_PROVIDER_PREFIX = "grok";

export function grokProviderId(profileId: string): string {
  return `${GROK_PROVIDER_PREFIX}:${profileId}`;
}

export function grokProfileIdFromProviderId(providerId: string): string | undefined {
  const prefix = `${GROK_PROVIDER_PREFIX}:`;
  return providerId.startsWith(prefix) ? providerId.slice(prefix.length) : undefined;
}

export function isGrokProviderId(providerId: string): boolean {
  return grokProfileIdFromProviderId(providerId) !== undefined;
}

export function resolveGrokProfile(
  config: AgentTeamConfig,
  providerId: string
): GrokProfileConfig | undefined {
  const profileId = grokProfileIdFromProviderId(providerId);
  if (profileId === undefined) {
    return undefined;
  }
  return config.providers.grok.profiles.find((profile) => profile.id === profileId);
}

function profileCapabilities(profile: GrokProfileConfig): readonly ProviderCapability[] {
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

function profileWarnings(profile: GrokProfileConfig): readonly string[] {
  const warnings: string[] = [];
  if (profile.baseUrl === undefined) {
    warnings.push(`Grok profile ${profile.id} is missing baseUrl.`);
  }
  if (profile.model === undefined) {
    warnings.push(`Grok profile ${profile.id} is missing model.`);
  }
  if (profile.apiKeyEnv === undefined) {
    warnings.push(`Grok profile ${profile.id} is missing apiKeyEnv.`);
  }
  if (profileCapabilities(profile).length === 0) {
    warnings.push(`Grok profile ${profile.id} declares no supported capabilities.`);
  }
  return warnings;
}

export function grokProfileDescriptor(profile: GrokProfileConfig): AgentProviderDescriptor {
  const capabilities = profileCapabilities(profile);
  const warnings = profileWarnings(profile);
  return {
    id: grokProviderId(profile.id),
    displayName: profile.displayName ?? `Grok ${profile.model ?? profile.id}`,
    authMode: "api-key",
    capabilities,
    available: warnings.length === 0,
    ...(profile.model === undefined ? {} : { model: profile.model }),
    ...(warnings.length === 0 ? {} : { warnings })
  };
}

export function listGrokProviders(
  config: AgentTeamConfig
): readonly AgentProviderDescriptor[] {
  const grok = config.providers.grok ?? DEFAULT_AGENT_TEAM_CONFIG.providers.grok;
  if (!grok.enabled) {
    return [];
  }
  return grok.profiles.map(grokProfileDescriptor);
}
