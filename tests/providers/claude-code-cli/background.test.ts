import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClaudeBackgroundSessionError,
  startClaudeBackgroundSession
} from "../../../src/providers/claude-code-cli/background.js";

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly pid = 1234;
  killed = false;
  readonly signals: string[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.signals.push(signal ?? "SIGTERM");
    return true;
  }
}

class FakeChildProcessWithoutStdin extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = null;
  readonly pid = 1234;
  killed = false;
  readonly signals: string[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.signals.push(signal ?? "SIGTERM");
    return true;
  }
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-background-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("Claude background session runner", () => {
  it("spawns Claude with read-only stream-json args", () => {
    const child = new FakeChildProcess();
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];

    startClaudeBackgroundSession(
      {
        prompt: "Inspect the repo",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_1",
        env: {}
      },
      {
        spawn: (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          return child;
        }
      }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("claude");
    expect(calls[0]?.cwd).toBe(workspace);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "default"
      ])
    );
    expect(calls[0]?.args).not.toContain("Inspect the repo");
    expect(calls[0]?.args).not.toContain("--bare");
    expect(calls[0]?.args).not.toContain("acceptEdits");
    expect(calls[0]?.args).not.toContain("bypassPermissions");
    expect(calls[0]?.args).toContain("--exclude-dynamic-system-prompt-sections");
    const input = JSON.parse(child.stdin.read()?.toString().trim() ?? "{}");
    expect(input).toMatchObject({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "Inspect the repo" }]
      }
    });
  });

  it("allows scoped API-key auth mode for non-subscription Claude Code profiles", () => {
    const child = new FakeChildProcess();
    const calls: Array<{ args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];

    startClaudeBackgroundSession(
      {
        prompt: "Inspect the repo",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_api_key_profile",
        providerAuthMode: "api-key",
        model: "kimi-k2.6:cloud",
        env: {
          ANTHROPIC_BASE_URL: "http://localhost:11434",
          ANTHROPIC_AUTH_TOKEN: "secret-token",
          ANTHROPIC_API_KEY: "secret-token",
          OLLAMA_API_KEY: "secret-token"
        }
      },
      {
        spawn: (_command, args, options) => {
          calls.push({
            args,
            ...(options.env === undefined ? {} : { env: options.env })
          });
          return child;
        }
      }
    );

    expect(calls[0]?.args).toContain("--model");
    expect(calls[0]?.args[calls[0]?.args.indexOf("--model") + 1]).toBe("kimi-k2.6:cloud");
    expect(calls[0]?.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://localhost:11434",
      ANTHROPIC_AUTH_TOKEN: "secret-token",
      ANTHROPIC_API_KEY: "secret-token",
      OLLAMA_API_KEY: "secret-token"
    });
  });

  it("applies read-only role policy to background sessions", () => {
    const child = new FakeChildProcess();
    const calls: Array<{ args: readonly string[] }> = [];

    startClaudeBackgroundSession(
      {
        prompt: "Inspect the repo",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_policy",
        roleId: "planner",
        env: {}
      },
      {
        spawn: (_command, args) => {
          calls.push({ args });
          return child;
        }
      }
    );

    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "--agents",
        "--agent",
        "planner",
        "--permission-mode",
        "default",
        "--allowedTools",
        "Read,Grep,Glob,LS",
        "--disallowedTools",
        "Edit,MultiEdit,Write,NotebookEdit,Bash"
      ])
    );
    const agentsIndex = calls[0]?.args.indexOf("--agents") ?? -1;
    expect(JSON.parse(calls[0]?.args[agentsIndex + 1] ?? "{}")).toHaveProperty(
      "planner"
    );
    expect(calls[0]?.args).not.toContain("acceptEdits");
    expect(calls[0]?.args).not.toContain("bypassPermissions");
    expect(calls[0]?.args).not.toContain("--bare");
  });

  it("resumes an existing Claude Code session id without bare mode", () => {
    const child = new FakeChildProcess();
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];

    startClaudeBackgroundSession(
      {
        prompt: "Continue the investigation",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_resume",
        roleId: "planner",
        sessionId: "session_abc",
        env: {}
      },
      {
        spawn: (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          return child;
        }
      }
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "--resume",
        "session_abc",
        "--agents",
        "--agent",
        "planner",
        "--exclude-dynamic-system-prompt-sections",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json"
      ])
    );
    expect(calls[0]?.args).not.toContain("--bare");
  });

  it("terminates and expires background sessions when timeout elapses", async () => {
    const child = new FakeChildProcess();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_timeout",
        timeoutMs: 1,
        env: {}
      },
      { spawn: () => child }
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    child.emit("close", null, "SIGKILL");
    await expect(handle.done).resolves.toBe("expired");
    await expect(readFile(handle.logPath!, "utf8")).resolves.toContain(
      "Session timed out after 1ms."
    );
  });

  it("uses acceptEdits only when isolated implementation execution requests it", () => {
    const child = new FakeChildProcess();
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];

    startClaudeBackgroundSession(
      {
        prompt: "Implement the slice",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_write",
        roleId: "slice-implementer",
        permissionMode: "acceptEdits",
        env: {}
      },
      {
        spawn: (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          return child;
        }
      }
    );

    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        "Read,Grep,Glob,LS,Edit,MultiEdit,Write,Bash"
      ])
    );
    expect(calls[0]?.args).not.toContain("--disallowedTools");
    expect(calls[0]?.args).not.toContain("--bare");
    expect(calls[0]?.args).not.toContain("bypassPermissions");
  });

  it("captures stdout transcript, parsed text, activities, and bounded stderr", async () => {
    const child = new FakeChildProcess();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_2",
        env: {}
      },
      { spawn: () => child, now: () => 10, maxStderrLines: 2 }
    );

    child.stdout.write(
      `${JSON.stringify({ type: "system", session_id: "session_abc" })}\n`
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "hello" }] }
      })}\n`
    );
    child.stderr.write("first\nsecond\nthird\n");
    child.emit("close", 0, null);

    await expect(handle.done).resolves.toBe("completed");

    expect(handle.providerSessionId).toBe("session_abc");
    expect(handle.snapshot().text).toBe("hello");
    expect(handle.lastStderr).toEqual(["second", "third"]);
    expect(handle.currentActivity).toEqual({
      type: "text",
      summary: "hello",
      timestamp: 10
    });
    await expect(readFile(handle.transcriptPath!, "utf8")).resolves.toContain(
      "session_abc"
    );
    await expect(readFile(handle.logPath!, "utf8")).resolves.toContain("third");
  });

  it("rotates oversized background logs through the shared bounded writer", async () => {
    const child = new FakeChildProcess();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_rotate",
        env: {}
      },
      {
        spawn: () => child,
        maxLogBytes: 40,
        maxRotatedLogFiles: 2
      }
    );

    child.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "first log line" }] }
      })}\n`
    );
    child.stderr.write("second log line with more bytes\n");
    child.stdout.write(
      `${JSON.stringify({
        type: "result",
        result: "third log line with more bytes"
      })}\n`
    );
    child.emit("close", 0, null);

    await expect(handle.done).resolves.toBe("completed");
    expect((await stat(handle.logPath!)).size).toBeLessThanOrEqual(40);
    await expect(readFile(`${handle.logPath!}.1`, "utf8")).resolves.toContain(
      "second log line"
    );
  });

  it("surfaces explicit outbox requests through live snapshots", async () => {
    const child = new FakeChildProcess();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_outbox",
        env: {}
      },
      { spawn: () => child }
    );

    child.stdout.write(
      `${JSON.stringify({
        type: "agent_team_outbox_request",
        request: {
          id: "ask_live_1",
          messageType: "approval_request",
          correlationId: "corr_live_1",
          payload: { question: "May I inspect the failing CI logs?" }
        }
      })}\n`
    );

    expect(handle.snapshot().pendingOutboxRequests).toEqual([
      {
        id: "ask_live_1",
        messageType: "approval_request",
        correlationId: "corr_live_1",
        payload: { question: "May I inspect the failing CI logs?" }
      }
    ]);
    child.emit("close", 0, null);
    await expect(handle.done).resolves.toBe("completed");
  });

  it("does not surface free-form questions as outbox requests", async () => {
    const child = new FakeChildProcess();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_question_text",
        env: {}
      },
      { spawn: () => child }
    );

    child.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Should I keep going?" }]
        }
      })}\n`
    );

    expect(handle.snapshot().pendingOutboxRequests).toEqual([]);
    child.emit("close", 0, null);
    await expect(handle.done).resolves.toBe("completed");
  });

  it("supports soft and force kill with distinct signals", () => {
    const child = new FakeChildProcess();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_3",
        env: {}
      },
      { spawn: () => child }
    );

    handle.kill();
    handle.forceKill();

    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("writes initial stream-json input and closes stdin for prompt-mode completion", () => {
    const child = new FakeChildProcess();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_stdin",
        env: {}
      },
      { spawn: () => child }
    );

    expect(handle.supportsStdin).toBe(false);
    expect(handle.writeStdin?.("{\"type\":\"agent_team_message\"}\n")).toBe(false);
    const input = JSON.parse(child.stdin.read()?.toString().trim() ?? "{}");
    expect(input.message.content[0].text).toBe("Inspect");
  });

  it("reports stdin write failure when stdin is unavailable", () => {
    const child = new FakeChildProcessWithoutStdin();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_no_stdin",
        env: {}
      },
      { spawn: () => child }
    );

    expect(handle.supportsStdin).toBe(false);
    expect(handle.writeStdin?.("{\"type\":\"agent_team_message\"}\n")).toBe(false);
  });

  it("reports stdin write failure when stdin is destroyed", () => {
    const child = new FakeChildProcess();
    const handle = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_destroyed_stdin",
        env: {}
      },
      { spawn: () => child }
    );
    child.stdin.destroy();

    expect(handle.supportsStdin).toBe(false);
    expect(handle.writeStdin?.("{\"type\":\"agent_team_message\"}\n")).toBe(false);
  });

  it("resolves interrupted and failed statuses from child close", async () => {
    const interruptedChild = new FakeChildProcess();
    const failedChild = new FakeChildProcess();

    const interrupted = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_4",
        env: {}
      },
      { spawn: () => interruptedChild }
    );
    const failed = startClaudeBackgroundSession(
      {
        prompt: "Inspect",
        cwd: workspace,
        workspaceRoot: workspace,
        runId: "run_bg_5",
        env: {}
      },
      { spawn: () => failedChild }
    );

    interruptedChild.emit("close", null, "SIGTERM");
    failedChild.emit("close", 2, null);

    await expect(interrupted.done).resolves.toBe("interrupted");
    await expect(failed.done).resolves.toBe("failed");
  });

  it("blocks API-key override environment variables in subscription mode", () => {
    expect(() =>
      startClaudeBackgroundSession(
        {
          prompt: "Inspect",
          cwd: workspace,
          workspaceRoot: workspace,
          runId: "run_bg_6",
          env: { ANTHROPIC_API_KEY: "secret" }
        },
        { spawn: () => new FakeChildProcess() }
      )
    ).toThrow(ClaudeBackgroundSessionError);
  });
});
