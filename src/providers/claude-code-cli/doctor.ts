import type {
  ClaudeEnvironmentInspection,
  ClaudeEnvironmentInspectionInput
} from "./types.js";
import type { ProviderHealthCheck } from "../types.js";
import {
  buildClaudeAgentDefinitions,
  validateClaudeAgentDefinitions
} from "./agents.js";

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

export function checkClaudeAgentDefinitions(): ProviderHealthCheck {
  try {
    const definitions = buildClaudeAgentDefinitions();
    validateClaudeAgentDefinitions(definitions);
    return {
      id: "claude-agent-definitions",
      status: "pass",
      message: "Generated Claude agent definitions cover all Agent Team roles.",
      details: { count: Object.keys(definitions).length }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: "claude-agent-definitions",
      status: "fail",
      message: "Generated Claude agent definitions are invalid.",
      details: {
        error: message,
        fix: "Regenerate Claude provider agent definitions from the Agent Team role registry."
      }
    };
  }
}
