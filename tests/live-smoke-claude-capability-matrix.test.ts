import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("Claude live capability matrix script", () => {
  it("fails closed unless live provider use is explicitly confirmed or dry-run is requested", () => {
    const result = spawnSync(
      "node",
      ["scripts/live-smoke-claude-capability-matrix.mjs"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm-live-provider-use");
    expect(result.stderr).toContain("--dry-run");
  });

  it("is not part of the default CI gate", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["smoke:claude-live-matrix"]).toBe(
      "node scripts/live-smoke-claude-capability-matrix.mjs"
    );
    expect(packageJson.scripts?.ci).not.toContain("smoke:claude-live-matrix");
  });

  it("prints a sanitized dry-run capability matrix without connecting to MCP", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-claude-capability-matrix.mjs",
        "--dry-run",
        "--cwd",
        "/tmp/agent-team-live-matrix"
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
      plannedCapabilities?: readonly string[];
      knownLimitations?: readonly string[];
    };
    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      workspaceRoot: "/tmp/agent-team-live-matrix",
      provider: "claude-code-cli",
      authMode: "subscription-oauth",
      requiredConfirmation: "--confirm-live-provider-use",
      policyRequirement: "policy.liveSmokeEnabled must be true"
    });
    expect(report.toolFlow).toEqual([
      "agent_team_doctor",
      "agent_team_dispatch",
      "agent_team_start_parallel",
      "agent_team_start",
      "agent_team_status_many",
      "agent_team_message",
      "agent_team_wind_down",
      "agent_team_cancel",
      "agent_team_create_team",
      "agent_team_dashboard",
      "agent_team_summary",
      "agent_team_cleanup"
    ]);
    expect(report.plannedCapabilities).toEqual([
      "direct-dispatch",
      "parallel-read-only-team",
      "isolated-implementation",
      "mailbox-delivery",
      "wind-down",
      "cancellation",
      "team-record",
      "dashboard",
      "summary",
      "cleanup",
      "policy-failure"
    ]);
    expect(result.stdout).not.toMatch(
      /prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
    );
  });

  it("uses the packaged MCP boundary and public tools for confirmed live matrix", async () => {
    const script = await readText("scripts/live-smoke-claude-capability-matrix.mjs");

    expect(script).toContain("@modelcontextprotocol/sdk/client/index.js");
    expect(script).toContain("@modelcontextprotocol/sdk/client/stdio.js");
    expect(script).toContain('join(repoRoot, "dist", "index.js")');
    for (const toolName of [
      "agent_team_doctor",
      "agent_team_dispatch",
      "agent_team_start_parallel",
      "agent_team_start",
      "agent_team_status_many",
      "agent_team_message",
      "agent_team_wind_down",
      "agent_team_cancel",
      "agent_team_create_team",
      "agent_team_dashboard",
      "agent_team_summary",
      "agent_team_cleanup"
    ]) {
      expect(script).toContain(toolName);
    }
    expect(script).toContain("policy.liveSmokeEnabled");
    expect(script).toContain("knownLimitations");
    expect(script).toContain("--max-wait-ms");
    expect(script).toContain("result.isError");
    expect(script).toContain("StdioClientTransport");
    expect(script).not.toContain("runClaudePrint");
    expect(script).not.toContain("startClaudeBackgroundSession");
    expect(script).not.toContain("requireProviderRuntime");
    expect(script).not.toContain("createDefaultLifecycleRegistry");
    expect(script).not.toContain("claude ");
  });
});
