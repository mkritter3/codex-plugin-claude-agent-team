import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("Claude model profile live smoke script", () => {
  it("fails closed unless live provider use is confirmed or dry-run is requested", () => {
    const result = spawnSync("node", ["scripts/live-smoke-claude-model-profiles.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm-live-provider-use");
    expect(result.stderr).toContain("--dry-run");
  });

  it("prints a sanitized dry-run plan for opus, sonnet, and haiku aliases", () => {
    const result = spawnSync(
      "node",
      ["scripts/live-smoke-claude-model-profiles.mjs", "--dry-run"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      status?: string;
      liveProviderUse?: boolean;
      providerSelectors?: readonly string[];
      authMode?: string;
      plannedRuns?: Array<{ providerSelector?: string; model?: string }>;
    };

    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      providerSelectors: [
        "claude-code-cli:opus",
        "claude-code-cli:sonnet",
        "claude-code-cli:haiku"
      ],
      authMode: "subscription-oauth"
    });
    expect(report.plannedRuns?.map((run) => run.model)).toEqual([
      "opus",
      "sonnet",
      "haiku"
    ]);
    expect(result.stdout).not.toMatch(
      /prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
    );
  });

  it("uses packaged MCP and public read-only tools for confirmed profile proof", async () => {
    const script = await readText("scripts/live-smoke-claude-model-profiles.mjs");

    expect(script).toContain("@modelcontextprotocol/sdk/client/index.js");
    expect(script).toContain("@modelcontextprotocol/sdk/client/stdio.js");
    expect(script).toContain('join(repoRoot, "dist", "index.js")');
    for (const toolName of [
      "agent_team_doctor",
      "agent_team_list_providers",
      "agent_team_dispatch",
      "agent_team_dashboard",
      "agent_team_summary"
    ]) {
      expect(script).toContain(toolName);
    }
    expect(script).toContain("claude-code-cli:opus");
    expect(script).toContain("claude-code-cli:sonnet");
    expect(script).toContain("claude-code-cli:haiku");
    expect(script).toContain("liveSmokeEnabled");
    expect(script).toContain("subscriptionOauthEnv");
    expect(script).toContain("ANTHROPIC_API_KEY");
    expect(script).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(script).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(script).not.toContain("runClaudePrint");
    expect(script).not.toContain("startClaudeBackgroundSession");
    expect(script).not.toContain("requireProviderRuntime");
  });
});
