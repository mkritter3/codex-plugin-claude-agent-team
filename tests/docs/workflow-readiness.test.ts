import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readText = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const reportPath = "../../docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md";

describe("workflow orchestrator final readiness report", () => {
  it("maps product-level success criteria to concrete repo evidence", async () => {
    const report = await readText(reportPath);

    for (const text of [
      "Final Decision: Complete",
      "Codex remains the senior engineer, orchestrator, reviewer, integrator, and final authority",
      "Claude Code CLI subscription OAuth",
      "required-when-available",
      "degraded evidence",
      "CEO/product-level",
      "10 rounds",
      "15 rounds",
      "no yes-man",
      "expanded L11 full-stack roster",
      "slice DAG",
      "blocked/unblocked",
      "retained isolated worktrees",
      "Codex-owned manual integration",
      "read-only integration queue",
      "final gate evidence",
      "cleanup only after integration evidence is saved",
      "provider-neutral public MCP schemas",
      "No API-key fallback unless explicitly configured",
      "agent_team_create_workflow",
      "agent_team_plan_consensus",
      "agent_team_start_slices",
      "agent_team_unblock_slice",
      "agent_team_review_slice",
      "agent_team_integration_queue",
      "agent_team_record_integration",
      "agent_team_workflow_report",
      "npm run smoke:workflow-orchestrator",
      "npm run ci",
      "fixture-safe",
      "no new live-provider capability claim"
    ]) {
      expect(report).toContain(text);
    }
  });

  it("keeps the final decision honest about proof boundaries", async () => {
    const report = await readText(reportPath);

    expect(report).toContain("Live provider proof is required before claiming new real Opus sign-off behavior");
    expect(report).toContain("No benchmark, model-quality, provider-ranking, long-context, or broad coding-readiness claim is made");
    expect(report).toContain("Future work requires a new product requirement");
    expect(report).not.toMatch(
      /internal prompt text:|hidden instruction text:|raw provider payload:|provider session id:|ANTHROPIC_AUTH_TOKEN=|ANTHROPIC_API_KEY=|OLLAMA_API_KEY=|process\.pid|quality score|model-quality comparison|provider ranking claim:|api-key fallback:/i
    );
  });
});
