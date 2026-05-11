import { describe, expect, it } from "vitest";
import { listRoles } from "../../../src/core/roles.js";
import {
  buildClaudeAgentDefinitions,
  serializeClaudeAgentDefinitions,
  validateClaudeAgentDefinitions
} from "../../../src/providers/claude-code-cli/agents.js";
import { READ_ONLY_CLAUDE_DISALLOWED_TOOLS } from "../../../src/providers/claude-code-cli/role-policy.js";

describe("Claude agent definitions", () => {
  it("generates one deterministic definition for every provider-neutral role", () => {
    const definitions = buildClaudeAgentDefinitions();

    expect(Object.keys(definitions)).toEqual(listRoles().map((role) => role.id));
    expect(definitions["code-reviewer"]).toMatchObject({
      description: "Performs read-only diff or file review.",
      tools: ["Read", "Grep", "Glob", "LS"],
      disallowedTools: READ_ONLY_CLAUDE_DISALLOWED_TOOLS
    });
    const codeReviewer = definitions["code-reviewer"];
    expect(codeReviewer).toBeDefined();
    expect(codeReviewer?.prompt).toContain("Role id: code-reviewer");
    expect(codeReviewer?.prompt).toContain("<<<VERDICT>>>");
  });

  it("keeps read-only roles from receiving edit, write, bash, or bypass permissions", () => {
    const definitions = buildClaudeAgentDefinitions();

    for (const role of listRoles().filter((candidate) => candidate.defaultReadOnly)) {
      expect(definitions[role.id]?.disallowedTools).toEqual(
        expect.arrayContaining(["Edit", "MultiEdit", "Write", "NotebookEdit", "Bash"])
      );
      expect(definitions[role.id]?.permissionMode).not.toBe("bypassPermissions");
    }
  });

  it("generates slice implementer without bypassing isolated lifecycle write policy", () => {
    const definition = buildClaudeAgentDefinitions()["slice-implementer"];

    expect(definition).toMatchObject({
      description: "Implements a bounded slice in isolated workspace scope.",
      tools: expect.arrayContaining(["Read", "Grep", "Glob", "LS", "Edit", "MultiEdit", "Write", "Bash"])
    });
    expect(definition?.permissionMode).toBeUndefined();
    expect(definition?.prompt).toContain("Only modify files inside the execution workspace.");
  });

  it("serializes definitions deterministically for the Claude --agents flag", () => {
    const definitions = buildClaudeAgentDefinitions();

    expect(serializeClaudeAgentDefinitions(definitions)).toBe(
      serializeClaudeAgentDefinitions(buildClaudeAgentDefinitions())
    );
    expect(JSON.parse(serializeClaudeAgentDefinitions(definitions))).toEqual(definitions);
  });

  it("fails validation when a generated role definition is missing", () => {
    const definitions = { ...buildClaudeAgentDefinitions() };
    delete definitions.planner;

    expect(() => validateClaudeAgentDefinitions(definitions)).toThrow(
      "Missing Claude agent definition for role planner."
    );
  });
});
