import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_CONFIG
} from "../../src/core/config.js";
import { evaluateStartPolicy } from "../../src/core/policy.js";
import type {
  AgentProviderDescriptor,
  AgentTeamConfig
} from "../../src/core/types.js";

const claudeProvider: AgentProviderDescriptor = {
  id: "claude-code-cli",
  displayName: "Claude Code CLI",
  authMode: "subscription-oauth",
  capabilities: ["structuredOutput", "longContext", "tools", "sessionResume", "cancellation"],
  available: true
};

const grokProvider: AgentProviderDescriptor = {
  id: "grok:grok-4.20-reasoning",
  displayName: "Grok 4.20 Reasoning",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext", "reasoning"],
  model: "grok-4.20",
  available: true
};

function config(policy: Partial<AgentTeamConfig["policy"]>): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    policy: {
      ...DEFAULT_AGENT_TEAM_CONFIG.policy,
      ...policy
    }
  };
}

describe("evaluateStartPolicy", () => {
  it("allows unrestricted roles and providers with sanitized details", () => {
    const decision = evaluateStartPolicy({
      config: DEFAULT_AGENT_TEAM_CONFIG,
      roleId: "planner",
      provider: claudeProvider,
      executionPolicy: "read-only"
    });

    expect(decision).toMatchObject({
      status: "allowed",
      reason: "policy_allowed",
      details: {
        role: "planner",
        provider: "claude-code-cli",
        executionPolicy: "read-only"
      }
    });
    expect(JSON.stringify(decision)).not.toMatch(
      /prompt|providerSessionId|command|secret|payload|process/i
    );
  });

  it("blocks roles outside the allowed role list", () => {
    expect(
      evaluateStartPolicy({
        config: config({ allowedRoles: ["code-reviewer"] }),
        roleId: "planner",
        provider: claudeProvider,
        executionPolicy: "read-only"
      })
    ).toMatchObject({
      status: "blocked",
      reason: "role_not_allowed",
      details: {
        role: "planner",
        allowedRoles: ["code-reviewer"]
      }
    });
  });

  it("supports provider allow selectors by id, family, model, and capability", () => {
    for (const selector of [
      "grok:grok-4.20-reasoning",
      "family:grok",
      "model:grok-4.20",
      "capability:reasoning"
    ]) {
      expect(
        evaluateStartPolicy({
          config: config({ allowedProviderSelectors: [selector] }),
          roleId: "architect",
          provider: grokProvider,
          executionPolicy: "read-only"
        })
      ).toMatchObject({ status: "allowed" });
    }

    expect(
      evaluateStartPolicy({
        config: config({ allowedProviderSelectors: ["family:grok"] }),
        roleId: "planner",
        provider: claudeProvider,
        executionPolicy: "read-only"
      })
    ).toMatchObject({
      status: "blocked",
      reason: "provider_not_allowed",
      details: {
        provider: "claude-code-cli",
        allowedProviderSelectors: ["family:grok"]
      }
    });
  });

  it("blocks isolated-edit starts when write mode is denied by policy", () => {
    expect(
      evaluateStartPolicy({
        config: config({ allowWriteMode: false }),
        roleId: "slice-implementer",
        provider: claudeProvider,
        executionPolicy: "isolated-edit",
        plannedWorktreeRoot: "/tmp/.agent-team-worktrees/repo/run_1"
      })
    ).toMatchObject({
      status: "blocked",
      reason: "write_mode_not_allowed"
    });
  });

  it("blocks planned worktree roots outside allowed roots", () => {
    expect(
      evaluateStartPolicy({
        config: config({ allowedWorktreeRoots: ["/tmp/approved"] }),
        roleId: "slice-implementer",
        provider: claudeProvider,
        executionPolicy: "isolated-edit",
        plannedWorktreeRoot: "/tmp/approved/repo/run_1"
      })
    ).toMatchObject({ status: "allowed" });

    expect(
      evaluateStartPolicy({
        config: config({ allowedWorktreeRoots: ["/tmp/approved"] }),
        roleId: "slice-implementer",
        provider: claudeProvider,
        executionPolicy: "isolated-edit",
        plannedWorktreeRoot: "/tmp/other/repo/run_1"
      })
    ).toMatchObject({
      status: "blocked",
      reason: "worktree_root_not_allowed",
      details: {
        plannedWorktreeRoot: "/tmp/other/repo/run_1",
        allowedWorktreeRoots: ["/tmp/approved"]
      }
    });
  });
});
