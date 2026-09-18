import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMailboxRecords } from "../../src/core/state/mailbox-store.js";
import { readAuditRecords } from "../../src/core/state/audit-store.js";
import { readProviderHealthRecords } from "../../src/core/state/provider-health-store.js";
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
import { listGrokProviders } from "../../src/providers/grok/config.js";
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
            id: "kimi-k2.7-code",
            baseUrl: "https://ollama.example/v1",
            model: "kimi-k2.7-code",
            apiKeyEnv: "KIMI_API_KEY",
            displayName: "Kimi K2.7 Code",
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
        model: "gemini-3-pro-preview",
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

function grokConfig(): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      grok: {
        enabled: true,
        profiles: [
          {
            id: "grok-4.20-reasoning",
            baseUrl: "https://api.x.ai/v1",
            model: "grok-4.20",
            apiKeyEnv: "XAI_API_KEY",
            displayName: "Grok 4.20 Reasoning",
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: true
            }
          }
        ]
      }
    }
  } as AgentTeamConfig;
}

function grokAndOllamaConfig(input: {
  readonly plannerPin?: string;
  readonly providerOrder?: readonly string[];
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    routing: {
      rolePins:
        input.plannerPin === undefined
          ? {}
          : {
              planner: input.plannerPin
            },
      providerOrder: input.providerOrder ?? []
    },
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      ollamaCloud: {
        enabled: true,
        profiles: [
          {
            id: "kimi-k2.7-code",
            baseUrl: "https://ollama.example/v1",
            model: "kimi-k2.7-code",
            apiKeyEnv: "KIMI_API_KEY",
            displayName: "Kimi K2.7 Code",
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: false
            }
          }
        ]
      },
      grok: {
        enabled: true,
        profiles: [
          {
            id: "grok-4.20-reasoning",
            baseUrl: "https://api.x.ai/v1",
            model: "grok-4.20",
            apiKeyEnv: "XAI_API_KEY",
            displayName: "Grok 4.20 Reasoning",
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: true
            }
          }
        ]
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
  it("blocks disallowed roles before invoking provider runtime", async () => {
    let called = false;
    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace
      },
      {
        config: {
          ...DEFAULT_AGENT_TEAM_CONFIG,
          policy: {
            ...DEFAULT_AGENT_TEAM_CONFIG.policy,
            allowedRoles: ["code-reviewer"]
          }
        },
        createRunId: () => "run_policy_role_blocked",
        runtimes: [
          claudeRuntime(async () => {
            called = true;
            throw new Error("should not run");
          })
        ]
      }
    );

    expect(called).toBe(false);
    expect(result).toMatchObject({
      runId: "run_policy_role_blocked",
      status: "failed",
      provider: "ollama-claude-code:glm-5.2",
      role: "planner"
    });
    expect(result.verdict.summary).toContain("role_not_allowed");
    await expect(readAuditRecords(workspace)).resolves.toMatchObject([
      {
        eventType: "policy_blocked",
        operation: "dispatch",
        role: "planner",
        provider: "ollama-claude-code:glm-5.2",
        decision: "blocked",
        reason: "role_not_allowed"
      }
    ]);
  });

  it("blocks disallowed selected providers before invoking provider runtime", async () => {
    let called = false;
    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "claude-code-cli"
      },
      {
        config: {
          ...DEFAULT_AGENT_TEAM_CONFIG,
          policy: {
            ...DEFAULT_AGENT_TEAM_CONFIG.policy,
            allowedProviderSelectors: ["family:grok"]
          }
        },
        createRunId: () => "run_policy_provider_blocked",
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
    expect(result.verdict.summary).toContain("provider_not_allowed");
    await expect(readAuditRecords(workspace)).resolves.toMatchObject([
      {
        eventType: "policy_blocked",
        reason: "provider_not_allowed",
        provider: "claude-code-cli"
      }
    ]);
  });

  it("appends a sanitized policy audit record before provider runtime dispatch", async () => {
    let auditCountAtRuntime = -1;
    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "claude-code-cli"
      },
      {
        createRunId: () => "run_policy_allowed",
        now: () => new Date("2026-05-12T10:00:00.000Z"),
        runtimes: [
          claudeRuntime(async () => {
            auditCountAtRuntime = (await readAuditRecords(workspace)).length;
            return {
              ok: true,
              sessionId: "session_allowed",
              text: shipText,
              stdout: "stdout",
              stderr: "",
              exitCode: 0
            };
          })
        ]
      }
    );

    expect(result.status).toBe("completed");
    expect(auditCountAtRuntime).toBe(1);
    const audit = await readAuditRecords(workspace);
    expect(audit).toMatchObject([
      {
        eventType: "policy_allowed",
        operation: "dispatch",
        role: "planner",
        provider: "claude-code-cli",
        decision: "allowed",
        reason: "policy_allowed"
      }
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/prompt|providerSessionId|command|payload|secret/i);
  });

  it("fails closed before provider runtime when policy audit append fails", async () => {
    let called = false;
    await expect(
      dispatchReadOnlyAgent(
        {
          role: "planner",
          task: "Review plan",
          cwd: workspace
        },
        {
          createRunId: () => "run_policy_audit_failed",
          appendAudit: async () => {
            throw new Error("audit unavailable");
          },
          runtimes: [
            claudeRuntime(async () => {
              called = true;
              throw new Error("should not run");
            })
          ]
        }
      )
    ).rejects.toThrow("audit unavailable");

    expect(called).toBe(false);
  });

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
        provider: "ollama-cloud:kimi-k2.7-code"
      },
      {
        config,
        providers: listOllamaCloudProviders(config, {
          env: { KIMI_API_KEY: "secret-token" }
        }),
        runtimes: [runtime],
        createRunId: () => "run_ollama_kimi",
        env: { KIMI_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "completed",
      provider: "ollama-cloud:kimi-k2.7-code",
      verdict: { status: "SHIP" }
    });
    await expect(readRunSidecar(workspace, "run_ollama_kimi")).resolves.toMatchObject({
      provider: "ollama-cloud:kimi-k2.7-code",
      providerSessionId: "chatcmpl_kimi_dispatch"
    });
  });

  it("dispatches through a selected Grok profile provider id", async () => {
    const config = grokConfig();
    const runtime = createOpenAICompatibleRuntime({
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl_grok_dispatch",
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
        provider: "grok:grok-4.20-reasoning"
      },
      {
        config,
        providers: listGrokProviders(config),
        runtimes: [runtime],
        createRunId: () => "run_grok_reasoning",
        env: { XAI_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "completed",
      provider: "grok:grok-4.20-reasoning",
      verdict: { status: "SHIP" }
    });
    await expect(readRunSidecar(workspace, "run_grok_reasoning")).resolves.toMatchObject({
      provider: "grok:grok-4.20-reasoning",
      providerSessionId: "chatcmpl_grok_dispatch"
    });
  });

  it("records Grok profile dispatch failures as sidecar evidence", async () => {
    const config = grokConfig();
    const runtime = createOpenAICompatibleRuntime({
      fetch: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })
    });

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace,
        provider: "grok:grok-4.20-reasoning"
      },
      {
        config,
        providers: listGrokProviders(config),
        runtimes: [runtime],
        createRunId: () => "run_grok_failed",
        env: { XAI_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "grok:grok-4.20-reasoning",
      verdict: { status: "BLOCKED" }
    });
    await expect(readFile(runLogPath(workspace, "run_grok_failed"), "utf8")).resolves.toContain(
      "OpenAI-compatible response did not contain assistant text."
    );
  });

  it("dispatches through a configured role pin when no request selector is provided", async () => {
    const config = grokAndOllamaConfig({ plannerPin: "family:grok" });
    const runtime = createOpenAICompatibleRuntime({
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl_grok_pinned",
            choices: [{ message: { content: shipText } }]
          }),
          { status: 200 }
        )
    });

    const result = await dispatchReadOnlyAgent(
      {
        role: "planner",
        task: "Review plan",
        cwd: workspace
      },
      {
        config,
        providers: [
          ...listOllamaCloudProviders(config),
          ...listGrokProviders(config)
        ],
        runtimes: [runtime],
        createRunId: () => "run_grok_role_pin",
        env: { XAI_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "completed",
      provider: "grok:grok-4.20-reasoning",
      verdict: { status: "SHIP" }
    });
    await expect(readRunSidecar(workspace, "run_grok_role_pin")).resolves.toMatchObject({
      provider: "grok:grok-4.20-reasoning",
      providerSessionId: "chatcmpl_grok_pinned"
    });
  });

  it("dispatch request selector overrides a configured role pin", async () => {
    const config = grokAndOllamaConfig({ plannerPin: "family:grok" });
    const runtime = createOpenAICompatibleRuntime({
      fetch: async () =>
        new Response(
          JSON.stringify({
            id: "chatcmpl_kimi_override",
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
        provider: "family:ollama-cloud"
      },
      {
        config,
        providers: [
          ...listGrokProviders(config),
          ...listOllamaCloudProviders(config, {
            env: { KIMI_API_KEY: "secret-token" }
          })
        ],
        runtimes: [runtime],
        createRunId: () => "run_kimi_request_override",
        env: { KIMI_API_KEY: "secret-token" }
      }
    );

    expect(result).toMatchObject({
      status: "completed",
      provider: "ollama-cloud:kimi-k2.7-code",
      verdict: { status: "SHIP" }
    });
    await expect(readRunSidecar(workspace, "run_kimi_request_override")).resolves.toMatchObject({
      provider: "ollama-cloud:kimi-k2.7-code",
      providerSessionId: "chatcmpl_kimi_override"
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

  it("records transient provider failures as durable cooldown evidence", async () => {
    const config = geminiConfig();
    const runtime = createGeminiRuntime({
      fetch: async () => new Response(JSON.stringify({ error: "busy" }), { status: 503 })
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
        createRunId: () => "run_gemini_transient_failed",
        env: { GEMINI_API_KEY: "secret-token" },
        now: () => new Date("2026-05-13T10:00:00.000Z")
      }
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "gemini",
      verdict: { status: "BLOCKED" }
    });
    await expect(readProviderHealthRecords(workspace)).resolves.toEqual([
      expect.objectContaining({
        providerId: "gemini",
        status: "degraded",
        reason: "provider_unavailable",
        failureCount: 1,
        degradedUntil: "2026-05-13T10:30:00.000Z",
        evidencePaths: [runLogPath(workspace, "run_gemini_transient_failed")]
      })
    ]);
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
        cwd: workspace,
        provider: "claude-code-cli"
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
        cwd: workspace,
        provider: "claude-code-cli"
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
        cwd: workspace,
        provider: "claude-code-cli"
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
        cwd: workspace,
        provider: "claude-code-cli"
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
