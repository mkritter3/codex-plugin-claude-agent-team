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
      "npm run build",
      "npm run smoke:mcp-stdio",
      "npm run ci"
    ]) {
      expect(doc).toContain(text);
    }
    expect(doc).toContain("opt-in live smoke");
    expect(doc).toContain("not part of CI");
    expect(doc).toContain("retained implementation worktree");
    expect(doc).toContain("state_corrupt");
    expect(doc).toContain("partial_failure");
    expect(doc).toContain("awaiting-input");
    expect(doc).toContain("cleanupBlocked");
    expect(doc).toContain("read-only dashboard");
    expect(doc).toContain(".agent-team/teams/");
    expect(doc).toContain("Per-run sidecars remain authoritative");
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
