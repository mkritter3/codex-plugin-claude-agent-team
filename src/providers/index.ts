import { DEFAULT_AGENT_TEAM_CONFIG } from "../core/config.js";
import { execFileSync } from "node:child_process";
import type { AgentProviderDescriptor, AgentTeamConfig } from "../core/types.js";
import { listClaudeCodeCliProfileProviders } from "./claude-code-cli/config.js";
import { openAICompatibleProvider } from "./openai-compatible/config.js";
import { listOllamaCloudProviders } from "./ollama-cloud/config.js";
import { listOllamaClaudeCodeProviders } from "./ollama-claude-code/config.js";
import { listGrokProviders } from "./grok/config.js";
import { geminiProvider } from "./gemini/config.js";
import { agyProvider } from "./agy/config.js";
import { codexCliProvider } from "./codex-cli/config.js";

const BASE_CLAUDE_CAPABILITIES = [
  "structuredOutput",
  "longContext",
  "tools",
  "sessionResume",
  "cancellation"
] as const;

const WRITE_CLAUDE_CAPABILITIES = ["edits", "workspaceIsolation"] as const;

export function claudeCodeCliProvider(
  config: AgentTeamConfig = DEFAULT_AGENT_TEAM_CONFIG,
  options: { readonly executableAvailable?: boolean } = {}
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
  available: options.executableAvailable ?? executableOnPath("claude")
  };
}

export const CLAUDE_CODE_CLI_PROVIDER: AgentProviderDescriptor = claudeCodeCliProvider(
  DEFAULT_AGENT_TEAM_CONFIG,
  { executableAvailable: true }
);

export interface LocalCliAvailability {
  readonly claude?: boolean;
  readonly agy?: boolean;
  readonly codex?: boolean;
  readonly ollama?: boolean;
}

function executableOnPath(name: string): boolean {
  try {
    execFileSync("which", [name], {
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

export function listProviders(
  input: {
    readonly config?: AgentTeamConfig;
    readonly cliAvailability?: LocalCliAvailability;
    readonly env?: NodeJS.ProcessEnv;
  } = {}
): readonly AgentProviderDescriptor[] {
  const config = input.config ?? DEFAULT_AGENT_TEAM_CONFIG;
  const env = input.env ?? process.env;
  const availability = {
    claude: input.cliAvailability?.claude ?? executableOnPath("claude"),
    agy: input.cliAvailability?.agy ?? executableOnPath(
      config.providers.agy.executable
    ),
    codex: input.cliAvailability?.codex ?? executableOnPath(
      config.providers.codexCli.executable
    ),
    ollama: input.cliAvailability?.ollama ?? executableOnPath(
      config.providers.ollamaClaudeCode.executable
    )
  };
  const providers: AgentProviderDescriptor[] = [
    claudeCodeCliProvider(config, { executableAvailable: availability.claude }),
    ...listClaudeCodeCliProfileProviders(config)
  ];
  const openAIProvider = openAICompatibleProvider(config);
  if (openAIProvider !== undefined) {
    providers.push(openAIProvider);
  }
  providers.push(...listOllamaCloudProviders(config, { env }));
  providers.push(
    ...listOllamaClaudeCodeProviders(config, {
      env,
      ollamaAvailable: availability.ollama,
      claudeAvailable: availability.claude
    })
  );
  providers.push(...listGrokProviders(config));
  const gemini = geminiProvider(config);
  if (gemini !== undefined) {
    providers.push(gemini);
  }
  const agy = agyProvider(config, { executableAvailable: availability.agy });
  if (agy !== undefined) {
    providers.push(agy);
  }
  const codexCli = codexCliProvider(config, { executableAvailable: availability.codex });
  if (codexCli !== undefined) {
    providers.push(codexCli);
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
