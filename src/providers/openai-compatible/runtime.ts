import type { AgentProviderDescriptor, AgentTeamConfig } from "../../core/types.js";
import type {
  ProviderEnvironmentInspection,
  ProviderEnvironmentInspectionInput,
  ProviderHealthCheck,
  ProviderHealthCheckInput,
  ProviderPrintInput,
  ProviderPrintResult,
  ProviderSessionHandle,
  ProviderSessionSnapshot,
  ProviderStartSessionInput
} from "../types.js";
import type { AgentProviderRuntime } from "../runtime.js";
import {
  OLLAMA_CLOUD_PROVIDER_PREFIX,
  resolveOllamaCloudProfile
} from "../ollama-cloud/config.js";
import {
  GROK_PROVIDER_PREFIX,
  resolveGrokProfile
} from "../grok/config.js";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  openAICompatibleDescriptor,
  openAICompatibleProvider,
  resolveOpenAICompatibleConfig
} from "./config.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleRuntimeOptions {
  readonly config?: AgentTeamConfig;
  readonly fetch?: FetchLike;
}

export { openAICompatibleProvider };

interface ResolvedEndpoint {
  readonly kind: "openai-compatible" | "ollama-cloud" | "grok";
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly structuredOutput: boolean;
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function resolveEndpoint(
  config: AgentTeamConfig,
  providerId: string | undefined
): ResolvedEndpoint | string {
  if (providerId?.startsWith(`${OLLAMA_CLOUD_PROVIDER_PREFIX}:`) === true) {
    if (!config.providers.ollamaCloud.enabled) {
      return "Ollama Cloud provider is disabled.";
    }
    const profile = resolveOllamaCloudProfile(config, providerId);
    if (profile === undefined) {
      return `Ollama Cloud profile not found for provider ${providerId}.`;
    }
    return {
      kind: "ollama-cloud",
      providerId,
      displayName: profile.displayName ?? profile.id,
      ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
      ...(profile.model === undefined ? {} : { model: profile.model }),
      ...(profile.apiKeyEnv === undefined ? {} : { apiKeyEnv: profile.apiKeyEnv }),
      structuredOutput: profile.capabilities.structuredOutput
    };
  }

  if (providerId?.startsWith(`${GROK_PROVIDER_PREFIX}:`) === true) {
    if (!config.providers.grok.enabled) {
      return "Grok provider is disabled.";
    }
    const profile = resolveGrokProfile(config, providerId);
    if (profile === undefined) {
      return `Grok profile not found for provider ${providerId}.`;
    }
    return {
      kind: "grok",
      providerId,
      displayName: profile.displayName ?? profile.id,
      ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
      ...(profile.model === undefined ? {} : { model: profile.model }),
      ...(profile.apiKeyEnv === undefined ? {} : { apiKeyEnv: profile.apiKeyEnv }),
      structuredOutput: profile.capabilities.structuredOutput
    };
  }

  if (providerId !== undefined && providerId !== OPENAI_COMPATIBLE_PROVIDER_ID) {
    return `OpenAI-compatible runtime cannot resolve provider ${providerId}.`;
  }

  const providerConfig = config.providers.openaiCompatible;
  return {
    kind: "openai-compatible",
    providerId: OPENAI_COMPATIBLE_PROVIDER_ID,
    displayName: providerConfig.displayName ?? "OpenAI-Compatible Provider",
    ...(providerConfig.baseUrl === undefined ? {} : { baseUrl: providerConfig.baseUrl }),
    ...(providerConfig.model === undefined ? {} : { model: providerConfig.model }),
    ...(providerConfig.apiKeyEnv === undefined ? {} : { apiKeyEnv: providerConfig.apiKeyEnv }),
    structuredOutput: providerConfig.capabilities.structuredOutput
  };
}

function endpointLabel(endpoint: ResolvedEndpoint): string {
  if (endpoint.kind === "ollama-cloud") {
    return `Ollama Cloud profile ${endpoint.displayName}`;
  }
  if (endpoint.kind === "grok") {
    return `Grok profile ${endpoint.displayName}`;
  }
  return "OpenAI-compatible provider";
}

function extractAssistantText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("choices" in body)) {
    return undefined;
  }
  const choices = (body as { readonly choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }
  for (const choice of choices) {
    if (typeof choice !== "object" || choice === null || !("message" in choice)) {
      continue;
    }
    const message = (choice as { readonly message?: unknown }).message;
    if (typeof message !== "object" || message === null || !("content" in message)) {
      continue;
    }
    const content = (message as { readonly content?: unknown }).content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content;
    }
  }
  return undefined;
}

function extractResponseId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("id" in body)) {
    return undefined;
  }
  const id = (body as { readonly id?: unknown }).id;
  return typeof id === "string" && id.trim().length > 0 ? id : undefined;
}

function unsupportedSessionHandle(input: ProviderStartSessionInput): ProviderSessionHandle {
  const warning =
    "OpenAI-compatible foundation does not support background sessions, resume, live stdin, cancellation, or edits.";
  let killed = false;
  let forceKilled = false;
  const snapshot = (): ProviderSessionSnapshot => ({
    providerSessionId: input.sessionId,
    text: "",
    warnings: [warning],
    recentActivities: [
      {
        type: "error",
        summary: warning,
        timestamp: Date.now()
      }
    ],
    currentActivity: null,
    pendingOutboxRequests: [],
    lastStderr: [warning],
    transcriptPath: undefined,
    logPath: undefined
  });

  return {
    providerSessionId: input.sessionId,
    done: Promise.resolve("failed"),
    recentActivities: snapshot().recentActivities,
    currentActivity: null,
    lastStderr: [warning],
    transcriptPath: undefined,
    logPath: undefined,
    supportsStdin: false,
    kill() {
      killed = true;
    },
    forceKill() {
      forceKilled = true;
    },
    snapshot() {
      const current = snapshot();
      return {
        ...current,
        warnings:
          killed || forceKilled
            ? [...current.warnings, "OpenAI-compatible unsupported session handle was closed."]
            : current.warnings
      };
    }
  };
}

