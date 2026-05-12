import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";
import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  ProviderCapability
} from "../../core/types.js";

export const GEMINI_PROVIDER_ID = "gemini";

export function resolveGeminiConfig(
  inputConfig: AgentTeamConfig | undefined,
  defaultConfig: AgentTeamConfig | undefined
): AgentTeamConfig {
  return inputConfig ?? defaultConfig ?? DEFAULT_AGENT_TEAM_CONFIG;
}

function configuredGeminiCapabilities(
  config: AgentTeamConfig
): readonly ProviderCapability[] {
  const capabilities: ProviderCapability[] = [];
  const declared = config.providers.gemini.capabilities;
  if (declared.structuredOutput) {
    capabilities.push("structuredOutput");
  }
  if (declared.longContext) {
    capabilities.push("longContext");
  }
  if (declared.reasoning) {
    capabilities.push("reasoning");
  }
  return capabilities;
}

export function geminiProviderDescriptor(
  config: AgentTeamConfig
): AgentProviderDescriptor {
  const providerConfig = config.providers.gemini;
  const capabilities = providerConfig.enabled
    ? configuredGeminiCapabilities(config)
    : [];
  const warnings: string[] = [];

  if (providerConfig.enabled && capabilities.length === 0) {
    warnings.push("Gemini provider is enabled but declares no supported capabilities.");
  }
  if (providerConfig.enabled && providerConfig.baseUrl === undefined) {
    warnings.push("Gemini provider is missing baseUrl.");
  }
  if (providerConfig.enabled && providerConfig.model === undefined) {
    warnings.push("Gemini provider is missing model.");
  }
  if (providerConfig.enabled && providerConfig.apiKeyEnv === undefined) {
    warnings.push("Gemini provider is missing apiKeyEnv.");
  }

  return {
    id: GEMINI_PROVIDER_ID,
    displayName: providerConfig.displayName ?? "Gemini Provider",
    authMode: "api-key",
    capabilities,
    available: providerConfig.enabled && warnings.length === 0,
    ...(providerConfig.model === undefined ? {} : { model: providerConfig.model }),
    ...(warnings.length === 0 ? {} : { warnings })
  };
}

export function geminiProvider(
  config: AgentTeamConfig
): AgentProviderDescriptor | undefined {
  if (!config.providers.gemini.enabled) {
    return undefined;
  }
  return geminiProviderDescriptor(config);
}
