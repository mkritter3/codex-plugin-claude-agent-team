import type { AgentRole } from "./types.js";

export interface BuildRolePromptInput {
  readonly role: AgentRole;
  readonly task: string;
  readonly cwd: string;
}

export interface BuildReplyPromptInput {
  readonly role: AgentRole;
  readonly cwd: string;
  readonly parentRunId: string;
  readonly providerSessionId: string;
  readonly message: string;
}

export interface BuildImplementationPromptInput {
  readonly role: AgentRole;
  readonly task: string;
  readonly sourceCwd: string;
  readonly executionCwd: string;
}

function readOnlyRules(role: AgentRole): readonly string[] {
  return role.defaultReadOnly
    ? [
        "This is a read-only dispatch.",
        "Do not modify files.",
        "Do not run write commands.",
        "Do not create commits, branches, worktrees, or persistent artifacts.",
        "Use evidence from the workspace and report uncertainty explicitly."
      ]
    : ["Follow the explicit permission policy for this role."];
}

function verdictProtocol(): readonly string[] {
  return [
    "- Keep output concise and evidence-grounded.",
    "- End with exactly one verdict block using this protocol:",
    "",
    "<<<VERDICT>>>",
    "status: SHIP | REVISE | BLOCKED | INCONCLUSIVE",
    "summary: ...",
    "required_changes:",
    "- ...",
    "evidence:",
    "- ...",
    "risks:",
    "- ...",
    "<<<END_VERDICT>>>"
  ];
}

export function buildRolePrompt(input: BuildRolePromptInput): string {
  return [
    `Role: ${input.role.displayName}`,
    `Role id: ${input.role.id}`,
    `Workspace: ${input.cwd}`,
    "",
    "Task:",
    input.task,
    "",
    "Operating constraints:",
    ...readOnlyRules(input.role).map((rule) => `- ${rule}`),
    ...verdictProtocol()
  ].join("\n");
}

export function buildReplyPrompt(input: BuildReplyPromptInput): string {
  return [
    `Role: ${input.role.displayName}`,
    `Role id: ${input.role.id}`,
    `Workspace: ${input.cwd}`,
    `Parent run: ${input.parentRunId}`,
    `Provider session: ${input.providerSessionId}`,
    "",
    "This is a resumed continuation of the existing provider session.",
    "The message below was recorded durably in the agent-team inbox; do not assume prior live delivery.",
    "",
    "New message:",
    input.message,
    "",
    "Operating constraints:",
    ...readOnlyRules(input.role).map((rule) => `- ${rule}`),
    ...verdictProtocol()
  ].join("\n");
}

export function buildImplementationPrompt(input: BuildImplementationPromptInput): string {
  return [
    `Role: ${input.role.displayName}`,
    `Role id: ${input.role.id}`,
    `Source workspace: ${input.sourceCwd}`,
    `Execution workspace: ${input.executionCwd}`,
    "",
    "Task:",
    input.task,
    "",
    "Operating constraints:",
    "- This is an isolated implementation run.",
    "- Only modify files inside the execution workspace.",
    "- Do not modify the source workspace.",
    "- Do not create commits.",
    "- Keep changes scoped to the requested slice.",
    "- Run focused verification when the repository provides it.",
    ...verdictProtocol()
  ].join("\n");
}
