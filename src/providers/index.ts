import { DEFAULT_AGENT_TEAM_CONFIG } from "../core/config.js";
import type { AgentProviderDescriptor, AgentTeamConfig } from "../core/types.js";
import { openAICompatibleProvider } from "./openai-compatible/config.js";

const BASE_CLAUDE_CAPABILITIES = [
  "structuredOutput",
  "longContext",
  "tools",
  "sessionResume",
  "cancellation"
] as const;

const WRITE_CLAUDE_CAPABILITIES = ["edits", "workspaceIsolation"] as const;

export function claudeCodeCliProvider(
  config: AgentTeamConfig = DEFAULT_AGENT_TEAM_CONFIG
): AgentProviderDescriptor {
  const writeCapabilities =
    config.writeMode.enabled && config.writeMode.requireIsolatedWorktree
      ? WRITE_CLAUDE_CAPABILITIES
      : [];

  return {
  id: "claude-code-cli",
  displayName: "Claude Code CLI",
  authMode: "subscription-oauth",
  capabilities: [...BASE_CLAUDE_CAPABILITIES, ...writeCapabilities],
  available: true
  };
}

export const CLAUDE_CODE_CLI_PROVIDER: AgentProviderDescriptor = claudeCodeCliProvider();

export function listProviders(
  input: { readonly config?: AgentTeamConfig } = {}
): readonly AgentProviderDescriptor[] {
  const config = input.config ?? DEFAULT_AGENT_TEAM_CONFIG;
  const providers: AgentProviderDescriptor[] = [claudeCodeCliProvider(config)];
  const openAIProvider = openAICompatibleProvider(config);
  if (openAIProvider !== undefined) {
    providers.push(openAIProvider);
  }
  return providers;
}

export {
  getProviderRuntime,
  listProviderRuntimes,
  requireProviderRuntime,
  type AgentProviderRuntime,
  type ProviderRuntimeRegistryOptions
} from "./runtime.js";
