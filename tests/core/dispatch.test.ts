import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMailboxRecords } from "../../src/core/state/mailbox-store.js";
import { runLogPath } from "../../src/core/state/paths.js";
import { readRunSidecar } from "../../src/core/state/run-store.js";
import { dispatchReadOnlyAgent } from "../../src/core/dispatch.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import type { AgentTeamConfig } from "../../src/core/types.js";
import type { AgentProviderRuntime } from "../../src/providers/index.js";
import {
  createOpenAICompatibleRuntime,
  openAICompatibleProvider
} from "../../src/providers/openai-compatible/runtime.js";
import { listOllamaCloudProviders } from "../../src/providers/ollama-cloud/config.js";
import {
  createGeminiRuntime,
  geminiProvider
} from "../../src/providers/gemini/runtime.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-dispatch-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const shipText = `Review complete.
<<<VERDICT>>>
status: SHIP
summary: Looks good.
required_changes:
- none
evidence:
- fixture
risks:
- none
<<<END_VERDICT>>>`;

function openAIConfig(): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      openaiCompatible: {
        enabled: true,
        baseUrl: "https://api.example/v1",
        model: "review-model",
        apiKeyEnv: "REVIEW_MODEL_API_KEY",
        displayName: "Review Model",
        capabilities: {
          structuredOutput: true,
          longContext: false,
          reasoning: false
        }
      }
    }
  };
}

function ollamaConfig(): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      ollamaCloud: {
        enabled: true,
        profiles: [
          {
            id: "kimi-k2.6",
            baseUrl: "https://ollama.example/v1",
            model: "kimi-k2.6",
            apiKeyEnv: "KIMI_API_KEY",
            displayName: "Kimi K2.6",
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: false
            }
          }
        ]
      }
    }
  } as AgentTeamConfig;
}

function geminiConfig(): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      gemini: {
        enabled: true,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.5-flash",
        apiKeyEnv: "GEMINI_API_KEY",
        displayName: "Gemini Review",
        capabilities: {
          structuredOutput: true,
          longContext: true,
          reasoning: false
        }
      }
    }
  } as AgentTeamConfig;
}

function claudeRuntime(
  runPrint: AgentProviderRuntime["runPrint"],
  inspectEnvironment: AgentProviderRuntime["inspectEnvironment"] = () => ({ warnings: [] })
): AgentProviderRuntime {
  return {
    id: "claude-code-cli",
    descriptor: () => ({
      id: "claude-code-cli",
      displayName: "Claude Code CLI",
      authMode: "subscription-oauth",
      capabilities: [
        "structuredOutput",
        "longContext",
        "tools",
        "sessionResume",
        "cancellation"
      ],
      available: true
    }),
    inspectEnvironment,
    runPrint,
    startSession() {
      throw new Error("should not start background session");
    },
    async healthCheck() {
      return [];
    }
  };
}

describe("dispatchReadOnlyAgent", () => {
  it("dispatches through the runtime selected by provider id", async () => {
    const fakeRuntime: AgentProviderRuntime = {
      id: "fake-runtime",
      descriptor: () => ({
        id: "fake-runtime",
        displayName: "Fake Runtime",
        authMode: "subscription-oauth",
        capabilities: ["structuredOutput", "tools"],
        available: true
      }),
      inspectEnvironment: () => ({ warnings: [] }),
      async runPrint(input) {
        expect(input.cwd).toBe(workspace);
        expect(input.roleId).toBe("planner");
        expect(input.executionPolicy).toBe("read-only");
        return {
          ok: true,
          sessionId: "fake_session",
          text: shipText,
          stdout: "fake stdout",
          stderr: "",
          exitCode: 0
        };
      },
      startSession() {
        throw new Error("should not start background session");
      },
      async healthCheck() {
        return [];
      }
    };

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "fake-runtime"
      },
      {
        providers: [fakeRuntime.descriptor()],
        runtimes: [fakeRuntime],
        createRunId: () => "run_fake_runtime",
        env: {}
      }
    );

    expect(result).toMatchObject({
      status: "completed",
      provider: "fake-runtime",
      verdict: { status: "SHIP" }
    });
    await expect(readFile(runLogPath(workspace, "run_fake_runtime"), "utf8")).resolves.toContain(
      "fake stdout"
    );
  });

  it("dispatches through explicitly configured OpenAI-compatible runtime", async () => {
    const config = openAIConfig();
    const runtime = createOpenAICompatibleRuntime({
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl_dispatch",
            choices: [{ message: { content: shipText } }]
          }),
          { status: 200 }
        )
    });
    const provider = openAICompatibleProvider(config);

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "openai-compatible"
      },
      {
        config,
        providers: provider === undefined ? [] : [provider],
        runtimes: [runtime],
        createRunId: () => "run_openai_dispatch",
        env: { REVIEW_MODEL_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "completed",
      provider: "openai-compatible",
      verdict: { status: "SHIP" }
    });
    await expect(readRunSidecar(workspace, "run_openai_dispatch")).resolves.toMatchObject({
      provider: "openai-compatible",
      providerSessionId: "chatcmpl_dispatch"
    });
  });

  it("records OpenAI-compatible dispatch failures as sidecar evidence", async () => {
    const config = openAIConfig();
    const runtime = createOpenAICompatibleRuntime({
      fetch: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })
    });
    const provider = openAICompatibleProvider(config);

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "openai-compatible"
      },
      {
        config,
        providers: provider === undefined ? [] : [provider],
        runtimes: [runtime],
        createRunId: () => "run_openai_failed",
        env: { REVIEW_MODEL_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "openai-compatible",
      verdict: { status: "BLOCKED" }
    });
    await expect(readFile(runLogPath(workspace, "run_openai_failed"), "utf8")).resolves.toContain(
      "OpenAI-compatible response did not contain assistant text."
    );
  });

  it("dispatches through a selected Ollama Cloud profile provider id", async () => {
    const config = ollamaConfig();
    const runtime = createOpenAICompatibleRuntime({
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl_kimi_dispatch",
            choices: [{ message: { content: shipText } }]
          }),
          { status: 200 }
        )
    });

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "ollama-cloud:kimi-k2.6"
      },
      {
        config,
        providers: listOllamaCloudProviders(config),
        runtimes: [runtime],
        createRunId: () => "run_ollama_kimi",
        env: { KIMI_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "completed",
      provider: "ollama-cloud:kimi-k2.6",
      verdict: { status: "SHIP" }
    });
    await expect(readRunSidecar(workspace, "run_ollama_kimi")).resolves.toMatchObject({
      provider: "ollama-cloud:kimi-k2.6",
      providerSessionId: "chatcmpl_kimi_dispatch"
    });
  });

  it("dispatches through explicitly configured Gemini runtime", async () => {
    const config = geminiConfig();
    const runtime = createGeminiRuntime({
      fetch: async () =>
        new Response(
          JSON.stringify({
            responseId: "gemini_dispatch",
            candidates: [
              {
                content: {
                  parts: [{ text: shipText }]
                }
              }
            ]
          }),
          { status: 200 }
        )
    });
    const provider = geminiProvider(config);

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "gemini"
      },
      {
        config,
        providers: provider === undefined ? [] : [provider],
        runtimes: [runtime],
        createRunId: () => "run_gemini_dispatch",
        env: { GEMINI_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "completed",
      provider: "gemini",
      verdict: { status: "SHIP" }
    });
    await expect(readRunSidecar(workspace, "run_gemini_dispatch")).resolves.toMatchObject({
      provider: "gemini",
      providerSessionId: "gemini_dispatch"
    });
  });

  it("records Gemini dispatch failures as sidecar evidence", async () => {
    const config = geminiConfig();
    const runtime = createGeminiRuntime({
      fetch: async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })
    });
    const provider = geminiProvider(config);

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "gemini"
      },
      {
        config,
        providers: provider === undefined ? [] : [provider],
        runtimes: [runtime],
        createRunId: () => "run_gemini_failed",
        env: { GEMINI_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "gemini",
      verdict: { status: "BLOCKED" }
    });
    await expect(readFile(runLogPath(workspace, "run_gemini_failed"), "utf8")).resolves.toContain(
      "Gemini response did not contain candidate text."
    );
  });

  it("blocks dispatch when the selected runtime reports auth precedence warnings", async () => {
    let ran = false;
    const fakeRuntime: AgentProviderRuntime = {
      id: "fake-runtime",
      descriptor: () => ({
        id: "fake-runtime",
        displayName: "Fake Runtime",
        authMode: "subscription-oauth",
        capabilities: ["structuredOutput", "tools"],
        available: true
      }),
      inspectEnvironment: () => ({
        warnings: ["Fake runtime API key would override subscription OAuth."]
      }),
      async runPrint() {
        ran = true;
        throw new Error("should not run");
      },
      startSession() {
        throw new Error("should not start background session");
      },
      async healthCheck() {
        return [];
      }
    };

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "fake-runtime"
      },
      {
        providers: [fakeRuntime.descriptor()],
        runtimes: [fakeRuntime],
        createRunId: () => "run_fake_auth",
        env: {}
      }
    );

    expect(ran).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.verdict.summary).toContain("Fake runtime API key");
  });

  it("dispatches a read-only role and persists sidecars, mailboxes, and logs", async () => {
    const result = await dispatchReadOnlyAgent(
      {
        role: "code-reviewer",
        task: "Review this diff",
        cwd: workspace
      },
      {
        createRunId: () => "run_test",
        now: () => new Date("2026-05-11T00:00:00.000Z"),
        env: {},
        runtimes: [
          claudeRuntime(async () => ({
            ok: true,
            sessionId: "session_1",
            text: shipText,
            stdout: JSON.stringify({ session_id: "session_1", result: shipText }),
            stderr: "",
            exitCode: 0
          }))
        ]
      }
    );

    expect(result).toMatchObject({
      runId: "run_test",
      status: "completed",
      provider: "claude-code-cli",
      role: "code-reviewer"
    });
    expect(result.verdict.status).toBe("SHIP");

    const sidecar = await readRunSidecar(workspace, "run_test");
    expect(sidecar).toMatchObject({
      runId: "run_test",
      status: "completed",
      providerSessionId: "session_1",
      outputSummary: "Looks good.",
      cleanup: "complete",
      logPath: runLogPath(workspace, "run_test")
    });
    expect(sidecar.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sidecar.evidencePaths).toContain(runLogPath(workspace, "run_test"));

    const events = await readMailboxRecords(workspace, "run_test", "events");
    expect(events.map((event) => event.messageType)).toEqual([
      "queued",
      "running",
      "completed"
    ]);

    await expect(readFile(runLogPath(workspace, "run_test"), "utf8")).resolves.toContain(
      shipText
    );
  });

  it("rejects implementation roles before invoking a provider", async () => {
    let called = false;
    const result = await dispatchReadOnlyAgent(
      {
        role: "slice-implementer",
        task: "Edit files",
        cwd: workspace
      },
      {
        createRunId: () => "run_impl",
        runtimes: [
          claudeRuntime(async () => {
            called = true;
            throw new Error("should not run");
          })
        ]
      }
    );

    expect(called).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.verdict.status).toBe("BLOCKED");
    expect(result.verdict.summary).toContain("not supported");
    await expect(readRunSidecar(workspace, "run_impl")).resolves.toMatchObject({
      status: "failed",
      cleanup: "partial",
      outputSummary: expect.stringContaining("not supported")
    });
    await expect(readMailboxRecords(workspace, "run_impl", "events")).resolves.toMatchObject([
      {
        messageType: "failed",
        payload: { reason: "unsupported_role" }
      }
    ]);
  });

  it("blocks subscription-mode dispatch when API auth override env exists", async () => {
    let called = false;
    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace
      },
      {
        createRunId: () => "run_auth",
        env: { ANTHROPIC_API_KEY: "secret" },
        runtimes: [
          claudeRuntime(
            async () => {
              called = true;
              throw new Error("should not run");
            },
            ({ env }) => ({
              warnings:
                env.ANTHROPIC_API_KEY === undefined
                  ? []
                  : [
                      "ANTHROPIC_API_KEY is set and may override Claude Code subscription OAuth."
                    ]
            })
          )
        ]
      }
    );

    expect(called).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.verdict.status).toBe("BLOCKED");
    expect(result.verdict.summary).toContain("override Claude Code subscription OAuth");
    await expect(readRunSidecar(workspace, "run_auth")).resolves.toMatchObject({
      status: "failed",
      cleanup: "partial",
      outputSummary: expect.stringContaining("override Claude Code subscription OAuth")
    });
  });

  it("records failed provider runs with a failed sidecar", async () => {
    const result = await dispatchReadOnlyAgent(
      {
        role: "debugger",
        task: "Explain failure",
        cwd: workspace
      },
      {
        createRunId: () => "run_failed",
        now: () => new Date("2026-05-11T00:00:00.000Z"),
        env: {},
        runtimes: [
          claudeRuntime(async () => ({
            ok: false,
            text: "",
            stdout: "",
            stderr: "bad auth",
            exitCode: 2
          }))
        ]
      }
    );

    expect(result.status).toBe("failed");
    expect(result.verdict.status).toBe("BLOCKED");
    const sidecar = await readRunSidecar(workspace, "run_failed");
    expect(sidecar).toMatchObject({
      status: "failed",
      cleanup: "partial",
      outputSummary: "Provider runtime run failed.",
      logPath: runLogPath(workspace, "run_failed")
    });
    expect(sidecar.evidencePaths).toContain(runLogPath(workspace, "run_failed"));
    await expect(readFile(runLogPath(workspace, "run_failed"), "utf8")).resolves.toContain(
      "bad auth"
    );
  });

  it("keeps synchronous dispatch semantics for provider print runs", async () => {
    let resolvePrint: (value: Awaited<ReturnType<AgentProviderRuntime["runPrint"]>>) => void;
    let returned = false;
    let startedSession = false;
    const pendingPrint = new Promise<Awaited<ReturnType<AgentProviderRuntime["runPrint"]>>>(
      (resolve) => {
        resolvePrint = resolve;
      }
    );

    const dispatchPromise = dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Wait for print completion",
        cwd: workspace
      },
      {
        createRunId: () => "run_sync",
        env: {},
        runtimes: [
          {
            ...claudeRuntime(async () => pendingPrint),
            startSession() {
              startedSession = true;
              throw new Error("should not start background session");
            }
          }
        ]
      }
    ).then((result) => {
      returned = true;
      return result;
    });

    await Promise.resolve();
    expect(returned).toBe(false);
    expect(startedSession).toBe(false);

    resolvePrint!({
      ok: true,
      sessionId: "session_sync",
      text: shipText,
      stdout: "",
      stderr: "",
      exitCode: 0
    });

    await expect(dispatchPromise).resolves.toMatchObject({
      runId: "run_sync",
      status: "completed",
      verdict: { status: "SHIP" }
    });
    expect(returned).toBe(true);
  });
});
