import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  createOllamaClaudeCodeRuntime,
  ollamaClaudeCodeRuntime
} from "../../../src/providers/ollama-claude-code/runtime.js";
import { ollamaClaudeCodeProviderId } from "../../../src/providers/ollama-claude-code/config.js";
import type { runClaudePrint } from "../../../src/providers/claude-code-cli/runner.js";
import type { startClaudeBackgroundSession } from "../../../src/providers/claude-code-cli/background.js";
import type { ClaudeCommand } from "../../../src/providers/claude-code-cli/types.js";

function config(input: {
  readonly launchMode?: "ollama-launch" | "local-anthropic" | "direct-api";
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      ollamaClaudeCode: {
        enabled: true,
        launchMode: input.launchMode ?? "ollama-launch",
        baseUrl:
          input.launchMode === "direct-api" ? "https://ollama.com" : "http://localhost:11434",
        authToken: "ollama",
        executable: "ollama",
        apiKeyEnv: "OLLAMA_API_KEY",
        profiles: [
          {
            id: "kimi-k2.7-code",
            model: "kimi-k2.7-code:cloud",
            displayName: "Kimi K2.7 Code",
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
  it("routes print calls through Ollama's native Claude Code launcher", async () => {
    const calls: Array<Parameters<typeof runClaudePrint>[0]> = [];
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
      providerId: ollamaClaudeCodeProviderId("kimi-k2.7-code"),
      prompt: "Review",
      cwd: "/repo",
      roleId: "code-reviewer",
      executionPolicy: "read-only",
      config: config(),
      env: {
        PATH: "/usr/bin",
        OLLAMA_API_KEY: "secret-token",
        CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-token"
      }
    });

    expect(result).toMatchObject({ ok: true, sessionId: "session_ollama" });
    expect(calls[0]).toMatchObject({
      prompt: "Review",
      cwd: "/repo",
      roleId: "code-reviewer",
      executionPolicy: "read-only",
      env: {
        PATH: "/usr/bin",
        ANTHROPIC_BASE_URL: "http://localhost:11434",
        ANTHROPIC_AUTH_TOKEN: "ollama",
        ANTHROPIC_API_KEY: ""
      }
    });
    expect(calls[0]?.model).toBeUndefined();
    expect(calls[0]?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(calls[0]?.env?.OLLAMA_API_KEY).toBeUndefined();
    const wrapped = calls[0]?.commandWrapper?.({
      command: "claude",
      args: ["-p", "Review", "--output-format", "json"],
      cwd: "/repo"
    } satisfies ClaudeCommand);
    expect(wrapped).toEqual({
      command: "ollama",
      args: [
        "launch",
        "claude",
        "--model",
        "kimi-k2.7-code:cloud",
        "--yes",
        "--",
        "-p",
        "Review",
        "--output-format",
        "json"
      ],
      cwd: "/repo"
    });
  });

  it("starts background sessions through the shared Claude Code lifecycle", () => {
    const calls: Array<Parameters<typeof startClaudeBackgroundSession>[0]> = [];
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
      providerId: ollamaClaudeCodeProviderId("kimi-k2.7-code"),
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
      providerAuthMode: "ollama-local",
      env: {
        ANTHROPIC_BASE_URL: "http://localhost:11434",
        ANTHROPIC_AUTH_TOKEN: "ollama",
        ANTHROPIC_API_KEY: ""
      }
    });
    expect(calls[0]?.model).toBeUndefined();
    const wrapped = calls[0]?.commandWrapper?.({
      command: "claude",
      args: ["-p", "--output-format", "stream-json"],
      cwd: "/repo"
    } satisfies ClaudeCommand);
    expect(wrapped?.command).toBe("ollama");
    expect(wrapped?.args.slice(0, 6)).toEqual([
      "launch",
      "claude",
      "--model",
      "kimi-k2.7-code:cloud",
      "--yes",
      "--"
    ]);
  });

  it("runs local Anthropic-compatible mode through claude directly without Ollama CLI wrapping", async () => {
    const calls: Array<Parameters<typeof runClaudePrint>[0]> = [];
    const runtime = createOllamaClaudeCodeRuntime({
      runClaudePrint: async (input) => {
        calls.push(input);
        return {
          ok: true,
          text: "<<<VERDICT>>>\nstatus: SHIP\nsummary: ok\n<<<END_VERDICT>>>",
          stdout: "{}",
          stderr: "",
          exitCode: 0
        };
      }
    });

    await runtime.runPrint({
      providerId: ollamaClaudeCodeProviderId("kimi-k2.7-code"),
      prompt: "Review",
      cwd: "/repo",
      roleId: "code-reviewer",
      config: config({ launchMode: "local-anthropic" }),
      env: {
        PATH: "/usr/bin",
        OLLAMA_API_KEY: "secret-token",
        CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-token"
      }
    });

    expect(calls[0]).toMatchObject({
      model: "kimi-k2.7-code:cloud",
      env: {
        PATH: "/usr/bin",
        ANTHROPIC_BASE_URL: "http://localhost:11434",
        ANTHROPIC_AUTH_TOKEN: "ollama",
        ANTHROPIC_API_KEY: ""
      }
    });
    expect(calls[0]?.commandWrapper).toBeUndefined();
    expect(calls[0]?.env?.OLLAMA_API_KEY).toBeUndefined();
    expect(calls[0]?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("keeps direct API mode gated on the shared Ollama API key env", async () => {
    const result = await ollamaClaudeCodeRuntime.runPrint({
      providerId: ollamaClaudeCodeProviderId("kimi-k2.7-code"),
      prompt: "Review",
      cwd: "/repo",
      config: config({ launchMode: "direct-api" }),
      env: {}
    });

    expect(result).toMatchObject({
      ok: false,
      stderr: "Ollama Claude Code profile Kimi K2.7 Code requires auth env OLLAMA_API_KEY."
    });
  });

  it("health checks local mode without leaking configured auth token values", async () => {
    const checks = await ollamaClaudeCodeRuntime.healthCheck({
      providerId: ollamaClaudeCodeProviderId("kimi-k2.7-code"),
      workspaceRoot: "/repo",
      config: {
        ...config({ launchMode: "local-anthropic" }),
        providers: {
          ...config({ launchMode: "local-anthropic" }).providers,
          ollamaClaudeCode: {
            ...config({ launchMode: "local-anthropic" }).providers.ollamaClaudeCode,
            authToken: "custom-secret-token"
          }
        }
      },
      env: {},
      findExecutable: async (name) => (name === "claude" ? "/usr/local/bin/claude" : undefined),
      getVersion: async () => "1.0.0",
      runCommand: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 })
    });

    expect(checks.find((check) => check.id.endsWith(":ollama-local-auth"))).toMatchObject({
      status: "warn",
      details: {
        baseUrl: "http://localhost:11434",
        authTokenPresent: true,
        liveProofRequired: true
      }
    });
    expect(JSON.stringify(checks)).not.toContain("custom-secret-token");
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
