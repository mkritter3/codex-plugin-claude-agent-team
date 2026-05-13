import { UnknownRoleError } from "./errors.js";
import type { AgentRole, RoleId } from "./types.js";

const WRITE_CAPABILITIES = [
  "structuredOutput",
  "tools",
  "edits",
  "sessionResume",
  "cancellation",
  "workspaceIsolation"
] as const;

const ROLES: readonly AgentRole[] = [
  {
    id: "architect",
    displayName: "Architect",
    description: "Reviews source-of-truth ownership, boundaries, and maintainability.",
    requiredCapabilities: ["structuredOutput", "longContext"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "planner",
    displayName: "Planner",
    description: "Critiques implementation plans for sequencing, tests, and risk.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "ui-ux-designer",
    displayName: "UI/UX Designer",
    description: "Reviews interaction design, workflow ergonomics, accessibility, and copy fit.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "frontend-engineer",
    displayName: "Frontend Engineer",
    description: "Implements UI and client-state slices inside isolated workspace scope.",
    requiredCapabilities: WRITE_CAPABILITIES,
    defaultReadOnly: false,
    executionPolicy: "isolated-edit"
  },
  {
    id: "backend-engineer",
    displayName: "Backend Engineer",
    description: "Implements API, persistence, and runtime-contract slices inside isolated workspace scope.",
    requiredCapabilities: WRITE_CAPABILITIES,
    defaultReadOnly: false,
    executionPolicy: "isolated-edit"
  },
  {
    id: "slice-implementer",
    displayName: "Slice Implementer",
    description: "Implements a bounded slice in isolated workspace scope.",
    requiredCapabilities: WRITE_CAPABILITIES,
    defaultReadOnly: false,
    executionPolicy: "isolated-edit"
  },
  {
    id: "code-reviewer",
    displayName: "Code Reviewer",
    description: "Performs read-only diff or file review.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "test-designer",
    displayName: "Test Designer",
    description: "Designs focused tests and benchmark integrity checks.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "qa-engineer",
    displayName: "QA Engineer",
    description: "Reviews user-flow validation, edge cases, and real-world acceptance behavior.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "test-hardening-engineer",
    displayName: "Test Hardening Engineer",
    description: "Strengthens tests around malformed inputs, races, corruption, and failure modes.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "security-reviewer",
    displayName: "Security Reviewer",
    description: "Reviews secrets, permissions, injection, exfiltration, and tool trust boundaries.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "performance-reviewer",
    displayName: "Performance Reviewer",
    description: "Reviews latency, memory, concurrency, large-state behavior, and provider-call cost.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "devops-release-engineer",
    displayName: "DevOps Release Engineer",
    description: "Reviews CI, packaging, installation, rollback, release, and migration gates.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "docs-dx-writer",
    displayName: "Docs/DX Writer",
    description: "Reviews runbooks, setup, troubleshooting, operator handoff, and developer experience.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "integration-engineer",
    displayName: "Integration Engineer",
    description: "Reviews merge ordering, conflict risk, combined diff coherence, and integration evidence.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "debugger",
    displayName: "Debugger",
    description: "Reviews root-cause hypotheses and evidence.",
    requiredCapabilities: ["structuredOutput", "longContext"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
  },
  {
    id: "ux-product-critic",
    displayName: "UX Product Critic",
    description: "Reviews product quality, workflow fit, UI density, and copy.",
    requiredCapabilities: ["structuredOutput"],
    defaultReadOnly: true,
    executionPolicy: "read-only"
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
