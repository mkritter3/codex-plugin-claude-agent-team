import type {
  AgentProviderDescriptor,
  AgentTeamConfig,
  OllamaClaudeCodeLaunchMode,
  ProviderAuthMode
} from "../../core/types.js";
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
  ollamaClaudeCodeSettings,
  ollamaClaudeCodeProfileDescriptor,
  resolveOllamaClaudeCodeProfile,
  scopedOllamaClaudeCodeEnv
} from "./config.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";
import type { ClaudeCommand, ClaudeCommandWrapper } from "../claude-code-cli/types.js";

export interface OllamaClaudeCodeRuntimeOptions {
  readonly config?: AgentTeamConfig;
  readonly runClaudePrint?: typeof runClaudePrint;
  readonly startClaudeBackgroundSession?: typeof startClaudeBackgroundSession;
}

interface ResolvedProfile {
  readonly providerId: string;
  readonly displayName: string;
  readonly launchMode: OllamaClaudeCodeLaunchMode;
  readonly baseUrl: string;
  readonly authToken: string;
  readonly executable: string;
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
  const settings = ollamaClaudeCodeSettings(config);
  if (!settings.enabled) {
    return "Ollama Claude Code provider is disabled.";
  }
  const profile = resolveOllamaClaudeCodeProfile(config, providerId);
  if (profile === undefined) {
    return `Ollama Claude Code profile not found for provider ${providerId}.`;
  }
  if (settings.baseUrl === undefined) {
    return `Ollama Claude Code profile ${profile.displayName ?? profile.id} requires baseUrl.`;
  }
  if (profile.model === undefined) {
    return `Ollama Claude Code profile ${profile.displayName ?? profile.id} requires model.`;
  }
  return {
    providerId,
    displayName: profile.displayName ?? profile.id,
    launchMode: settings.launchMode,
    baseUrl: settings.baseUrl,
    authToken: settings.authToken,
    executable: settings.executable,
    apiKeyEnv: settings.apiKeyEnv,
    model: profile.model
  };
}

function isDirectApi(endpoint: ResolvedProfile): boolean {
  return endpoint.launchMode === "direct-api";
}

function providerAuthMode(endpoint: ResolvedProfile): ProviderAuthMode {
  return isDirectApi(endpoint) ? "api-key" : "ollama-local";
}

function modelForClaudeCommand(endpoint: ResolvedProfile): string | undefined {
  return endpoint.launchMode === "ollama-launch" ? undefined : endpoint.model;
}

function ollamaLaunchCommandWrapper(endpoint: ResolvedProfile): ClaudeCommandWrapper | undefined {
  if (endpoint.launchMode !== "ollama-launch") {
    return undefined;
  }
  return (command: ClaudeCommand): ClaudeCommand => ({
    command: endpoint.executable,
    args: [
      "launch",
      "claude",
      "--model",
      endpoint.model,
      "--yes",
      "--",
      ...command.args
    ],
    cwd: command.cwd
  });
}

function scopedEnvOrFailure(
  endpoint: ResolvedProfile,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv | string {
  const token = env[endpoint.apiKeyEnv];
  if (isDirectApi(endpoint) && (token === undefined || token.trim().length === 0)) {
    return `Ollama Claude Code profile ${endpoint.displayName} requires auth env ${endpoint.apiKeyEnv}.`;
  }
  return scopedOllamaClaudeCodeEnv({
    env,
    launchMode: endpoint.launchMode,
    baseUrl: endpoint.baseUrl,
    authToken: endpoint.authToken,
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

      const model = modelForClaudeCommand(endpoint);
      const commandWrapper = ollamaLaunchCommandWrapper(endpoint);
      return runPrint({
        ...input,
        ...(model === undefined ? {} : { model }),
        env,
        ...(commandWrapper === undefined ? {} : { commandWrapper })
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

      const model = modelForClaudeCommand(endpoint);
      const commandWrapper = ollamaLaunchCommandWrapper(endpoint);
      return startSession({
        ...input,
        providerAuthMode: providerAuthMode(endpoint),
        ...(model === undefined ? {} : { model }),
        env,
        ...(commandWrapper === undefined ? {} : { commandWrapper })
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
      const ollamaPath =
        endpoint.launchMode === "ollama-launch"
          ? await input.findExecutable(endpoint.executable)
          : undefined;
      const present = isDirectApi(endpoint)
        ? (input.env[endpoint.apiKeyEnv]?.trim().length ?? 0) > 0
        : true;
      const checks: ProviderHealthCheck[] = [
        {
          id: `${endpoint.providerId}:config`,
          status: "pass",
          message: `Ollama Claude Code profile ${endpoint.displayName} config is explicit.`,
          details: {
            providerId: endpoint.providerId,
            launchMode: endpoint.launchMode,
            hasBaseUrl: true,
            hasModel: true,
            ...(isDirectApi(endpoint) ? { apiKeyEnv: endpoint.apiKeyEnv } : {})
          }
        },
        isDirectApi(endpoint)
          ? {
              id: `${endpoint.providerId}:auth-env`,
              status: present ? "pass" : "fail",
              message: present
                ? `Ollama Claude Code profile ${endpoint.displayName} auth env is present.`
                : `Ollama Claude Code profile ${endpoint.displayName} auth env ${endpoint.apiKeyEnv} is missing.`,
              details: { env: endpoint.apiKeyEnv, present }
            }
          : {
              id: `${endpoint.providerId}:ollama-local-auth`,
              status: "warn",
              message:
                "Ollama Claude Code uses local Ollama authentication, but cloud model access is not live-proved by doctor.",
              details: {
                baseUrl: endpoint.baseUrl,
                authTokenPresent: endpoint.authToken.trim().length > 0,
                liveProofRequired: true
              }
            }
      ];

      if (endpoint.launchMode === "ollama-launch") {
        checks.push(
          ollamaPath === undefined
            ? {
                id: `${endpoint.providerId}:ollama-cli`,
                status: "fail",
                message: "Ollama CLI was not found on PATH.",
                details: {
                  executable: endpoint.executable,
                  fix: "Install Ollama, sign in if using cloud models, and ensure ollama is available on PATH."
                }
              }
            : {
                id: `${endpoint.providerId}:ollama-cli`,
                status: "pass",
                message: "Ollama CLI found for native Claude Code launch.",
                details: {
                  path: ollamaPath,
                  version: await input.getVersion(ollamaPath)
                }
              }
        );
      }

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
