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
      const providerConfig = config.providers.openaiCompatible;
      if (!providerConfig.enabled) {
        return fail("OpenAI-compatible provider is disabled.");
      }
      if (!providerConfig.capabilities.structuredOutput) {
        return fail(
          "OpenAI-compatible provider requires structuredOutput capability for dispatch."
        );
      }
      if (providerConfig.baseUrl === undefined) {
        return fail("OpenAI-compatible provider requires baseUrl.");
      }
      if (providerConfig.model === undefined) {
        return fail("OpenAI-compatible provider requires model.");
      }
      if (providerConfig.apiKeyEnv === undefined) {
        return fail("OpenAI-compatible provider requires apiKeyEnv.");
      }

      const token = (input.env ?? process.env)[providerConfig.apiKeyEnv];
      if (token === undefined || token.trim().length === 0) {
        return fail(
          `OpenAI-compatible provider requires auth env ${providerConfig.apiKeyEnv}.`
        );
      }

      try {
        const response = await fetchImpl(
          `${normalizeBaseUrl(providerConfig.baseUrl)}/chat/completions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              model: providerConfig.model,
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
      const providerConfig = config.providers.openaiCompatible;
      const checks: ProviderHealthCheck[] = [];

      checks.push({
        id: "openai-compatible-config",
        status:
          providerConfig.enabled &&
          providerConfig.baseUrl !== undefined &&
          providerConfig.model !== undefined &&
          providerConfig.apiKeyEnv !== undefined
            ? "pass"
            : "fail",
        message:
          providerConfig.enabled &&
          providerConfig.baseUrl !== undefined &&
          providerConfig.model !== undefined &&
          providerConfig.apiKeyEnv !== undefined
            ? "OpenAI-compatible provider config is explicit."
            : "OpenAI-compatible provider config is incomplete.",
        details: {
          enabled: providerConfig.enabled,
          hasBaseUrl: providerConfig.baseUrl !== undefined,
          hasModel: providerConfig.model !== undefined,
          hasApiKeyEnv: providerConfig.apiKeyEnv !== undefined
        }
      });

      if (providerConfig.apiKeyEnv !== undefined) {
        const present =
          (input.env[providerConfig.apiKeyEnv]?.trim().length ?? 0) > 0;
        checks.push({
          id: "openai-compatible-auth-env",
          status: present ? "pass" : "fail",
          message: present
            ? "OpenAI-compatible provider auth env is present."
            : `OpenAI-compatible provider auth env ${providerConfig.apiKeyEnv} is missing.`,
          details: { env: providerConfig.apiKeyEnv, present }
        });
      }

      return checks;
    }
  };
}

export const openAICompatibleRuntime = createOpenAICompatibleRuntime();
