import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
        "Inspect the repo",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "default"
      ])
    );
    expect(calls[0]?.args).not.toContain("--bare");
    expect(calls[0]?.args).not.toContain("acceptEdits");
    expect(calls[0]?.args).not.toContain("bypassPermissions");
    expect(calls[0]?.args).toContain("--exclude-dynamic-system-prompt-sections");
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
        "--exclude-dynamic-system-prompt-sections",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json"
      ])
    );
    expect(calls[0]?.args).not.toContain("--bare");
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
      expect.arrayContaining(["--permission-mode", "acceptEdits"])
    );
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

  it("reports stdin support and write success for live control messages", () => {
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

    expect(handle.supportsStdin).toBe(true);
    expect(handle.writeStdin?.("{\"type\":\"agent_team_message\"}\n")).toBe(true);
    expect(child.stdin.read()?.toString()).toBe("{\"type\":\"agent_team_message\"}\n");
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

    expect(handle.supportsStdin).toBe(true);
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
