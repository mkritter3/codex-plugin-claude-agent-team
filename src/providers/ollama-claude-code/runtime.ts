import type { AgentProviderDescriptor, AgentTeamConfig } from "../../core/types.js";
import type {
  ProviderEnvironmentInspection,
  ProviderEnvironmentInspectionInput,
  ProviderHealthCheck,
  ProviderHealthCheckInput,
  ProviderPrintInput,
  ProviderPrintResult,
  ProviderSessionHandle,
  ProviderStartSessionInput
} from "../types.js";
import type { AgentProviderRuntime } from "../runtime.js";
import { runClaudePrint } from "../claude-code-cli/runner.js";
import { startClaudeBackgroundSession } from "../claude-code-cli/background.js";
import {
  OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX,
  ollamaClaudeCodeProfileDescriptor,
  resolveOllamaClaudeCodeProfile,
  scopedOllamaClaudeCodeEnv
} from "./config.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";

export interface OllamaClaudeCodeRuntimeOptions {
  readonly config?: AgentTeamConfig;
  readonly runClaudePrint?: typeof runClaudePrint;
  readonly startClaudeBackgroundSession?: typeof startClaudeBackgroundSession;
}

interface ResolvedProfile {
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly apiKeyEnv: string;
  readonly model: string;
}

function fail(message: string): ProviderPrintResult {
  return {
    ok: false,
    text: "",
    stdout: "",
    stderr: message,
    exitCode: 1
  };
}

function resolveConfig(
  inputConfig: AgentTeamConfig | undefined,
  runtimeConfig: AgentTeamConfig | undefined
): AgentTeamConfig {
  return inputConfig ?? runtimeConfig ?? DEFAULT_AGENT_TEAM_CONFIG;
}

function resolveProfile(
  config: AgentTeamConfig,
  providerId: string | undefined
): ResolvedProfile | string {
  if (providerId === undefined || !providerId.startsWith(`${OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:`)) {
    return "Ollama Claude Code runtime requires an ollama-claude-code provider id.";
  }
  if (!config.providers.ollamaClaudeCode.enabled) {
    return "Ollama Claude Code provider is disabled.";
  }
  const profile = resolveOllamaClaudeCodeProfile(config, providerId);
  if (profile === undefined) {
    return `Ollama Claude Code profile not found for provider ${providerId}.`;
  }
  if (config.providers.ollamaClaudeCode.baseUrl === undefined) {
    return `Ollama Claude Code profile ${profile.displayName ?? profile.id} requires baseUrl.`;
  }
  if (profile.model === undefined) {
    return `Ollama Claude Code profile ${profile.displayName ?? profile.id} requires model.`;
  }
  return {
    providerId,
    displayName: profile.displayName ?? profile.id,
    baseUrl: config.providers.ollamaClaudeCode.baseUrl,
    apiKeyEnv: config.providers.ollamaClaudeCode.apiKeyEnv,
    model: profile.model
  };
}

function scopedEnvOrFailure(
  endpoint: ResolvedProfile,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv | string {
  const token = env[endpoint.apiKeyEnv];
  if (token === undefined || token.trim().length === 0) {
    return `Ollama Claude Code profile ${endpoint.displayName} requires auth env ${endpoint.apiKeyEnv}.`;
  }
  return scopedOllamaClaudeCodeEnv({
    env,
    baseUrl: endpoint.baseUrl,
    apiKeyEnv: endpoint.apiKeyEnv
  });
}

export function createOllamaClaudeCodeRuntime(
  options: OllamaClaudeCodeRuntimeOptions = {}
): AgentProviderRuntime {
  const runPrint = options.runClaudePrint ?? runClaudePrint;
  const startSession = options.startClaudeBackgroundSession ?? startClaudeBackgroundSession;

  return {
    id: OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX,
    descriptor(config?: AgentTeamConfig): AgentProviderDescriptor {
      const resolved = resolveConfig(config, options.config);
      const profile = resolved.providers.ollamaClaudeCode.profiles[0];
      return profile === undefined
        ? {
            id: OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX,
            displayName: "Ollama Claude Code",
            authMode: "api-key",
            capabilities: [],
            available: false,
            warnings: ["Ollama Claude Code provider has no configured profiles."]
          }
        : ollamaClaudeCodeProfileDescriptor(resolved, profile);
    },
    inspectEnvironment(
      _input: ProviderEnvironmentInspectionInput
    ): ProviderEnvironmentInspection {
      return { warnings: [] };
    },
    async runPrint(input: ProviderPrintInput): Promise<ProviderPrintResult> {
      const config = resolveConfig(input.config, options.config);
      const endpoint = resolveProfile(config, input.providerId);
      if (typeof endpoint === "string") {
        return fail(endpoint);
      }
      const env = scopedEnvOrFailure(endpoint, input.env ?? process.env);
      if (typeof env === "string") {
        return fail(env);
      }

      return runPrint({
        ...input,
        model: endpoint.model,
        env
      });
    },
    startSession(input: ProviderStartSessionInput): ProviderSessionHandle {
      const config = resolveConfig(input.config, options.config);
      const endpoint = resolveProfile(config, input.providerId);
      if (typeof endpoint === "string") {
        throw new Error(endpoint);
      }
      const env = scopedEnvOrFailure(endpoint, input.env ?? process.env);
      if (typeof env === "string") {
        throw new Error(env);
      }

      return startSession({
        ...input,
        providerAuthMode: "api-key",
        model: endpoint.model,
        env
      });
    },
    async healthCheck(input: ProviderHealthCheckInput): Promise<readonly ProviderHealthCheck[]> {
      const config = resolveConfig(input.config, options.config);
      const endpoint = resolveProfile(config, input.providerId);
      if (typeof endpoint === "string") {
        return [
          {
            id: `${input.providerId ?? OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:config`,
            status: "fail",
            message: endpoint
          }
        ];
      }
      const claudePath = await input.findExecutable("claude");
      const present =
        (input.env[endpoint.apiKeyEnv]?.trim().length ?? 0) > 0;
      const checks: ProviderHealthCheck[] = [
        {
          id: `${endpoint.providerId}:config`,
          status: "pass",
          message: `Ollama Claude Code profile ${endpoint.displayName} config is explicit.`,
          details: {
            providerId: endpoint.providerId,
            hasBaseUrl: true,
            hasModel: true,
            apiKeyEnv: endpoint.apiKeyEnv
          }
        },
        {
          id: `${endpoint.providerId}:auth-env`,
          status: present ? "pass" : "fail",
          message: present
            ? `Ollama Claude Code profile ${endpoint.displayName} auth env is present.`
            : `Ollama Claude Code profile ${endpoint.displayName} auth env ${endpoint.apiKeyEnv} is missing.`,
          details: { env: endpoint.apiKeyEnv, present }
        }
      ];

      checks.push(
        claudePath === undefined
          ? {
              id: `${endpoint.providerId}:claude-cli`,
              status: "fail",
              message: "Claude Code CLI was not found on PATH.",
              details: {
                fix: "Install Claude Code CLI and ensure claude is available on PATH."
              }
            }
          : {
              id: `${endpoint.providerId}:claude-cli`,
              status: "pass",
              message: "Claude Code CLI found for Ollama Claude Code profile.",
              details: {
                path: claudePath,
                version: await input.getVersion(claudePath)
              }
            }
      );

      return checks;
    }
  };
}

export const ollamaClaudeCodeRuntime = createOllamaClaudeCodeRuntime();
