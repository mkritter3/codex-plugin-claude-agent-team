import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("Claude live smoke script", () => {
  it("fails closed unless live provider use is explicitly confirmed or dry-run is requested", () => {
    const result = spawnSync("node", ["scripts/live-smoke-claude-team.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm-live-provider-use");
    expect(result.stderr).toContain("--dry-run");
  });

  it("is not part of the default CI gate", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["smoke:claude-live"]).toBe(
      "node scripts/live-smoke-claude-team.mjs"
    );
    expect(packageJson.scripts?.ci).not.toContain("smoke:claude-live");
  });

  it("prints a sanitized dry-run report without connecting to MCP", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-claude-team.mjs",
        "--dry-run",
        "--cwd",
        "/tmp/agent-team-live-smoke"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      status?: string;
      liveProviderUse?: boolean;
      workspaceRoot?: string;
      provider?: string;
      authMode?: string;
      toolFlow?: readonly string[];
      requiredConfirmation?: string;
      policyRequirement?: string;
      plannedRuns?: Array<{ role?: string; correlationId?: string }>;
    };
    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      workspaceRoot: "/tmp/agent-team-live-smoke",
      provider: "claude-code-cli",
      authMode: "subscription-oauth",
      requiredConfirmation: "--confirm-live-provider-use",
      policyRequirement: "policy.liveSmokeEnabled must be true"
    });
    expect(report.toolFlow).toEqual([
      "agent_team_doctor",
      "agent_team_dispatch",
      "agent_team_start_parallel",
      "agent_team_status_many",
      "agent_team_dashboard",
      "agent_team_summary",
      "agent_team_message_many",
      "agent_team_wind_down_many",
      "agent_team_status_many"
    ]);
    expect(report.plannedRuns?.map((run) => run.role)).toEqual([
      "planner",
      "planner",
      "code-reviewer"
    ]);
    expect(result.stdout).not.toMatch(
      /prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
    );
  });

  it("uses the packaged MCP boundary and public team tools for confirmed live smoke", async () => {
    const script = await readText("scripts/live-smoke-claude-team.mjs");

    expect(script).toContain("live-smoke-claude-utils.mjs");
    expect(script).toContain("@modelcontextprotocol/sdk/client/index.js");
    expect(script).toContain("@modelcontextprotocol/sdk/client/stdio.js");
    expect(script).toContain('join(repoRoot, "dist", "index.js")');
    for (const toolName of [
      "agent_team_doctor",
      "agent_team_dispatch",
      "agent_team_start_parallel",
      "agent_team_status_many",
      "agent_team_dashboard",
      "agent_team_summary",
      "agent_team_message_many",
      "agent_team_wind_down_many"
    ]) {
      expect(script).toContain(toolName);
    }
    expect(script).toContain("liveSmokeEnabled");
    expect(script).toContain("--max-wait-ms");
    expect(script).toContain("waitForCompletionStatuses");
    expect(script).toContain("buildToolRequestOptions");
    expect(script).toContain("StdioClientTransport");
    expect(script).toContain("env: process.env");
    expect(script).not.toContain("runClaudePrint");
    expect(script).not.toContain("startClaudeBackgroundSession");
    expect(script).not.toContain("requireProviderRuntime");
    expect(script).not.toContain("createDefaultLifecycleRegistry");
  });

  it("does not treat wind-down as successful live-smoke completion", async () => {
    const script = await readText("scripts/live-smoke-claude-team.mjs");

    expect(script).not.toContain('"winding-down"');
    expect(script).toContain("hasAllCompletedRuns");
    expect(script).toContain("nonTerminalRunRefs");
    expect(script).toContain("agent_team_cancel_many");
  });
});
