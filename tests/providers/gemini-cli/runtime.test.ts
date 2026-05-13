import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  createGeminiCliRuntime,
  geminiCliProvider
} from "../../../src/providers/gemini-cli/runtime.js";

function config(input: {
  readonly enabled?: boolean;
  readonly executable?: string;
  readonly model?: string;
  readonly projectEnv?: string;
  readonly structuredOutput?: boolean;
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      geminiCli: {
        enabled: input.enabled ?? true,
        executable: input.executable ?? "gemini",
        model: input.model ?? "gemini-2.5-flash",
        displayName: "Gemini CLI",
        projectEnv: input.projectEnv ?? "GOOGLE_CLOUD_PROJECT",
        capabilities: {
          structuredOutput: input.structuredOutput ?? true,
          longContext: true,
          reasoning: true
        }
      }
    }
  } as AgentTeamConfig;
}

describe("Gemini CLI runtime", () => {
  it("keeps the provider descriptor disabled by default", () => {
    expect(geminiCliProvider(DEFAULT_AGENT_TEAM_CONFIG)).toBeUndefined();
    expect(createGeminiCliRuntime().descriptor()).toMatchObject({
      id: "gemini-cli",
      authMode: "oauth",
      available: false,
      capabilities: []
    });
  });

  it("runs headless Gemini CLI with configured model and sanitized text output", async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    const runtime = createGeminiCliRuntime({
      runCommand: async (command, args, options) => {
        calls.push({ command, args, cwd: options?.cwd ?? "" });
        return {
          ok: true,
          stdout: " Gemini CLI response text \n",
          stderr: "",
          exitCode: 0
        };
      }
    });

    const result = await runtime.runPrint({
      prompt: "Review this plan.",
      cwd: "/tmp/project",
      roleId: "planner",
      executionPolicy: "read-only",
      config: config(),
      env: { GOOGLE_CLOUD_PROJECT: "project-id", GEMINI_API_KEY: "must-not-be-used" }
    });

    expect(result).toMatchObject({
      ok: true,
      text: "Gemini CLI response text",
      stdout: " Gemini CLI response text \n",
      stderr: "",
      exitCode: 0
    });
    expect(calls).toEqual([
      {
        command: "gemini",
        args: [
          "--prompt",
          "Review this plan.",
          "--model",
          "gemini-2.5-flash",
          "--output-format",
          "text"
        ],
        cwd: "/tmp/project"
      }
    ]);
  });

  it("fails closed before running the CLI when disabled or missing structured output", async () => {
    let called = false;
    const runtime = createGeminiCliRuntime({
      runCommand: async () => {
        called = true;
        return { ok: true, stdout: "nope", stderr: "", exitCode: 0 };
      }
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({ enabled: false })
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "Gemini CLI provider is disabled."
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({ structuredOutput: false })
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "Gemini CLI provider requires structuredOutput capability for dispatch."
    });

    expect(called).toBe(false);
  });

  it("reports CLI process failures without exposing provider secrets", async () => {
    const runtime = createGeminiCliRuntime({
      runCommand: async () => ({
        ok: false,
        stdout: "",
        stderr: "not logged in",
        exitCode: 1
      })
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config(),
        env: { GEMINI_API_KEY: "secret-token" }
      })
    ).resolves.toMatchObject({
      ok: false,
      text: "",
      stdout: "",
      stderr: "Gemini CLI request failed: not logged in",
      exitCode: 1
    });
  });

  it("does not support background sessions, resume, cancellation, or edits", async () => {
    const runtime = createGeminiCliRuntime();
    const handle = runtime.startSession({
      prompt: "Review",
      cwd: "/tmp/project",
      workspaceRoot: "/tmp/project",
      runId: "run_gemini_cli_session",
      roleId: "planner",
      executionPolicy: "read-only",
      config: config()
    });

    expect(handle.providerSessionId).toBeUndefined();
    expect(handle.supportsStdin).toBe(false);
    expect(handle.snapshot().warnings).toContain(
      "Gemini CLI adapter does not support background sessions, resume, live stdin, cancellation, or edits."
    );
    expect(await handle.done).toBe("failed");
  });
});
