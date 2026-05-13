import { describe, expect, it } from "vitest";
import { buildClaudeAgentDefinitions } from "../../../src/providers/claude-code-cli/agents.js";
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

  it("adds an explicit model when a provider profile supplies one", () => {
    const command = buildClaudeCommand({
      prompt: "Review",
      outputFormat: "json",
      model: "kimi-k2.6:cloud",
      cwd: "/repo"
    });

    expect(command.args).toContain("--model");
    expect(command.args[command.args.indexOf("--model") + 1]).toBe("kimi-k2.6:cloud");
  });

  it("adds generated agents and selected agent only when provided", () => {
    const definitions = buildClaudeAgentDefinitions();
    const command = buildClaudeCommand({
      prompt: "Review the diff",
      outputFormat: "json",
      agents: definitions,
      agentName: "code-reviewer",
      cwd: "/repo"
    });

    expect(command.args).toContain("--agents");
    const agentsIndex = command.args.indexOf("--agents");
    expect(JSON.parse(command.args[agentsIndex + 1] ?? "")).toEqual(definitions);
    expect(command.args).toContain("--agent");
    expect(command.args[command.args.indexOf("--agent") + 1]).toBe("code-reviewer");

    const defaultCommand = buildClaudeCommand({
      prompt: "Review the diff",
      outputFormat: "json",
      cwd: "/repo"
    });

    expect(defaultCommand.args).not.toContain("--agents");
    expect(defaultCommand.args).not.toContain("--agent");
  });

  it("adds the dynamic system prompt exclusion flag only when requested", () => {
    const command = buildClaudeCommand({
      prompt: "Continue",
      outputFormat: "stream-json",
      excludeDynamicSystemPromptSections: true,
      cwd: "/repo"
    });

    expect(command.args).toContain("--exclude-dynamic-system-prompt-sections");

    const defaultCommand = buildClaudeCommand({
      prompt: "Continue",
      outputFormat: "stream-json",
      cwd: "/repo"
    });

    expect(defaultCommand.args).not.toContain("--exclude-dynamic-system-prompt-sections");
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
