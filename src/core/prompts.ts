import type { AgentRole } from "./types.js";

export interface BuildRolePromptInput {
  readonly role: AgentRole;
  readonly task: string;
  readonly cwd: string;
}

export function buildRolePrompt(input: BuildRolePromptInput): string {
  const readOnlyRules = input.role.defaultReadOnly
    ? [
        "This is a read-only dispatch.",
        "Do not modify files.",
        "Do not run write commands.",
        "Do not create commits, branches, worktrees, or persistent artifacts.",
        "Use evidence from the workspace and report uncertainty explicitly."
      ]
    : ["Follow the explicit permission policy for this role."];

  return [
    `Role: ${input.role.displayName}`,
    `Role id: ${input.role.id}`,
    `Workspace: ${input.cwd}`,
    "",
    "Task:",
    input.task,
    "",
    "Operating constraints:",
    ...readOnlyRules.map((rule) => `- ${rule}`),
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
  ].join("\n");
}
