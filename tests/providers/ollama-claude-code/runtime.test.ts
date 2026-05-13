import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  createOllamaClaudeCodeRuntime,
  ollamaClaudeCodeRuntime
} from "../../../src/providers/ollama-claude-code/runtime.js";
import { ollamaClaudeCodeProviderId } from "../../../src/providers/ollama-claude-code/config.js";
import type {
  ProviderPrintInput,
  ProviderStartSessionInput
} from "../../../src/providers/types.js";

function config(): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      ollamaClaudeCode: {
        enabled: true,
        baseUrl: "https://ollama.com",
        apiKeyEnv: "OLLAMA_API_KEY",
        profiles: [
          {
            id: "kimi-k2.6",
            model: "kimi-k2.6",
            displayName: "Kimi K2.6",
            writeValidated: false,
            capabilities: {
              structuredOutput: true,
              longContext: true,
              tools: true,
              sessionResume: true,
              cancellation: true,
              reasoning: true,
              edits: false,
              workspaceIsolation: false
            }
          }
        ]
      }
    }
  };
}

describe("Ollama Claude Code runtime", () => {
  it("routes print calls through Claude Code with scoped Ollama env and model", async () => {
    const calls: ProviderPrintInput[] = [];
    const runtime = createOllamaClaudeCodeRuntime({
      runClaudePrint: async (input) => {
        calls.push(input);
        return {
          ok: true,
          text: "<<<VERDICT>>>\nstatus: SHIP\nsummary: ok\n<<<END_VERDICT>>>",
          stdout: "{}",
          stderr: "",
          exitCode: 0,
          sessionId: "session_ollama"
        };
      }
    });

    const result = await runtime.runPrint({
      providerId: ollamaClaudeCodeProviderId("kimi-k2.6"),
      prompt: "Review",
      cwd: "/repo",
      roleId: "code-reviewer",
      executionPolicy: "read-only",
      config: config(),
      env: { PATH: "/usr/bin", OLLAMA_API_KEY: "secret-token" }
    });

    expect(result).toMatchObject({ ok: true, sessionId: "session_ollama" });
    expect(calls[0]).toMatchObject({
      prompt: "Review",
      cwd: "/repo",
      roleId: "code-reviewer",
      executionPolicy: "read-only",
      model: "kimi-k2.6",
      env: {
        PATH: "/usr/bin",
        OLLAMA_API_KEY: "secret-token",
        ANTHROPIC_BASE_URL: "https://ollama.com",
        ANTHROPIC_AUTH_TOKEN: "secret-token",
        ANTHROPIC_API_KEY: ""
      }
    });
  });

  it("starts background sessions through the shared Claude Code lifecycle", () => {
    const calls: ProviderStartSessionInput[] = [];
    const runtime = createOllamaClaudeCodeRuntime({
      startClaudeBackgroundSession: (input) => {
        calls.push(input);
        return {
          providerSessionId: "session_ollama_bg",
          done: Promise.resolve("completed"),
          recentActivities: [],
          currentActivity: null,
          lastStderr: [],
          transcriptPath: undefined,
          logPath: undefined,
          supportsStdin: false,
          kill() {},
          forceKill() {},
          snapshot: () => ({
            providerSessionId: "session_ollama_bg",
            text: "done",
            warnings: [],
            recentActivities: [],
            currentActivity: null,
            pendingOutboxRequests: [],
            lastStderr: [],
            transcriptPath: undefined,
            logPath: undefined
          })
        };
      }
    });

    const handle = runtime.startSession({
      providerId: ollamaClaudeCodeProviderId("kimi-k2.6"),
      prompt: "Plan",
      cwd: "/repo",
      workspaceRoot: "/repo",
      runId: "run_1",
      roleId: "planner",
      executionPolicy: "read-only",
      config: config(),
      env: { OLLAMA_API_KEY: "secret-token" }
    });

    expect(handle.providerSessionId).toBe("session_ollama_bg");
    expect(calls[0]).toMatchObject({
      providerAuthMode: "api-key",
      model: "kimi-k2.6",
      env: {
        OLLAMA_API_KEY: "secret-token",
        ANTHROPIC_BASE_URL: "https://ollama.com",
        ANTHROPIC_AUTH_TOKEN: "secret-token",
        ANTHROPIC_API_KEY: ""
      }
    });
  });

  it("fails closed when the shared Ollama API key env is missing", async () => {
    const result = await ollamaClaudeCodeRuntime.runPrint({
      providerId: ollamaClaudeCodeProviderId("kimi-k2.6"),
      prompt: "Review",
      cwd: "/repo",
      config: config(),
      env: {}
    });

    expect(result).toMatchObject({
      ok: false,
      stderr: "Ollama Claude Code profile Kimi K2.6 requires auth env OLLAMA_API_KEY."
    });
  });

  it("does not treat scoped Anthropic env as a subscription OAuth override", () => {
    const inspection = ollamaClaudeCodeRuntime.inspectEnvironment({
      providerId: ollamaClaudeCodeProviderId("kimi-k2.6"),
      authMode: "api-key",
      env: {
        ANTHROPIC_API_KEY: "secret-token",
        ANTHROPIC_AUTH_TOKEN: "secret-token"
      },
      config: config()
    });

    expect(inspection.warnings).toEqual([]);
  });
});
