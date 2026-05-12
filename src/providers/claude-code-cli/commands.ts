import type { ClaudeCommand, ClaudeCommandInput } from "./types.js";
import { serializeClaudeAgentDefinitions } from "./agents.js";

function pushCsvFlag(args: string[], flag: string, values?: readonly string[]): void {
  if (values !== undefined && values.length > 0) {
    args.push(flag, values.join(","));
  }
}

export function buildClaudeCommand(input: ClaudeCommandInput): ClaudeCommand {
  if (input.bare === true && input.allowBareMode !== true) {
    throw new Error("--bare is disabled unless allowBareMode is true");
  }

  const args =
    input.promptFromStdin === true
      ? ["-p", "--output-format", input.outputFormat]
      : ["-p", input.prompt, "--output-format", input.outputFormat];

  if (input.inputFormat !== undefined) {
    args.push("--input-format", input.inputFormat);
  }
  if (input.outputFormat === "stream-json" || input.verbose === true) {
    args.push("--verbose");
  }
  if (input.sessionId !== undefined) {
    args.push("--resume", input.sessionId);
  }
  if (input.agents !== undefined) {
    args.push("--agents", serializeClaudeAgentDefinitions(input.agents));
  }
  if (input.agentName !== undefined) {
    args.push("--agent", input.agentName);
  }
  if (input.permissionMode !== undefined) {
    args.push("--permission-mode", input.permissionMode);
  }
  if (input.excludeDynamicSystemPromptSections === true) {
    args.push("--exclude-dynamic-system-prompt-sections");
  }
  pushCsvFlag(args, "--allowedTools", input.allowedTools);
  pushCsvFlag(args, "--disallowedTools", input.disallowedTools);
  if (input.bare === true) {
    args.push("--bare");
  }

  return {
    command: "claude",
    args,
    cwd: input.cwd
  };
}
