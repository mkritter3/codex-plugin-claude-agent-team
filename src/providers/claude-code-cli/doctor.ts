import type {
  ClaudeEnvironmentInspection,
  ClaudeEnvironmentInspectionInput
} from "./types.js";

const SUBSCRIPTION_OVERRIDE_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN"
] as const;

export function inspectClaudeEnvironment(
  input: ClaudeEnvironmentInspectionInput
): ClaudeEnvironmentInspection {
  if (input.authMode !== "subscription-oauth") {
    return { warnings: [] };
  }

  const warnings = SUBSCRIPTION_OVERRIDE_VARS.flatMap((name) =>
    input.env[name] === undefined || input.env[name] === ""
      ? []
      : [`${name} is set and may override Claude Code subscription OAuth.`]
  );

  return { warnings };
}
