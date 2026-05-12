import { describe, expect, it } from "vitest";
import {
  buildClaudeLiveSmokeDryRunReport,
  CLAUDE_LIVE_SMOKE_TOOL_FLOW
} from "../../src/core/live-smoke.js";

describe("Claude live smoke report planning", () => {
  it("builds a sanitized dry-run report over the public MCP flow", () => {
    const report = buildClaudeLiveSmokeDryRunReport({
      workspaceRoot: "/tmp/agent-team-live-smoke"
    });

    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      workspaceRoot: "/tmp/agent-team-live-smoke",
      provider: "claude-code-cli",
      authMode: "subscription-oauth",
      requiredConfirmation: "--confirm-live-provider-use",
      policyRequirement: "policy.liveSmokeEnabled must be true"
    });
    expect(report.toolFlow).toEqual(CLAUDE_LIVE_SMOKE_TOOL_FLOW);
    expect(report.plannedRuns).toEqual([
      {
        role: "planner",
        provider: "claude-code-cli",
        correlationId: "live-planner"
      },
      {
        role: "code-reviewer",
        provider: "claude-code-cli",
        correlationId: "live-reviewer"
      }
    ]);
    expect(report.plannedRuns.map((run) => run.role)).not.toContain("slice-implementer");
    expect(report.knownLimitations).toContain(
      "This smoke proves transport and lifecycle mechanics only; it makes no provider ranking, comparative capability, or long-context claim."
    );
    expect(JSON.stringify(report)).not.toMatch(
      /prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
    );
  });
});
