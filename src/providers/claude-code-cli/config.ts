import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  ClaudeCodeCliProfileConfig,
  ProviderCapability
} from "../../core/types.js";
import { AgentTeamConfigError, DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";

export const CLAUDE_CODE_CLI_PROVIDER_PREFIX = "claude-code-cli";

export function claudeCodeCliProfileProviderId(profileId: string): string {
  return `${CLAUDE_CODE_CLI_PROVIDER_PREFIX}:${profileId}`;
}

export function claudeCodeCliProfileIdFromProviderId(
  providerId: string
): string | undefined {
  const prefix = `${CLAUDE_CODE_CLI_PROVIDER_PREFIX}:`;
  return providerId.startsWith(prefix) ? providerId.slice(prefix.length) : undefined;
}

export function isClaudeCodeCliProfileProviderId(providerId: string): boolean {
  return claudeCodeCliProfileIdFromProviderId(providerId) !== undefined;
}

export function resolveClaudeCodeCliProfile(
  config: AgentTeamConfig,
  providerId: string
): ClaudeCodeCliProfileConfig | undefined {
  const profileId = claudeCodeCliProfileIdFromProviderId(providerId);
  if (profileId === undefined) {
    return undefined;
  }
  return config.providers.claudeCodeCli.profiles.find(
    (profile) => profile.id === profileId
  );
}

function profileCapabilities(
  profile: ClaudeCodeCliProfileConfig
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

function profileWarnings(profile: ClaudeCodeCliProfileConfig): readonly string[] {
  const warnings: string[] = [];
  if (profile.model === undefined) {
    warnings.push(`Claude Code CLI profile ${profile.id} is missing model.`);
  }
  if (
    !profile.writeValidated &&
    (profile.capabilities.edits || profile.capabilities.workspaceIsolation)
  ) {
    warnings.push(
      `Claude Code CLI profile ${profile.id} declares write capabilities without writeValidated.`
    );
  }
  if (profileCapabilities(profile).length === 0) {
    warnings.push(`Claude Code CLI profile ${profile.id} declares no supported capabilities.`);
  }
  return warnings;
}

export function claudeCodeCliProfileDescriptor(
  profile: ClaudeCodeCliProfileConfig
): AgentProviderDescriptor {
  const capabilities = profileCapabilities(profile);
  const warnings = profileWarnings(profile);
  return {
    id: claudeCodeCliProfileProviderId(profile.id),
    displayName: profile.displayName ?? `Claude Code CLI ${profile.model ?? profile.id}`,
    authMode: "subscription-oauth",
    capabilities,
    available: warnings.length === 0,
    ...(profile.model === undefined ? {} : { model: profile.model }),
    ...(warnings.length === 0 ? {} : { warnings })
  };
}

export function listClaudeCodeCliProfileProviders(
  config: AgentTeamConfig
): readonly AgentProviderDescriptor[] {
  const claudeCodeCli =
    config.providers.claudeCodeCli ??
    DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli;
  const seen = new Set<string>();
  for (const profile of claudeCodeCli.profiles) {
    if (seen.has(profile.id)) {
      throw new AgentTeamConfigError(`Duplicate Claude Code CLI profile id: ${profile.id}`);
    }
    seen.add(profile.id);
  }
  return claudeCodeCli.profiles.map(claudeCodeCliProfileDescriptor);
}