export function createOpenAICompatibleRuntime(
  options: OpenAICompatibleRuntimeOptions = {}
): AgentProviderRuntime {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    id: OPENAI_COMPATIBLE_PROVIDER_ID,
    descriptor(config?: AgentTeamConfig): AgentProviderDescriptor {
      return openAICompatibleDescriptor(
        resolveOpenAICompatibleConfig(config, options.config)
      );
    },
    inspectEnvironment(
      _input: ProviderEnvironmentInspectionInput
    ): ProviderEnvironmentInspection {
      return { warnings: [] };
    },
    async runPrint(input: ProviderPrintInput): Promise<ProviderPrintResult> {
      const config = resolveOpenAICompatibleConfig(input.config, options.config);
      const endpoint = resolveEndpoint(config, input.providerId);
      if (typeof endpoint === "string") {
        return fail(endpoint);
      }
      if (
        endpoint.kind === "openai-compatible" &&
        !config.providers.openaiCompatible.enabled
      ) {
        return fail("OpenAI-compatible provider is disabled.");
      }
      if (!endpoint.structuredOutput) {
        return fail(
          `${endpointLabel(endpoint)} requires structuredOutput capability for dispatch.`
        );
      }
      if (endpoint.baseUrl === undefined) {
        return fail(`${endpointLabel(endpoint)} requires baseUrl.`);
      }
      if (endpoint.model === undefined) {
        return fail(`${endpointLabel(endpoint)} requires model.`);
      }
      if (endpoint.apiKeyEnv === undefined) {
        return fail(`${endpointLabel(endpoint)} requires apiKeyEnv.`);
      }

      const token = (input.env ?? process.env)[endpoint.apiKeyEnv];
      if (token === undefined || token.trim().length === 0) {
        return fail(
          `${endpointLabel(endpoint)} requires auth env ${endpoint.apiKeyEnv}.`
        );
      }

      try {
        const response = await fetchImpl(
          `${normalizeBaseUrl(endpoint.baseUrl)}/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              model: endpoint.model,
              messages: [{ role: "user", content: input.prompt }]
            })
          }
        );
        if (!response.ok) {
          return fail(`OpenAI-compatible request failed with HTTP ${response.status}.`);
        }
        const body = (await response.json()) as unknown;
        const text = extractAssistantText(body);
        if (text === undefined) {
          return fail("OpenAI-compatible response did not contain assistant text.");
        }
        const sessionId = extractResponseId(body);
        return {
          ok: true,
          text,
          stdout: JSON.stringify(body),
          stderr: "",
          exitCode: 0,
          ...(sessionId === undefined ? {} : { sessionId })
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(`OpenAI-compatible request failed: ${message}`);
      }
    },
    startSession(input: ProviderStartSessionInput): ProviderSessionHandle {
      return unsupportedSessionHandle(input);
    },
    async healthCheck(input: ProviderHealthCheckInput): Promise<readonly ProviderHealthCheck[]> {
      const config = resolveOpenAICompatibleConfig(input.config, options.config);
      const endpoint = resolveEndpoint(config, input.providerId);
      if (typeof endpoint === "string") {
        return [
          {
            id: `${input.providerId ?? OPENAI_COMPATIBLE_PROVIDER_ID}:config`,
            status: "fail",
            message: endpoint
          }
        ];
      }
      const checks: ProviderHealthCheck[] = [];
      const configCheckId =
        endpoint.kind === "openai-compatible"
          ? "openai-compatible-config"
          : `${endpoint.providerId}:config`;
      const authCheckId =
        endpoint.kind === "openai-compatible"
          ? "openai-compatible-auth-env"
          : `${endpoint.providerId}:auth-env`;
      const configExplicit =
        endpoint.baseUrl !== undefined &&
        endpoint.model !== undefined &&
        endpoint.apiKeyEnv !== undefined &&
        (endpoint.kind !== "openai-compatible" || config.providers.openaiCompatible.enabled);

      checks.push({
        id: configCheckId,
        status: configExplicit ? "pass" : "fail",
        message: configExplicit
          ? `${endpointLabel(endpoint)} config is explicit.`
          : `${endpointLabel(endpoint)} config is incomplete.`,
        details: {
          providerId: endpoint.providerId,
          hasBaseUrl: endpoint.baseUrl !== undefined,
          hasModel: endpoint.model !== undefined,
          hasApiKeyEnv: endpoint.apiKeyEnv !== undefined
        }
      });

      if (endpoint.apiKeyEnv !== undefined) {
        const present =
          (input.env[endpoint.apiKeyEnv]?.trim().length ?? 0) > 0;
        checks.push({
          id: authCheckId,
          status: present ? "pass" : "fail",
          message: present
            ? `${endpointLabel(endpoint)} auth env is present.`
            : `${endpointLabel(endpoint)} auth env ${endpoint.apiKeyEnv} is missing.`,
          details: { env: endpoint.apiKeyEnv, present }
        });
      }

      return checks;
    }
  };
}

export const openAICompatibleRuntime = createOpenAICompatibleRuntime();
