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
  GEMINI_PROVIDER_ID,
  geminiProvider,
  geminiProviderDescriptor,
  resolveGeminiConfig
} from "./config.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface GeminiRuntimeOptions {
  readonly config?: AgentTeamConfig;
  readonly fetch?: FetchLike;
}

export { geminiProvider };

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

function normalizeModel(model: string): string {
  return model.replace(/^models\//, "");
}

function extractCandidateText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("candidates" in body)) {
    return undefined;
  }
  const candidates = (body as { readonly candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) {
    return undefined;
  }
  const texts: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null || !("content" in candidate)) {
      continue;
    }
    const content = (candidate as { readonly content?: unknown }).content;
    if (typeof content !== "object" || content === null || !("parts" in content)) {
      continue;
    }
    const parts = (content as { readonly parts?: unknown }).parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      if (typeof part !== "object" || part === null || !("text" in part)) {
        continue;
      }
      const text = (part as { readonly text?: unknown }).text;
      if (typeof text === "string" && text.trim().length > 0) {
        texts.push(text);
      }
    }
  }
  const joined = texts.join("").trim();
  return joined.length === 0 ? undefined : joined;
}

function extractResponseId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("responseId" in body)) {
    return undefined;
  }
  const responseId = (body as { readonly responseId?: unknown }).responseId;
  return typeof responseId === "string" && responseId.trim().length > 0
    ? responseId
    : undefined;
}

function unsupportedSessionHandle(input: ProviderStartSessionInput): ProviderSessionHandle {
  const warning =
    "Gemini adapter does not support background sessions, resume, live stdin, cancellation, or edits.";
  let closed = false;
  const snapshot = (): ProviderSessionSnapshot => ({
    providerSessionId: input.sessionId,
    text: "",
    warnings: closed ? [warning, "Gemini unsupported session handle was closed."] : [warning],
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
      closed = true;
    },
    forceKill() {
      closed = true;
    },
    snapshot
  };
}

export function createGeminiRuntime(
  options: GeminiRuntimeOptions = {}
): AgentProviderRuntime {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    id: GEMINI_PROVIDER_ID,
    descriptor(config?: AgentTeamConfig): AgentProviderDescriptor {
      return geminiProviderDescriptor(resolveGeminiConfig(config, options.config));
    },
    inspectEnvironment(
      _input: ProviderEnvironmentInspectionInput
    ): ProviderEnvironmentInspection {
      return { warnings: [] };
    },
    async runPrint(input: ProviderPrintInput): Promise<ProviderPrintResult> {
      const config = resolveGeminiConfig(input.config, options.config);
      const providerConfig = config.providers.gemini;
      if (!providerConfig.enabled) {
        return fail("Gemini provider is disabled.");
      }
      if (!providerConfig.capabilities.structuredOutput) {
        return fail("Gemini provider requires structuredOutput capability for dispatch.");
      }
      if (providerConfig.baseUrl === undefined) {
        return fail("Gemini provider requires baseUrl.");
      }
      if (providerConfig.model === undefined) {
        return fail("Gemini provider requires model.");
      }
      if (providerConfig.apiKeyEnv === undefined) {
        return fail("Gemini provider requires apiKeyEnv.");
      }

      const token = (input.env ?? process.env)[providerConfig.apiKeyEnv];
      if (token === undefined || token.trim().length === 0) {
        return fail(`Gemini provider requires auth env ${providerConfig.apiKeyEnv}.`);
      }

      try {
        const response = await fetchImpl(
          `${normalizeBaseUrl(providerConfig.baseUrl)}/models/${encodeURIComponent(
            normalizeModel(providerConfig.model)
          )}:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": token
            },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [{ text: input.prompt }]
                }
              ]
            })
          }
        );
        if (!response.ok) {
          return fail(`Gemini request failed with HTTP ${response.status}.`);
        }
        const body = (await response.json()) as unknown;
        const text = extractCandidateText(body);
        if (text === undefined) {
          return fail("Gemini response did not contain candidate text.");
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
        return fail(`Gemini request failed: ${message}`);
      }
    },
    startSession(input: ProviderStartSessionInput): ProviderSessionHandle {
      return unsupportedSessionHandle(input);
    },
    async healthCheck(input: ProviderHealthCheckInput): Promise<readonly ProviderHealthCheck[]> {
      const config = resolveGeminiConfig(input.config, options.config);
      const providerConfig = config.providers.gemini;
      const configExplicit =
        providerConfig.enabled &&
        providerConfig.baseUrl !== undefined &&
        providerConfig.model !== undefined &&
        providerConfig.apiKeyEnv !== undefined;
      const checks: ProviderHealthCheck[] = [
        {
          id: "gemini-config",
          status: configExplicit ? "pass" : "fail",
          message: configExplicit
            ? "Gemini provider config is explicit."
            : "Gemini provider config is incomplete.",
          details: {
            providerId: GEMINI_PROVIDER_ID,
            hasBaseUrl: providerConfig.baseUrl !== undefined,
            hasModel: providerConfig.model !== undefined,
            hasApiKeyEnv: providerConfig.apiKeyEnv !== undefined
          }
        }
      ];

      if (providerConfig.apiKeyEnv !== undefined) {
        const present =
          (input.env[providerConfig.apiKeyEnv]?.trim().length ?? 0) > 0;
        checks.push({
          id: "gemini-auth-env",
          status: present ? "pass" : "fail",
          message: present
            ? "Gemini provider auth env is present."
            : `Gemini provider auth env ${providerConfig.apiKeyEnv} is missing.`,
          details: { env: providerConfig.apiKeyEnv, present }
        });
      }

      return checks;
    }
  };
}

export const geminiRuntime = createGeminiRuntime();
