import { describe, expect, it } from "vitest";
import {
  recommendDelegation,
  recommendDelegationForWorkflowPhase
} from "../../src/core/delegation-playbook.js";

describe("recommendDelegation", () => {
  it("prefers Claude Opus for planning and high-complexity review", () => {
    const planning = recommendDelegation({ workType: "planning" });
    const review = recommendDelegation({ workType: "high-complexity-review" });

    expect(planning.recommendedRoles).toEqual(
      expect.arrayContaining(["architect", "planner", "test-designer"])
    );
    expect(planning.providerPreferences).toContain("claude-code-cli:opus");
    expect(review.providerPreferences[0]).toBe("claude-code-cli:opus");
    expect(review.evidenceRequirements).toContain("Codex final sign-off");
  });

  it("prefers Sonnet and Codex CLI for senior implementation", () => {
    const recommendation = recommendDelegation({ workType: "implementation" });

    expect(recommendation.recommendedRoles).toEqual(
      expect.arrayContaining(["slice-implementer"])
    );
    expect(recommendation.providerPreferences).toEqual(
      expect.arrayContaining(["claude-code-cli:sonnet", "codex-cli"])
    );
    expect(recommendation.riskControls).toContain("isolated_worktree_required");
  });

  it("prefers Haiku for search and reconnaissance", () => {
    const recommendation = recommendDelegation({ workType: "search" });

    expect(recommendation.providerPreferences).toContain("claude-code-cli:haiku");
    expect(recommendation.riskControls).toContain("read_only_required");
  });

  it("treats Gemini CLI as a full UI and frontend worker when configured", () => {
    const recommendation = recommendDelegation({ workType: "ui-ux" });

    expect(recommendation.recommendedRoles).toEqual(
      expect.arrayContaining(["ui-ux-designer", "frontend-engineer"])
    );
    expect(recommendation.providerPreferences).toContain("gemini-cli");
    expect(recommendation.riskControls).toContain("isolated_worktree_required");
  });

  it("contains Ollama junior workers to bounded isolated slices with senior review", () => {
    const recommendation = recommendDelegation({ workType: "junior-implementation" });

    expect(recommendation.providerPreferences).toEqual([
      "ollama-claude-code:kimi-k2.6",
      "ollama-claude-code:glm-5.1",
      "ollama-claude-code:deepseek-v4-flash"
    ]);
    expect(recommendation.riskControls).toEqual(
      expect.arrayContaining([
        "isolated_worktree_required",
        "bounded_scope_required",
        "senior_review_required"
      ])
    );
  });

  it("separates Codex decisions from user-facing CEO/product decisions", () => {
    const recommendation = recommendDelegation({ workType: "planning" });

    expect(recommendation.codexOwnedDecisions).toEqual(
      expect.arrayContaining(["slice decomposition", "provider routing under policy"])
    );
    expect(recommendation.userEscalationCategories).toEqual(
      expect.arrayContaining(["product", "trust", "cost", "release", "permission", "user_impact"])
    );
    expect(recommendation.userEscalationCategories).not.toContain("technical");
  });

  it("maps workflow phases to playbook recommendations", () => {
    expect(
      recommendDelegationForWorkflowPhase("planning").map((item) => item.workType)
    ).toEqual(["planning"]);
    expect(
      recommendDelegationForWorkflowPhase("executing").map((item) => item.workType)
    ).toEqual(["implementation", "junior-implementation"]);
    expect(
      recommendDelegationForWorkflowPhase("reviewing").map((item) => item.workType)
    ).toEqual(["high-complexity-review", "test-hardening"]);
  });

  it("emits sanitized routing guidance only", () => {
    const output = JSON.stringify([
      recommendDelegation({ workType: "planning" }),
      recommendDelegation({ workType: "implementation" }),
      recommendDelegation({ workType: "ui-ux" }),
      recommendDelegation({ workType: "junior-implementation" })
    ]);

    expect(output).toContain("routing_guidance_only");
    expect(output).not.toMatch(
      /api[_-]?key|secret|rawProvider|providerPayload|commandArgs|best model|provider superiority|benchmark winner/i
    );
  });
});
