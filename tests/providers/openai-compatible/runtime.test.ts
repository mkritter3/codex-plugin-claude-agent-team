import { describe, expect, it } from "vitest";
import { describeProviderRuntimeConformance } from "../conformance/runtime-conformance.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  createOpenAICompatibleRuntime,
  openAICompatibleProvider
} from "../../../src/providers/openai-compatible/runtime.js";

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
      openaiCompatible: {
        enabled: input.enabled ?? true,
        ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.apiKeyEnv === undefined ? {} : { apiKeyEnv: input.apiKeyEnv }),
        displayName: "Fixture OpenAI Compatible",
        capabilities: {
          structuredOutput: input.structuredOutput ?? true,
          longContext: input.longContext ?? false,
          reasoning: false
        }
      }
    }
  };
}

function response(body: unknown, init: { readonly status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

describe("OpenAI-compatible runtime", () => {
  it("keeps the provider descriptor disabled by default", () => {
    expect(openAICompatibleProvider(DEFAULT_AGENT_TEAM_CONFIG)).toBeUndefined();
    expect(createOpenAICompatibleRuntime().descriptor()).toMatchObject({
      id: "openai-compatible",
      authMode: "api-key",
      available: false,
      capabilities: []
    });
  });

  it("runs chat completions only from explicit config and configured auth env", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const runtime = createOpenAICompatibleRuntime({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return response({
          id: "chatcmpl_fixture",
          choices: [{ message: { content: "fixture assistant text" } }]
        });
      }
    });
    const runConfig = config({
      baseUrl: "https://api.example/v1/",
      model: "review-model",
      apiKeyEnv: "REVIEW_MODEL_API_KEY"
    });

    const result = await runtime.runPrint({
      prompt: "Review this plan.",
      cwd: "/tmp/project",
      roleId: "planner",
      executionPolicy: "read-only",
      config: runConfig,
      env: { REVIEW_MODEL_API_KEY: "secret-token" }
    });

    expect(result).toMatchObject({
      ok: true,
      sessionId: "chatcmpl_fixture",
      text: "fixture assistant text",
      stderr: "",
      exitCode: 0
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example/v1/chat/completions");
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer secret-token"
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      model: "review-model",
      messages: [{ role: "user", content: "Review this plan." }]
    });
  });

  it("fails closed without config, auth env, or assistant text", async () => {
    const runtime = createOpenAICompatibleRuntime({
      fetch: async () => response({ choices: [] })
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({
          baseUrl: "https://api.example/v1",
          model: "model",
          apiKeyEnv: "REVIEW_MODEL_API_KEY"
        }),
        env: {}
      })
    ).resolves.toMatchObject({
      ok: false,
      exitCode: 1,
      stderr: "OpenAI-compatible provider requires auth env REVIEW_MODEL_API_KEY."
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({
          baseUrl: "https://api.example/v1",
          model: "model",
          apiKeyEnv: "REVIEW_MODEL_API_KEY"
        }),
        env: { REVIEW_MODEL_API_KEY: "secret-token" }
      })
    ).resolves.toMatchObject({
      ok: false,
      exitCode: 1,
      stderr: "OpenAI-compatible response did not contain assistant text."
    });
  });

  it("does not support background sessions in the foundation adapter", async () => {
    const runtime = createOpenAICompatibleRuntime();
    const handle = runtime.startSession({
      prompt: "Review",
      cwd: "/tmp/project",
      workspaceRoot: "/tmp/project",
      runId: "run_openai_session",
      roleId: "planner",
      executionPolicy: "read-only",
      config: config({
        baseUrl: "https://api.example/v1",
        model: "model",
        apiKeyEnv: "REVIEW_MODEL_API_KEY"
      })
    });

    expect(handle.providerSessionId).toBeUndefined();
    expect(handle.supportsStdin).toBe(false);
    expect(handle.snapshot().warnings).toContain(
      "OpenAI-compatible foundation does not support background sessions, resume, live stdin, cancellation, or edits."
    );
    expect(await handle.done).toBe("failed");
  });
});

describeProviderRuntimeConformance({
  name: "OpenAI-compatible fixture runtime",
  runtime: createOpenAICompatibleRuntime({
    config: config({
      baseUrl: "https://api.example/v1",
      model: "review-model",
      apiKeyEnv: "REVIEW_MODEL_API_KEY"
    }),
    fetch: async () =>
      response({
        id: "chatcmpl_conformance",
        choices: [{ message: { content: "conformance text" } }]
      })
  }),
  descriptor: openAICompatibleProvider(
    config({
      baseUrl: "https://api.example/v1",
      model: "review-model",
      apiKeyEnv: "REVIEW_MODEL_API_KEY"
    })
  )!,
  sampleCwd: "/tmp/openai-cwd",
  sampleWorkspaceRoot: "/tmp/openai-workspace",
  supportedRoleId: "planner",
  unsupportedRoleId: "slice-implementer"
});
