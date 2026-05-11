import { describe, expect, it } from "vitest";
import { buildClaudeCommand } from "../../../src/providers/claude-code-cli/commands.js";

describe("buildClaudeCommand", () => {
  it("builds claude print mode with json output", () => {
    const command = buildClaudeCommand({
      prompt: "Review the diff",
      outputFormat: "json",
      allowedTools: ["Read", "Grep"],
      disallowedTools: ["Bash"],
      permissionMode: "acceptEdits",
      cwd: "/repo"
    });

    expect(command.command).toBe("claude");
    expect(command.args).toContain("-p");
    expect(command.args).toContain("Review the diff");
    expect(command.args).toContain("--output-format");
    expect(command.args).toContain("json");
    expect(command.args).toContain("--allowedTools");
    expect(command.args).toContain("Read,Grep");
    expect(command.args).toContain("--disallowedTools");
    expect(command.args).toContain("Bash");
    expect(command.args).not.toContain("--bare");
  });

  it("adds resume when a session id exists", () => {
    const command = buildClaudeCommand({
      prompt: "Continue",
      outputFormat: "stream-json",
      sessionId: "abc123",
      verbose: true,
      cwd: "/repo"
    });

    expect(command.args).toContain("--resume");
    expect(command.args).toContain("abc123");
    expect(command.args).toContain("--verbose");
  });

  it("rejects bare mode unless explicitly enabled", () => {
    expect(() =>
      buildClaudeCommand({
        prompt: "Run",
        outputFormat: "json",
        bare: true,
        allowBareMode: false,
        cwd: "/repo"
      })
    ).toThrow("--bare is disabled");

    expect(
      buildClaudeCommand({
        prompt: "Run",
        outputFormat: "json",
        bare: true,
        allowBareMode: true,
        cwd: "/repo"
      }).args
    ).toContain("--bare");
  });
});
