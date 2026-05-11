import type { RoleId } from "../../core/types.js";
import type { ClaudePermissionMode } from "./types.js";

export interface ClaudeRolePolicyInput {
  readonly roleId: RoleId;
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
  switch (input.roleId) {
    case "architect":
    case "planner":
    case "code-reviewer":
    case "debugger":
    case "test-designer":
    case "ux-product-critic":
      return readOnlyPolicy();
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
