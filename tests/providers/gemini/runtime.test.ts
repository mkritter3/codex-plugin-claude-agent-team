import { describe, expect, it } from "vitest";
import { describeProviderRuntimeConformance } from "../conformance/runtime-conformance.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  createGeminiRuntime,
  geminiProvider
} from "../../../src/providers/gemini/runtime.js";

function config(input: {
  readonly enabled?: boolean;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly structuredOutput?: boolean;
  readonly longContext?: boolean;
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      gemini: {
        enabled: input.enabled ?? true,
        ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.apiKeyEnv === undefined ? {} : { apiKeyEnv: input.apiKeyEnv }),
        displayName: "Gemini Review",
        capabilities: {
          structuredOutput: input.structuredOutput ?? true,
          longContext: input.longContext ?? true,
          reasoning: false
        }
      }
    }
  } as AgentTeamConfig;
}

function response(body: unknown, init: { readonly status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

describe("Gemini runtime", () => {
  it("keeps the provider descriptor disabled by default", () => {
    expect(geminiProvider(DEFAULT_AGENT_TEAM_CONFIG)).toBeUndefined();
    expect(createGeminiRuntime().descriptor()).toMatchObject({
      id: "gemini",
      authMode: "api-key",
      available: false,
      capabilities: []
    });
  });

  it("runs generateContent using explicit endpoint, model, and auth env", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const runtime = createGeminiRuntime({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return response({
          responseId: "gemini_fixture",
          candidates: [
            {
              content: {
                parts: [{ text: "fixture " }, { text: "assistant text" }]
              }
            }
          ]
        });
      }
    });

    const result = await runtime.runPrint({
      prompt: "Review this plan.",
      cwd: "/tmp/project",
      roleId: "planner",
      executionPolicy: "read-only",
      config: config({
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
        model: "models/gemini-2.5-flash",
        apiKeyEnv: "GEMINI_API_KEY"
      }),
      env: { GEMINI_API_KEY: "secret-token" }
    });

    expect(result).toMatchObject({
      ok: true,
      sessionId: "gemini_fixture",
      text: "fixture assistant text",
      stderr: "",
      exitCode: 0
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(calls[0]?.init.headers).toMatchObject({
      "x-goog-api-key": "secret-token"
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      contents: [
        {
          role: "user",
          parts: [{ text: "Review this plan." }]
        }
      ]
    });
  });

  it("fails closed before network when config, capability, or auth is missing", async () => {
    let called = false;
    const runtime = createGeminiRuntime({
      fetch: async () => {
        called = true;
        throw new Error("should not call network");
      }
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({
          enabled: false,
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKeyEnv: "GEMINI_API_KEY"
        }),
        env: { GEMINI_API_KEY: "secret-token" }
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "Gemini provider is disabled."
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKeyEnv: "GEMINI_API_KEY",
          structuredOutput: false
        }),
        env: { GEMINI_API_KEY: "secret-token" }
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "Gemini provider requires structuredOutput capability for dispatch."
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKeyEnv: "GEMINI_API_KEY"
        }),
        env: {}
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "Gemini provider requires auth env GEMINI_API_KEY."
    });

    expect(called).toBe(false);
  });

  it("fails closed on HTTP errors and malformed responses", async () => {
    const httpRuntime = createGeminiRuntime({
      fetch: async () => response({ error: { message: "bad key" } }, { status: 403 })
    });

    await expect(
      httpRuntime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKeyEnv: "GEMINI_API_KEY"
        }),
        env: { GEMINI_API_KEY: "secret-token" }
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "Gemini request failed with HTTP 403."
    });

    const malformedRuntime = createGeminiRuntime({
      fetch: async () => response({ candidates: [] })
    });

    await expect(
      malformedRuntime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKeyEnv: "GEMINI_API_KEY"
        }),
        env: { GEMINI_API_KEY: "secret-token" }
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "Gemini response did not contain candidate text."
    });
  });

  it("does not support background sessions in the Gemini adapter", async () => {
    const runtime = createGeminiRuntime();
    const handle = runtime.startSession({
      prompt: "Review",
      cwd: "/tmp/project",
      workspaceRoot: "/tmp/project",
      runId: "run_gemini_session",
      roleId: "planner",
      executionPolicy: "read-only",
      config: config({
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.5-flash",
        apiKeyEnv: "GEMINI_API_KEY"
      })
    });

    expect(handle.providerSessionId).toBeUndefined();
    expect(handle.supportsStdin).toBe(false);
    expect(handle.snapshot().warnings).toContain(
      "Gemini adapter does not support background sessions, resume, live stdin, cancellation, or edits."
    );
    expect(await handle.done).toBe("failed");
  });
});

describeProviderRuntimeConformance({
  name: "Gemini fixture runtime",
  runtime: createGeminiRuntime({
    config: config({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      apiKeyEnv: "GEMINI_API_KEY"
    }),
    fetch: async () =>
      response({
        responseId: "gemini_conformance",
        candidates: [
          {
            content: {
              parts: [{ text: "conformance text" }]
            }
          }
        ]
      })
  }),
  descriptor: geminiProvider(
    config({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      apiKeyEnv: "GEMINI_API_KEY"
    })
  )!,
  sampleCwd: "/tmp/gemini-cwd",
  sampleWorkspaceRoot: "/tmp/gemini-workspace",
  supportedRoleId: "planner",
  unsupportedRoleId: "slice-implementer"
});
