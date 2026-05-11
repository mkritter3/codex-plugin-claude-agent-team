import { describe, expect, it } from "vitest";
import { getRole, listRoles } from "../../src/core/roles.js";

describe("role registry", () => {
  it("lists stable provider-neutral roles with capability requirements", () => {
    const roles = listRoles();

    expect(roles.map((role) => role.id)).toEqual([
      "architect",
      "planner",
      "code-reviewer",
      "debugger",
      "test-designer",
      "slice-implementer",
      "ux-product-critic"
    ]);
    expect(getRole("slice-implementer").requiredCapabilities).toContain("edits");
    expect(getRole("code-reviewer").requiredCapabilities).toContain("structuredOutput");
  });
});
