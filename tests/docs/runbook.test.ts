import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const runbookUrl = new URL(
  "../../docs/runbooks/claude-team-session.md",
  import.meta.url
);
const roadmapUrl = new URL(
  "../../docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md",
  import.meta.url
);

async function readRunbook(): Promise<string> {
  return readFile(runbookUrl, "utf8");
}

describe("Claude team session runbook", () => {
  it("documents the full public MCP workflow without chat-history dependence", async () => {
    const doc = await readRunbook();

    for (const text of [
      "agent_team_doctor",
      "agent_team_start_parallel",
      "agent_team_create_team",
      "agent_team_get_team",
      "agent_team_list_teams",
      "agent_team_dashboard",
      "agent_team_status_many",
      "agent_team_summary",
      "agent_team_message_many",
      "agent_team_wind_down_many",
      "agent_team_cleanup",
      "agent_team_create_workflow",
      "agent_team_plan_consensus",
      "agent_team_start_slices",
      "agent_team_unblock_slice",
      "agent_team_review_slice",
      "agent_team_integration_queue",
      "agent_team_record_integration",
      "agent_team_workflow_report",
      "npm run build",
      "npm run install:check",
      "npm run smoke:mcp-stdio",
      "npm run smoke:workflow-orchestrator",
      "npm run smoke:package",
      "npm run smoke:claude-live",
      "npm run smoke:claude-live-matrix",
      "npm run smoke:providers-live",
      "npm run smoke:gemini-write",
      "npm run smoke:codex-write",
      "Codex CLI Subscription Provider",
      "codex-cli",
      "subscription-oauth",
      "docs/superpowers/reports/2026-05-13-agent-team-live-codex-cli-provider-proof.md",
      "docs/superpowers/reports/2026-05-13-agent-team-live-codex-cli-write-proof.md",
      "npm run ci",
      "docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md",
      "docs/superpowers/reports/2026-05-13-agent-team-live-gemini-write-proof.md"
    ]) {
      expect(doc).toContain(text);
    }
    expect(doc).toContain("opt-in live smoke");
    expect(doc).toContain("not part of CI");
    expect(doc).toContain("--confirm-live-provider-use");
    expect(doc).toContain("--provider family:gemini");
    expect(doc).toContain("--provider gemini-cli");
    expect(doc).toContain("GEMINI_CLI_TRUST_WORKSPACE=true");
    expect(doc).toContain("gemini-3-flash-preview");
    expect(doc).toContain("frontend-engineer");
    expect(doc).toContain("--approval-mode auto_edit");
    expect(doc).toContain("explicit read-only provider routing");
    expect(doc).toContain("no provider comparison, ranking, score, or long-context claim");
    expect(doc).toContain("policy.liveSmokeEnabled");
    expect(doc).toContain("sanitized report");
    expect(doc).toContain("capability matrix");
    expect(doc).toContain("isolated worktree");
    expect(doc).toContain("mailbox");
    expect(doc).toContain("wind-down");
    expect(doc).toContain("cancel");
    expect(doc).toContain("cleanup");
    expect(doc).toContain("no provider ranking");
    expect(doc).toContain("absolute MCP config");
    expect(doc).toContain("does not call providers");
    expect(doc).toContain(".agent-team/audit/events.jsonl");
    expect(doc).toContain("allowedProviderSelectors");
    expect(doc).toContain("auditEnabled");
    expect(doc).toContain("retained implementation worktree");
    expect(doc).toContain("state_corrupt");
    expect(doc).toContain("state-layout.json");
    expect(doc).toContain("schemaVersion");
    expect(doc).toContain("partial_failure");
    expect(doc).toContain("awaiting-input");
    expect(doc).toContain("cleanupBlocked");
	    expect(doc).toContain("read-only dashboard");
	    expect(doc).toContain(".agent-team/teams/");
	    expect(doc).toContain("Per-run sidecars remain authoritative");
	    expect(doc).toContain("providers.ollamaClaudeCode");
	    expect(doc).toContain("OLLAMA_API_KEY");
	    expect(doc).toContain("ollama-claude-code:kimi-k2.6");
	    expect(doc).toContain("ANTHROPIC_BASE_URL");
	    expect(doc).toContain("scoped provider env");
	    expect(doc).toContain("writeValidated");
	    expect(doc).toContain("Kimi K2.6");
	    expect(doc).toContain("GLM 5.1");
	    expect(doc).toContain("DeepSeek");
    expect(doc).toContain("local Codex subscription login");
    expect(doc).toContain("OPENAI_API_KEY");
    expect(doc).toContain("OPENAI_BASE_URL");
    expect(doc).toContain("OPENAI_ORG_ID");
    expect(doc).toContain("OPENAI_PROJECT");
    expect(doc).toContain("independently runs `npm test` in the execution worktree");
    expect(doc).toContain("model-quality claim");
    expect(doc).toContain("completionStatus");
    expect(doc).toContain("ready-to-integrate");
    expect(doc).toContain("missing-evidence");
    expect(doc).toContain("Codex-owned manual integration");
    expect(doc).toContain("CEO/product-level");
    expect(doc).toContain("final gate verification");
    expect(doc).toContain("cleanup only after integration evidence is saved");
	  });

  it("keeps documentation provider-neutral and avoids private implementation disclosure", async () => {
    const doc = await readRunbook();
    const forbiddenAuthPattern = new RegExp(
      [
        "ANTHROPIC" + "_API_KEY=.*",
        "ANTHROPIC" + "_AUTH_TOKEN=.*",
        "api[- ]key " + "fallback"
      ].join("|"),
      "i"
    );
    const forbiddenImplementationPattern = new RegExp(
      [
        "internal " + "prompt",
        "hidden " + "instruction",
        "generated " + "agent definition",
        "bypass" + "Permissions",
        "process " + "id"
      ].join("|"),
      "i"
    );
    const forbiddenClaimPattern = new RegExp(
      ["bench" + "mark", "quality " + "score", "model-quality " + "comparison"].join("|"),
      "i"
    );

    expect(doc).toContain("Claude Code CLI subscription OAuth");
    expect(doc).not.toMatch(forbiddenAuthPattern);
    expect(doc).not.toMatch(forbiddenImplementationPattern);
    expect(doc).not.toMatch(forbiddenClaimPattern);
  });

  it("keeps the roadmap baseline at least through Milestone 30", async () => {
    const roadmap = await readFile(roadmapUrl, "utf8");

    expect(roadmap).toMatch(/Completed through Milestone (3[0-9]|[4-9][0-9])/);
    expect(roadmap).toContain("agent_team_message_many");
    expect(roadmap).toContain("agent_team_wind_down_many");
    expect(roadmap).toContain("agent_team_summary");
  });
});
