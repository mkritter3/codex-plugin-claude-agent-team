import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  createAgyRuntime,
  agyProvider
} from "../../../src/providers/agy/runtime.js";
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
      agy: {
        enabled: input.enabled ?? true,
        executable: input.executable ?? "agy",
        model: input.model ?? "gemini-3-pro-preview",
        displayName: "AGY",
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

class FakeAgyProcess extends EventEmitter {
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

describe("AGY runtime", () => {
  it("keeps the provider descriptor auto-enabled by default", () => {
    expect(
      agyProvider(DEFAULT_AGENT_TEAM_CONFIG, { executableAvailable: true })
    ).toMatchObject({
      id: "agy",
      authMode: "oauth",
      available: true,
      capabilities: expect.arrayContaining(["sessionResume", "cancellation"])
    });
    expect(createAgyRuntime().descriptor()).toMatchObject({
      id: "agy",
      authMode: "oauth",
      available: true,
      capabilities: expect.arrayContaining(["sessionResume", "cancellation"])
    });
  });

  it("runs headless AGY with configured model and sanitized text output", async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    const runtime = createAgyRuntime({
      runCommand: async (command, args, options) => {
        calls.push({ command, args, cwd: options?.cwd ?? "" });
        return {
          ok: true,
          stdout: JSON.stringify({status: "SUCCESS", response: "AGY response text"}),
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
      text: "AGY response text",
      stdout: JSON.stringify({status: "SUCCESS", response: "AGY response text"}),
      stderr: "",
      exitCode: 0
    });
    expect(calls).toEqual([
      {
        command: "agy",
        args: [
          "--print", "Review this plan.", "--output-format", "json",
          "--model", "gemini-3-pro-preview", "--sandbox", "--mode", "plan"
        ],
        cwd: "/tmp/project"
      }
    ]);
  });

  it("fails closed before running the CLI when disabled or missing structured output", async () => {
    let called = false;
    const runtime = createAgyRuntime({
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
      stderr: "AGY provider is disabled."
    });

    await expect(
      runtime.runPrint({
        prompt: "Review",
        cwd: "/tmp/project",
        config: config({ structuredOutput: false })
      })
    ).resolves.toMatchObject({
      ok: false,
      stderr: "AGY provider requires structuredOutput capability for dispatch."
    });

    expect(called).toBe(false);
  });

  it("reports CLI process failures without exposing provider secrets", async () => {
    const runtime = createAgyRuntime({
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
      stderr: "AGY request failed: not logged in",
      exitCode: 1
    });
  });

  it("starts read-only sessions in AGY sandboxed plan mode", async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    const child = new FakeAgyProcess();
    const runtime = createAgyRuntime({
      spawn: (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return child;
      }
    });
    const handle = runtime.startSession({
      prompt: "Review",
      cwd: "/tmp/project",
      workspaceRoot: "/tmp/project",
      runId: "run_agy_session",
      roleId: "planner",
      executionPolicy: "read-only",
      config: config()
    });

    child.stdout.write(JSON.stringify({ status: "SUCCESS", response: "<<<VERDICT>>>\nstatus: SHIP\nsummary: ok\n<<<END_VERDICT>>>\n", conversation_id: "agy-session" }) + "\n");
    child.close(0);

    expect(handle.supportsStdin).toBe(false);
    expect(calls).toEqual([
      {
        command: "agy",
        args: [
          "--print", "Review", "--output-format", "json",
          "--model", "gemini-3-pro-preview", "--sandbox", "--mode", "plan"
        ],
        cwd: "/tmp/project"
      }
    ]);
    expect(await handle.done).toBe("completed");
    expect(handle.snapshot().text).toContain("status: SHIP");
  });

  it("starts isolated edit sessions in AGY sandboxed accept-edits mode", async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    const child = new FakeAgyProcess();
    const runtime = createAgyRuntime({
      spawn: (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return child;
      }
    });

    const handle = runtime.startSession({
      prompt: "Implement UI copy.",
      cwd: "/tmp/worktree",
      workspaceRoot: "/tmp/source",
      runId: "run_gemini_write",
      roleId: "frontend-engineer",
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

    child.stdout.write(JSON.stringify({ status: "SUCCESS", response: "done", conversation_id: "agy-write-session" }) + "\n");
    child.close(0);

    expect(calls[0]).toMatchObject({
      command: "agy",
      cwd: "/tmp/worktree"
    });
    expect(calls[0]?.args).toEqual([
      "--print", "Implement UI copy.", "--output-format", "json",
      "--model", "gemini-3-pro-preview", "--sandbox", "--mode", "accept-edits"
    ]);
    expect(handle.supportsStdin).toBe(false);
    expect(await handle.done).toBe("completed");
  });

  it("rejects isolated edit sessions unless the full autonomous worker gate is validated", () => {
    const runtime = createAgyRuntime();

    expect(() =>
      runtime.startSession({
        prompt: "Implement UI copy.",
        cwd: "/tmp/worktree",
        workspaceRoot: "/tmp/source",
        runId: "run_gemini_write_blocked",
        roleId: "frontend-engineer",
        executionPolicy: "isolated-edit",
        permissionMode: "acceptEdits",
        config: config({
          writeValidated: true,
          tools: true,
          edits: true,
          workspaceIsolation: true
        })
      })
    ).toThrow(
      "AGY isolated edit requires sessionResume, cancellation."
    );
  });

  it("maps non-zero exit, cancellation, and timeout to lifecycle done statuses", async () => {
    const failedChild = new FakeAgyProcess();
    const cancelledChild = new FakeAgyProcess();
    const timedOutChild = new FakeAgyProcess();
    const children = [failedChild, cancelledChild, timedOutChild];
    const runtime = createAgyRuntime({
      spawn: () => children.shift()!
    });

    const failed = runtime.startSession({
      prompt: "Review",
      cwd: "/tmp/project",
      workspaceRoot: "/tmp/project",
      runId: "run_failed",
      config: config()
    });
    failedChild.stderr.write("no capacity\n");
    failedChild.close(1);
    await expect(failed.done).resolves.toBe("failed" satisfies ProviderSessionDoneStatus);
    expect(failed.snapshot().lastStderr).toContain("no capacity");

    const cancelled = runtime.startSession({
      prompt: "Review",
      cwd: "/tmp/project",
      workspaceRoot: "/tmp/project",
      runId: "run_cancelled",
      config: config()
    });
    cancelled.kill();
    cancelledChild.close(null, "SIGTERM");
    await expect(cancelled.done).resolves.toBe("interrupted" satisfies ProviderSessionDoneStatus);
    expect(cancelledChild.signals).toEqual(["SIGTERM"]);

    const timedOut = runtime.startSession({
      prompt: "Review",
      cwd: "/tmp/project",
      workspaceRoot: "/tmp/project",
      runId: "run_timed_out",
      timeoutMs: 1,
      config: config()
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    timedOutChild.close(null, "SIGTERM");
    await expect(timedOut.done).resolves.toBe("expired" satisfies ProviderSessionDoneStatus);
  });
});
