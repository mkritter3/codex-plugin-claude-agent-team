import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  createCodexCliRuntime,
  codexCliProvider
} from "../../../src/providers/codex-cli/runtime.js";
import type { ProviderSessionDoneStatus } from "../../../src/providers/types.js";

function config(input: {
  readonly enabled?: boolean;
  readonly executable?: string;
  readonly model?: string;
  readonly structuredOutput?: boolean;
  readonly tools?: boolean;
  readonly edits?: boolean;
  readonly sessionResume?: boolean;
  readonly cancellation?: boolean;
  readonly workspaceIsolation?: boolean;
  readonly writeValidated?: boolean;
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      codexCli: {
        enabled: input.enabled ?? true,
        executable: input.executable ?? "codex",
        model: input.model ?? "gpt-5.5",
        displayName: "Codex CLI",
        writeValidated: input.writeValidated ?? false,
        capabilities: {
          structuredOutput: input.structuredOutput ?? true,
          longContext: true,
          reasoning: true,
          tools: input.tools ?? false,
          edits: input.edits ?? false,
          sessionResume: input.sessionResume ?? false,
          cancellation: input.cancellation ?? false,
          workspaceIsolation: input.workspaceIsolation ?? false
        }
      }
    }
  } as AgentTeamConfig;
}

class FakeCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly signals: Array<NodeJS.Signals | undefined> = [];
  killed = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.signals.push(signal);
    return true;
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    this.emit("close", code, signal);
  }
}

describe("Codex CLI runtime", () => {
  it("keeps the provider descriptor auto-enabled by default", () => {
    expect(
      codexCliProvider(DEFAULT_AGENT_TEAM_CONFIG, { executableAvailable: true })
    ).toMatchObject({
      id: "codex-cli",
      authMode: "subscription-oauth",
      available: true,
      capabilities: expect.arrayContaining(["edits", "workspaceIsolation"])
    });
    expect(createCodexCliRuntime().descriptor()).toMatchObject({
      id: "codex-cli",
      authMode: "subscription-oauth",
      available: true,
      capabilities: expect.arrayContaining(["edits", "workspaceIsolation"])
    });
  });

  it("runs Codex exec read-only with configured model and sanitized subscription env", async () => {
    const calls: Array<{
      command: string;
      args: readonly string[];
      cwd: string;
      env?: NodeJS.ProcessEnv;
    }> = [];
    const runtime = createCodexCliRuntime({
      runCommand: async (command, args, options) => {
        calls.push({
          command,
          args,
          cwd: options?.cwd ?? "",
          ...(options?.env === undefined ? {} : { env: options.env })
        });
        return {
          ok: true,
          stdout: " Codex response text \n",
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
      env: {
        OPENAI_API_KEY: "must-not-be-used",
        OPENAI_BASE_URL: "https://must-not-be-used.example",
        CODEX_HOME: "/tmp/codex-home"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      text: "Codex response text",
      stdout: " Codex response text \n",
      stderr: "",
      exitCode: 0
    });
    expect(calls).toEqual([
      {
        command: "codex",
        args: [
          "exec",
          "--model",
          "gpt-5.5",
          "--cd",
          "/tmp/project",
          "--sandbox",
          "read-only",
          "Review this plan."
        ],
        cwd: "/tmp/project",
        env: expect.objectContaining({ CODEX_HOME: "/tmp/codex-home" })
      }
    ]);
    expect(calls[0]?.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(calls[0]?.env).not.toHaveProperty("OPENAI_BASE_URL");
  });

  it("fails closed before running the CLI when disabled or missing structured output", async () => {
    let called = false;
    const runtime = createCodexCliRuntime({
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
      stderr: "Codex CLI provider is disabled."
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({ structuredOutput: false })
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "Codex CLI provider requires structuredOutput capability for dispatch."
    });

    expect(called).toBe(false);
  });

  it("starts isolated edit sessions with workspace-write sandbox only after validation", async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    const child = new FakeCodexProcess();
    const runtime = createCodexCliRuntime({
      spawn: (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return child;
      }
    });

    const handle = runtime.startSession({
      prompt: "Implement a bounded slice.",
      cwd: "/tmp/worktree",
      workspaceRoot: "/tmp/source",
      runId: "run_codex_write",
      roleId: "slice-implementer",
      executionPolicy: "isolated-edit",
      permissionMode: "acceptEdits",
      config: config({
        writeValidated: true,
        tools: true,
        edits: true,
        sessionResume: true,
        cancellation: true,
        workspaceIsolation: true
      })
    });

    child.stdout.write("done\n");
    child.close(0);

    expect(calls[0]).toMatchObject({
      command: "codex",
      cwd: "/tmp/worktree"
    });
    expect(calls[0]?.args).toEqual([
      "exec",
      "--model",
      "gpt-5.5",
      "--cd",
      "/tmp/worktree",
      "--sandbox",
      "workspace-write",
      "Implement a bounded slice."
    ]);
    expect(handle.supportsStdin).toBe(false);
    await expect(handle.done).resolves.toBe("completed" satisfies ProviderSessionDoneStatus);
  });

  it("rejects isolated edit sessions unless the full autonomous worker gate is validated", () => {
    const runtime = createCodexCliRuntime();

    expect(() =>
      runtime.startSession({
        prompt: "Implement.",
        cwd: "/tmp/worktree",
        workspaceRoot: "/tmp/source",
        runId: "run_codex_write_blocked",
        roleId: "slice-implementer",
        executionPolicy: "isolated-edit",
        permissionMode: "acceptEdits",
        config: config({
          writeValidated: true,
          tools: true,
          edits: true,
          workspaceIsolation: true
        })
      })
    ).toThrow("Codex CLI isolated edit requires sessionResume, cancellation.");
  });
});
