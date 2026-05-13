import type { AgentExecutionPolicy, RoleId } from "../../core/types.js";
import type { ClaudePermissionMode } from "./types.js";

export interface ClaudeRolePolicyInput {
  readonly roleId: RoleId;
  readonly executionPolicy?: AgentExecutionPolicy;
  readonly requestedPermissionMode?: ClaudePermissionMode;
}

export interface ClaudeRolePolicy {
  readonly permissionMode: ClaudePermissionMode;
  readonly allowedTools: readonly string[];
  readonly disallowedTools: readonly string[];
}

const READ_ONLY_CLAUDE_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "LS"] as const;

export const READ_ONLY_CLAUDE_DISALLOWED_TOOLS = [
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "Bash"
] as const;

const EDIT_CLAUDE_ALLOWED_TOOLS = [
  ...READ_ONLY_CLAUDE_ALLOWED_TOOLS,
  "Edit",
  "MultiEdit",
  "Write",
  "Bash"
] as const;

function readOnlyPolicy(): ClaudeRolePolicy {
  return {
    permissionMode: "default",
    allowedTools: READ_ONLY_CLAUDE_ALLOWED_TOOLS,
    disallowedTools: READ_ONLY_CLAUDE_DISALLOWED_TOOLS
  };
}

export function claudeRolePolicyFor(input: ClaudeRolePolicyInput): ClaudeRolePolicy {
  if (input.executionPolicy === "read-only") {
    return readOnlyPolicy();
  }

  if (input.executionPolicy === "isolated-edit") {
    if (input.requestedPermissionMode !== "acceptEdits") {
      return readOnlyPolicy();
    }
    return {
      permissionMode: "acceptEdits",
      allowedTools: EDIT_CLAUDE_ALLOWED_TOOLS,
      disallowedTools: []
    };
  }

  switch (input.roleId) {
    case "architect":
    case "planner":
    case "ui-ux-designer":
    case "code-reviewer":
    case "debugger":
    case "test-designer":
    case "qa-engineer":
    case "test-hardening-engineer":
    case "security-reviewer":
    case "performance-reviewer":
    case "devops-release-engineer":
    case "docs-dx-writer":
    case "integration-engineer":
    case "ux-product-critic":
      return readOnlyPolicy();
    case "frontend-engineer":
    case "backend-engineer":
    case "slice-implementer":
      if (input.requestedPermissionMode !== "acceptEdits") {
        return readOnlyPolicy();
      }
      return {
        permissionMode: "acceptEdits",
        allowedTools: EDIT_CLAUDE_ALLOWED_TOOLS,
        disallowedTools: []
      };
  }
}
