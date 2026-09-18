import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  CodexCliProviderConfig,
  ProviderCapability
} from "../../core/types.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";

export const CODEX_CLI_PROVIDER_ID = "codex-cli";

function providerCapabilities(
  provider: CodexCliProviderConfig
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

function providerWarnings(provider: CodexCliProviderConfig): readonly string[] {
  const warnings: string[] = [];
  if (provider.executable.trim().length === 0) {
    warnings.push("Codex CLI provider is missing executable.");
  }
  if (
    !provider.writeValidated &&
    (provider.capabilities.tools ||
      provider.capabilities.edits ||
      provider.capabilities.sessionResume ||
      provider.capabilities.cancellation ||
      provider.capabilities.workspaceIsolation)
  ) {
    warnings.push("Codex CLI provider declares write capabilities without writeValidated.");
  }
  if (providerCapabilities(provider).length === 0) {
    warnings.push("Codex CLI provider declares no supported capabilities.");
  }
  return warnings;
}

export function codexCliProviderDescriptor(
  config: AgentTeamConfig,
  options: { readonly executableAvailable?: boolean } = {}
): AgentProviderDescriptor {
  const provider =
    config.providers.codexCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli;
  const capabilities = providerCapabilities(provider);
  const warnings = providerWarnings(provider);
  return {
    id: CODEX_CLI_PROVIDER_ID,
    displayName: provider.displayName ?? "Codex CLI",
    authMode: "subscription-oauth",
    capabilities,
    available: (options.executableAvailable ?? true) && warnings.length === 0,
    ...(provider.model === undefined ? {} : { model: provider.model }),
    ...(warnings.length === 0 && options.executableAvailable !== false
      ? {}
      : {
          warnings: [
            ...warnings,
            ...(options.executableAvailable === false
              ? [`Codex CLI executable ${provider.executable} was not found on PATH.`]
              : [])
          ]
        })
  };
}

export function codexCliProvider(
  config: AgentTeamConfig,
  options: { readonly executableAvailable?: boolean } = {}
): AgentProviderDescriptor | undefined {
  const provider =
    config.providers.codexCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli;
  return provider.enabled ? codexCliProviderDescriptor(config, options) : undefined;
}
