import { describe, expect, it } from "vitest";
import {
  claudeRolePolicyFor,
  READ_ONLY_CLAUDE_DISALLOWED_TOOLS
} from "../../../src/providers/claude-code-cli/role-policy.js";
import type { RoleId } from "../../../src/core/types.js";

const READ_ONLY_ROLES: readonly RoleId[] = [
  "architect",
  "planner",
  "code-reviewer",
  "debugger",
  "test-designer",
  "ux-product-critic"
];

describe("Claude role policy", () => {
  it("maps read-only roles to default permissions with read/search tools", () => {
    for (const roleId of READ_ONLY_ROLES) {
      const policy = claudeRolePolicyFor({ roleId, executionPolicy: "read-only" });

      expect(policy).toMatchObject({
        permissionMode: "default",
        allowedTools: ["Read", "Grep", "Glob", "LS"],
        disallowedTools: READ_ONLY_CLAUDE_DISALLOWED_TOOLS
      });
      expect(policy.disallowedTools).toEqual(
        expect.arrayContaining(["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"])
      );
    }
  });

  it("maps slice implementer to edit-capable tools only when acceptEdits is requested", () => {
    const policy = claudeRolePolicyFor({
      roleId: "slice-implementer",
      executionPolicy: "isolated-edit",
      requestedPermissionMode: "acceptEdits"
    });

    expect(policy.permissionMode).toBe("acceptEdits");
    expect(policy.allowedTools).toEqual(
      expect.arrayContaining(["Read", "Grep", "Glob", "LS", "Edit", "MultiEdit", "Write", "Bash"])
    );
    expect(policy.disallowedTools).not.toContain("Edit");
    expect(policy.permissionMode).not.toBe("bypassPermissions");
  });

  it("keeps slice implementer default-safe without acceptEdits", () => {
    const policy = claudeRolePolicyFor({
      roleId: "slice-implementer",
      executionPolicy: "isolated-edit"
    });

    expect(policy.permissionMode).toBe("default");
    expect(policy.allowedTools).toEqual(["Read", "Grep", "Glob", "LS"]);
    expect(policy.disallowedTools).toEqual(READ_ONLY_CLAUDE_DISALLOWED_TOOLS);
  });
});
