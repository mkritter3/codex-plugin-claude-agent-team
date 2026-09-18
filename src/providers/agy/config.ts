import { isAgyExecutable } from "./agy.js";
import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  AgyProviderConfig,
  ProviderCapability
} from "../../core/types.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";

export const AGY_PROVIDER_ID = "agy";

function providerCapabilities(
  provider: AgyProviderConfig
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
  if (provider.capabilities.sessionResume) {
    capabilities.push("sessionResume");
  }
  if (provider.capabilities.cancellation) {
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

function providerWarnings(provider: AgyProviderConfig): readonly string[] {
  const warnings: string[] = [];
  if (!isAgyExecutable(provider.executable)) {
    warnings.push("AGY provider requires an AGY executable.");
  }
  if (
    !provider.writeValidated &&
    (provider.capabilities.tools ||
      provider.capabilities.edits ||
      provider.capabilities.workspaceIsolation)
  ) {
    warnings.push("AGY provider declares write capabilities without writeValidated.");
  }
  if (providerCapabilities(provider).length === 0) {
    warnings.push("AGY provider declares no supported capabilities.");
  }
  return warnings;
}

export function agyProviderDescriptor(
  config: AgentTeamConfig,
  options: { readonly executableAvailable?: boolean } = {}
): AgentProviderDescriptor {
  const provider =
    config.providers.agy ?? DEFAULT_AGENT_TEAM_CONFIG.providers.agy;
  const capabilities = providerCapabilities(provider);
  const warnings = providerWarnings(provider);
  return {
    id: AGY_PROVIDER_ID,
    displayName: provider.displayName ?? "Gemini via AGY",
    authMode: "oauth",
    capabilities,
    available: (options.executableAvailable ?? true) && warnings.length === 0,
    ...(provider.model === undefined ? {} : { model: provider.model }),
    ...(warnings.length === 0 && options.executableAvailable !== false
      ? {}
      : {
          warnings: [
            ...warnings,
            ...(options.executableAvailable === false
              ? [`AGY executable ${provider.executable} was not found on PATH.`]
              : [])
          ]
        })
  };
}

export function agyProvider(
  config: AgentTeamConfig,
  options: { readonly executableAvailable?: boolean } = {}
): AgentProviderDescriptor | undefined {
  const provider =
    config.providers.agy ?? DEFAULT_AGENT_TEAM_CONFIG.providers.agy;
  return provider.enabled ? agyProviderDescriptor(config, options) : undefined;
}
