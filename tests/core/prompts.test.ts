import { describe, expect, it } from "vitest";
import { getRole } from "../../src/core/roles.js";
import { buildRolePrompt } from "../../src/core/prompts.js";

describe("buildRolePrompt", () => {
  it("builds a read-only role prompt with the verdict protocol", () => {
    const prompt = buildRolePrompt({
      role: getRole("code-reviewer"),
      task: "Review the staged diff for regressions.",
      cwd: "/repo"
    });

    expect(prompt).toContain("Role: Code Reviewer");
    expect(prompt).toContain("Workspace: /repo");
    expect(prompt).toContain("Review the staged diff for regressions.");
    expect(prompt).toContain("Do not modify files.");
    expect(prompt).toContain("Do not run write commands.");
    expect(prompt).toContain("<<<VERDICT>>>");
    expect(prompt).toContain("status: SHIP | REVISE | BLOCKED | INCONCLUSIVE");
    expect(prompt).toContain("<<<END_VERDICT>>>");
  });
});
