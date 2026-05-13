import { describe, expect, it } from "vitest";
import { getRole, listRoles } from "../../src/core/roles.js";

describe("role registry", () => {
  it("lists stable provider-neutral roles with capability requirements", () => {
    const roles = listRoles();

    expect(roles.map((role) => role.id)).toEqual([
      "architect",
      "planner",
      "ui-ux-designer",
      "frontend-engineer",
      "backend-engineer",
      "slice-implementer",
      "code-reviewer",
      "test-designer",
      "qa-engineer",
      "test-hardening-engineer",
      "security-reviewer",
      "performance-reviewer",
      "devops-release-engineer",
      "docs-dx-writer",
      "integration-engineer",
      "debugger",
      "ux-product-critic"
    ]);
    for (const roleId of ["frontend-engineer", "backend-engineer", "slice-implementer"] as const) {
      expect(getRole(roleId)).toMatchObject({
        executionPolicy: "isolated-edit",
        defaultReadOnly: false
      });
      expect(getRole(roleId).requiredCapabilities).toEqual(
        expect.arrayContaining([
          "structuredOutput",
          "tools",
          "edits",
          "sessionResume",
          "cancellation",
          "workspaceIsolation"
        ])
      );
    }
    expect(getRole("code-reviewer")).toMatchObject({
      executionPolicy: "read-only"
    });
    expect(getRole("code-reviewer").requiredCapabilities).toContain("structuredOutput");
    expect(getRole("security-reviewer")).toMatchObject({
      executionPolicy: "read-only",
      defaultReadOnly: true
    });
    expect(getRole("performance-reviewer").requiredCapabilities).toContain("structuredOutput");
  });
});
