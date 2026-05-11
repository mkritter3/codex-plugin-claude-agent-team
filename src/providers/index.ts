import type { AgentProviderDescriptor } from "../core/types.js";

export const CLAUDE_CODE_CLI_PROVIDER: AgentProviderDescriptor = {
  id: "claude-code-cli",
  displayName: "Claude Code CLI",
  authMode: "subscription-oauth",
  capabilities: [
    "structuredOutput",
    "longContext",
    "tools",
    "edits",
    "sessionResume",
    "cancellation",
    "workspaceIsolation"
  ],
  available: true
};

export function listProviders(): readonly AgentProviderDescriptor[] {
  return [CLAUDE_CODE_CLI_PROVIDER];
}
