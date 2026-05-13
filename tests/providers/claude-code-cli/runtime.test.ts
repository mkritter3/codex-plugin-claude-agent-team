import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import { claudeCodeCliProfileProviderId } from "../../../src/providers/claude-code-cli/config.js";
import { createClaudeCodeCliRuntime } from "../../../src/providers/claude-code-cli/runtime.js";
import type {
  ProviderPrintInput,
  ProviderStartSessionInput
} from "../../../src/providers/types.js";

function config(): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      claudeCodeCli: {
        profiles: [
          {
            id: "opus",
            model: "opus",
            displayName: "Claude Opus",
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

describe("Claude Code CLI model profile runtime", () => {
  it("routes print calls through Claude Code with the selected alias model", async () => {
    const calls: ProviderPrintInput[] = [];
    const runtime = createClaudeCodeCliRuntime({
      runClaudePrint: async (input) => {
        calls.push(input);
        return {
          ok: true,
          text: "<<<VERDICT>>>\nstatus: SHIP\nsummary: ok\n<<<END_VERDICT>>>",
          stdout: "{}",
          stderr: "",
          exitCode: 0,
          sessionId: "session_opus"
        };
      }
    });

    const result = await runtime.runPrint({
      providerId: claudeCodeCliProfileProviderId("opus"),
      prompt: "Review",
      cwd: "/repo",
      roleId: "code-reviewer",
      executionPolicy: "read-only",
      config: config(),
      env: { PATH: "/usr/bin" }
    });

    expect(result).toMatchObject({ ok: true, sessionId: "session_opus" });
    expect(calls[0]).toMatchObject({
      prompt: "Review",
      cwd: "/repo",
      roleId: "code-reviewer",
      executionPolicy: "read-only",
      model: "opus",
      env: { PATH: "/usr/bin" }
    });
  });

  it("starts background sessions with subscription OAuth and the selected alias model", () => {
    const calls: ProviderStartSessionInput[] = [];
    const runtime = createClaudeCodeCliRuntime({
      startClaudeBackgroundSession: (input) => {
        calls.push(input);
        return {
          providerSessionId: "session_opus_bg",
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
            providerSessionId: "session_opus_bg",
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
      providerId: claudeCodeCliProfileProviderId("opus"),
      prompt: "Plan",
      cwd: "/repo",
      workspaceRoot: "/repo",
      runId: "run_1",
      roleId: "planner",
      executionPolicy: "read-only",
      config: config(),
      env: { PATH: "/usr/bin" }
    });

    expect(handle.providerSessionId).toBe("session_opus_bg");
    expect(calls[0]).toMatchObject({
      providerAuthMode: "subscription-oauth",
      model: "opus",
      env: { PATH: "/usr/bin" }
    });
  });
});
