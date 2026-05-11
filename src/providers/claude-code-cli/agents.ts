import { listRoles } from "../../core/roles.js";
import type { AgentRole, RoleId } from "../../core/types.js";
import { claudeRolePolicyFor } from "./role-policy.js";

export interface ClaudeAgentDefinition {
  readonly description: string;
  readonly prompt: string;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
}

export type ClaudeAgentDefinitions = Partial<Record<RoleId, ClaudeAgentDefinition>>;

function verdictProtocol(): string {
  return [
    "End every completed response with exactly one verdict block:",
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

function promptFor(role: AgentRole): string {
  const shared = [
    `Role: ${role.displayName}`,
    `Role id: ${role.id}`,
    role.description,
    "",
    "You are running behind the Agent Team MCP provider boundary.",
    "Follow the orchestrator prompt, mailbox instructions, and capability policy.",
    "Do not claim model-quality, benchmark, or repository facts without evidence.",
    "",
    verdictProtocol()
  ];

  if (role.defaultReadOnly) {
    return [
      ...shared,
      "",
      "Read-only constraints:",
      "- Do not modify files.",
      "- Do not run write commands.",
      "- Use workspace evidence and report uncertainty explicitly."
    ].join("\n");
  }

  return [
    ...shared,
    "",
    "Implementation constraints:",
    "- Only modify files inside the execution workspace.",
    "- Do not modify the source workspace.",
    "- Do not create commits.",
    "- Keep changes scoped to the requested slice.",
    "- Run focused verification when the repository provides it."
  ].join("\n");
}

function definitionFor(role: AgentRole): ClaudeAgentDefinition {
  const policy = claudeRolePolicyFor({
    roleId: role.id,
    executionPolicy: role.executionPolicy,
    ...(role.defaultReadOnly ? {} : { requestedPermissionMode: "acceptEdits" })
  });

  return {
    description: role.description,
    prompt: promptFor(role),
    tools: policy.allowedTools,
    disallowedTools: policy.disallowedTools
  };
}

export function buildClaudeAgentDefinitions(
  roles: readonly AgentRole[] = listRoles()
): ClaudeAgentDefinitions {
  return Object.fromEntries(
    roles.map((role) => [role.id, definitionFor(role)])
  ) as ClaudeAgentDefinitions;
}

export function validateClaudeAgentDefinitions(
  definitions: ClaudeAgentDefinitions,
  roles: readonly AgentRole[] = listRoles()
): void {
  for (const role of roles) {
    const definition = definitions[role.id];
    if (definition === undefined) {
      throw new Error(`Missing Claude agent definition for role ${role.id}.`);
    }
    if (definition.description.trim().length === 0) {
      throw new Error(`Claude agent definition ${role.id} has an empty description.`);
    }
    if (definition.prompt.trim().length === 0) {
      throw new Error(`Claude agent definition ${role.id} has an empty prompt.`);
    }
    if (definition.permissionMode === "bypassPermissions") {
      throw new Error(`Claude agent definition ${role.id} cannot use bypassPermissions.`);
    }
  }
}

export function serializeClaudeAgentDefinitions(
  definitions: ClaudeAgentDefinitions
): string {
  validateClaudeAgentDefinitions(definitions);
  return JSON.stringify(definitions);
}
