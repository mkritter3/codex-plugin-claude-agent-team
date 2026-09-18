import { describe, expect, it } from "vitest";
import {
  recommendRolePolicy,
  type WorkflowRolePolicyInput
} from "../../src/core/workflow-role-policy.js";

function rolePolicy(
  overrides: Partial<WorkflowRolePolicyInput> = {}
): WorkflowRolePolicyInput {
  return {
    role: "slice-implementer",
    complexity: "medium",
    surface: "backend",
    ...overrides
  };
}

describe("recommendRolePolicy", () => {
  it("prefers Opus for planning, high-complexity work, review, and security-sensitive surfaces", () => {
    expect(
      recommendRolePolicy(
        rolePolicy({
          role: "planner",
          complexity: "high",
          surface: "architecture"
        })
      )
    ).toMatchObject({
      preferredModelFamily: "claude-opus",
      requiredSeniorReview: true,
      seniorSignoffRequired: true
    });

    expect(
      recommendRolePolicy(
        rolePolicy({
          role: "security-reviewer",
          complexity: "medium",
          surface: "security"
        })
      ).preferredModelFamilies
    ).toEqual(["claude-opus"]);
  });

  it("prefers Sonnet and Codex CLI for implementation execution", () => {
    const policy = recommendRolePolicy(
      rolePolicy({
        role: "slice-implementer",
        complexity: "medium",
        surface: "backend"
      })
    );

    expect(policy.preferredModelFamilies).toEqual(["claude-sonnet", "codex-cli"]);
    expect(policy.autonomy).toBe("full_autonomous");
    expect(policy.requiresIsolatedWorktree).toBe(true);
    expect(policy.requiredSeniorReview).toBe(true);
  });

  it("routes search and reconnaissance work to Haiku", () => {
    expect(
      recommendRolePolicy(
        rolePolicy({
          role: "debugger",
          complexity: "low",
          surface: "search"
        })
      )
    ).toMatchObject({
      preferredModelFamily: "claude-haiku",
      autonomy: "read_only",
      requiresIsolatedWorktree: false,
      maxSliceRisk: "low"
    });
  });

  it("treats Gemini CLI as a full autonomous worker with UI and frontend preference", () => {
    const policy = recommendRolePolicy(
      rolePolicy({
        role: "frontend-engineer",
        complexity: "medium",
        surface: "ui-ux",
        providerClass: "gemini"
      })
    );

    expect(policy.preferredModelFamily).toBe("gemini-cli");
    expect(policy.preferredModelFamilies).toEqual([
      "gemini-cli",
      "claude-sonnet",
      "codex-cli"
    ]);
    expect(policy.autonomy).toBe("full_autonomous");
    expect(policy.defaultSurfaces).toEqual([
      "ui-ux",
      "frontend",
      "visual",
      "browser-flow"
    ]);
    expect(policy.requiresIsolatedWorktree).toBe(true);
  });

  it("keeps Ollama GLM and Kimi workers junior, bounded, isolated, and reviewed", () => {
    const policy = recommendRolePolicy(
      rolePolicy({
        role: "slice-implementer",
        complexity: "low",
        surface: "backend",
        providerClass: "junior-ollama"
      })
    );

    expect(policy.preferredModelFamilies).toEqual([
      "ollama-glm-5.2",
      "ollama-kimi-k2.7-code"
    ]);
    expect(policy.autonomy).toBe("bounded_junior");
    expect(policy.requiresIsolatedWorktree).toBe(true);
    expect(policy.requiredSeniorReview).toBe(true);
    expect(policy.seniorSignoffRequired).toBe(true);
    expect(policy.maxSliceRisk).toBe("medium");
  });
});
