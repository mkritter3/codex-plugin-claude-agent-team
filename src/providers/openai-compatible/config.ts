import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";
import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  ProviderCapability
} from "../../core/types.js";

export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible";

export function resolveOpenAICompatibleConfig(
  inputConfig: AgentTeamConfig | undefined,
  defaultConfig: AgentTeamConfig | undefined
): AgentTeamConfig {
  return inputConfig ?? defaultConfig ?? DEFAULT_AGENT_TEAM_CONFIG;
}

export function configuredOpenAICompatibleCapabilities(
  config: AgentTeamConfig
): readonly ProviderCapability[] {
  const capabilities: ProviderCapability[] = [];
  const declared = config.providers.openaiCompatible.capabilities;
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

export function openAICompatibleDescriptor(
  config: AgentTeamConfig
): AgentProviderDescriptor {
  const providerConfig = config.providers.openaiCompatible;
  const capabilities = providerConfig.enabled
    ? configuredOpenAICompatibleCapabilities(config)
    : [];
  const warnings: string[] = [];

  if (providerConfig.enabled && capabilities.length === 0) {
    warnings.push(
      "OpenAI-compatible provider is enabled but declares no supported capabilities."
    );
  }
  if (providerConfig.enabled && providerConfig.baseUrl === undefined) {
    warnings.push("OpenAI-compatible provider is missing baseUrl.");
  }
  if (providerConfig.enabled && providerConfig.model === undefined) {
    warnings.push("OpenAI-compatible provider is missing model.");
  }
  if (providerConfig.enabled && providerConfig.apiKeyEnv === undefined) {
    warnings.push("OpenAI-compatible provider is missing apiKeyEnv.");
  }

  return {
    id: OPENAI_COMPATIBLE_PROVIDER_ID,
    displayName: providerConfig.displayName ?? "OpenAI-Compatible Provider",
    authMode: "api-key",
    capabilities,
    available: providerConfig.enabled && capabilities.length > 0,
    ...(providerConfig.model === undefined ? {} : { model: providerConfig.model }),
    ...(warnings.length === 0 ? {} : { warnings })
  };
}

export function openAICompatibleProvider(
  config: AgentTeamConfig
): AgentProviderDescriptor | undefined {
  if (!config.providers.openaiCompatible.enabled) {
    return undefined;
  }
  return openAICompatibleDescriptor(config);
}
