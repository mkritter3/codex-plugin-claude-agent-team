import { describe, expect, it } from "vitest";
import {
  ClaudeProcessError,
  runClaudePrint,
  type ExecFileLike
} from "../../../src/providers/claude-code-cli/runner.js";

describe("runClaudePrint", () => {
  it("runs claude print mode in the requested cwd", async () => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    const execFile: ExecFileLike = async (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd });
      return {
        stdout: JSON.stringify({ session_id: "session_1", result: "<<<VERDICT>>>\nstatus: SHIP\nsummary: ok\nrequired_changes:\n- none\nevidence:\n- test\nrisks:\n- none\n<<<END_VERDICT>>>" }),
        stderr: ""
      };
    };

    const result = await runClaudePrint({
      prompt: "Review",
      cwd: "/repo",
      timeoutMs: 10_000,
      execFile
    });

    expect(calls[0]).toMatchObject({ command: "claude", cwd: "/repo" });
    expect(calls[0]?.args).toContain("-p");
    expect(calls[0]?.args).toContain("--output-format");
    expect(calls[0]?.args).toContain("json");
    expect(calls[0]?.args).not.toContain("--bare");
    expect(calls[0]?.args).not.toContain("acceptEdits");
    expect(calls[0]?.args).not.toContain("bypassPermissions");
    expect(result).toMatchObject({
      ok: true,
      sessionId: "session_1",
      stderr: "",
      exitCode: 0
    });
  });

  it("returns typed failures for non-zero exits", async () => {
    const execFile: ExecFileLike = async () => {
      throw new ClaudeProcessError("claude failed", {
        stdout: "partial",
        stderr: "bad auth",
        exitCode: 2
      });
    };

    const result = await runClaudePrint({
      prompt: "Review",
      cwd: "/repo",
      execFile
    });

    expect(result).toEqual({
      ok: false,
      text: "partial",
      stdout: "partial",
      stderr: "bad auth",
      exitCode: 2
    });
  });
});
