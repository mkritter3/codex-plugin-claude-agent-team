import { UnknownRoleError } from "./errors.js";
import type { AgentRole, RoleId } from "./types.js";

const ROLES: readonly AgentRole[] = [
  {
    id: "architect",
    displayName: "Architect",
    description: "Reviews source-of-truth ownership, boundaries, and maintainability.",
    requiredCapabilities: ["structuredOutput", "longContext"],
    defaultReadOnly: true
  },
  {
    id: "planner",
    displayName: "Planner",
    description: "Critiques implementation plans for sequencing, tests, and risk.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true
  },
  {
    id: "code-reviewer",
    displayName: "Code Reviewer",
    description: "Performs read-only diff or file review.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true
  },
  {
    id: "debugger",
    displayName: "Debugger",
    description: "Reviews root-cause hypotheses and evidence.",
    requiredCapabilities: ["structuredOutput", "longContext"],
    defaultReadOnly: true
  },
  {
    id: "test-designer",
    displayName: "Test Designer",
    description: "Designs focused tests and benchmark integrity checks.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true
  },
  {
    id: "slice-implementer",
    displayName: "Slice Implementer",
    description: "Implements a bounded slice in isolated workspace scope.",
    requiredCapabilities: [
      "structuredOutput",
      "tools",
      "edits",
      "sessionResume",
      "cancellation",
      "workspaceIsolation"
    ],
    defaultReadOnly: false
  },
  {
    id: "ux-product-critic",
    displayName: "UX Product Critic",
    description: "Reviews product quality, workflow fit, UI density, and copy.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true
  }
] as const;

const ROLE_BY_ID = new Map<RoleId, AgentRole>(ROLES.map((role) => [role.id, role]));

export function listRoles(): readonly AgentRole[] {
  return ROLES;
}

export function getRole(roleId: RoleId): AgentRole {
  const role = ROLE_BY_ID.get(roleId);
  if (role === undefined) {
    throw new UnknownRoleError(roleId);
  }
  return role;
}
