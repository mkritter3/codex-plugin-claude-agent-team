import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  GeminiCliProviderConfig,
  ProviderCapability
} from "../../core/types.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";

export const GEMINI_CLI_PROVIDER_ID = "gemini-cli";

function providerCapabilities(
  provider: GeminiCliProviderConfig
): readonly ProviderCapability[] {
  const capabilities: ProviderCapability[] = [];
  if (provider.capabilities.structuredOutput) {
    capabilities.push("structuredOutput");
  }
  if (provider.capabilities.longContext) {
    capabilities.push("longContext");
  }
  if (provider.capabilities.reasoning) {
    capabilities.push("reasoning");
  }
  if (provider.writeValidated && provider.capabilities.tools) {
    capabilities.push("tools");
  }
  if (provider.writeValidated && provider.capabilities.sessionResume) {
    capabilities.push("sessionResume");
  }
  if (provider.writeValidated && provider.capabilities.cancellation) {
    capabilities.push("cancellation");
  }
  if (provider.writeValidated && provider.capabilities.edits) {
    capabilities.push("edits");
  }
  if (provider.writeValidated && provider.capabilities.workspaceIsolation) {
    capabilities.push("workspaceIsolation");
  }
  return capabilities;
}

function providerWarnings(provider: GeminiCliProviderConfig): readonly string[] {
  const warnings: string[] = [];
  if (provider.executable.trim().length === 0) {
    warnings.push("Gemini CLI provider is missing executable.");
  }
  if (provider.model === undefined) {
    warnings.push("Gemini CLI provider is missing model.");
  }
  if (
    !provider.writeValidated &&
    (provider.capabilities.tools ||
      provider.capabilities.edits ||
      provider.capabilities.sessionResume ||
      provider.capabilities.cancellation ||
      provider.capabilities.workspaceIsolation)
  ) {
    warnings.push("Gemini CLI provider declares write capabilities without writeValidated.");
  }
  if (providerCapabilities(provider).length === 0) {
    warnings.push("Gemini CLI provider declares no supported capabilities.");
  }
  return warnings;
}

export function geminiCliProviderDescriptor(
  config: AgentTeamConfig
): AgentProviderDescriptor {
  const provider =
    config.providers.geminiCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli;
  const capabilities = providerCapabilities(provider);
  const warnings = providerWarnings(provider);
  return {
    id: GEMINI_CLI_PROVIDER_ID,
    displayName: provider.displayName ?? "Gemini CLI",
    authMode: "oauth",
    capabilities,
    available: warnings.length === 0,
    ...(provider.model === undefined ? {} : { model: provider.model }),
    ...(warnings.length === 0 ? {} : { warnings })
  };
}

export function geminiCliProvider(
  config: AgentTeamConfig
): AgentProviderDescriptor | undefined {
  const provider =
    config.providers.geminiCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli;
  return provider.enabled ? geminiCliProviderDescriptor(config) : undefined;
}
