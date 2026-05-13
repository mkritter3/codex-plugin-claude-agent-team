import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("read-only provider live smoke script", () => {
  it("fails closed unless live provider use is confirmed or dry-run is requested", () => {
    const result = spawnSync(
      "node",
      ["scripts/live-smoke-readonly-providers.mjs", "--provider", "family:gemini"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm-live-provider-use");
    expect(result.stderr).toContain("--dry-run");
  });

  it("requires at least one explicit provider selector", () => {
    const result = spawnSync(
      "node",
      ["scripts/live-smoke-readonly-providers.mjs", "--dry-run"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--provider <selector>");
  });

  it("prints a sanitized dry-run provider proof plan without connecting to MCP", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-readonly-providers.mjs",
        "--dry-run",
        "--cwd",
        "/tmp/agent-team-provider-proof",
        "--provider",
        "family:gemini",
        "--provider",
        "family:grok"
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
      providerSelectors?: readonly string[];
      authMode?: string;
      requiredConfirmation?: string;
      policyRequirement?: string;
      toolFlow?: readonly string[];
      plannedRuns?: Array<{ role?: string; providerSelector?: string; correlationId?: string }>;
    };
    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      workspaceRoot: "/tmp/agent-team-provider-proof",
      providerSelectors: ["family:gemini", "family:grok"],
      authMode: "explicit-provider-config",
      requiredConfirmation: "--confirm-live-provider-use",
      policyRequirement: "policy.liveSmokeEnabled must be true"
    });
    expect(report.toolFlow).toEqual([
      "agent_team_doctor",
      "agent_team_list_providers",
      "agent_team_dispatch",
      "agent_team_dashboard",
      "agent_team_summary"
    ]);
    expect(report.plannedRuns?.map((run) => run.role)).toEqual([
      "code-reviewer",
      "code-reviewer"
    ]);
    expect(report.plannedRuns?.map((run) => run.providerSelector)).toEqual([
      "family:gemini",
      "family:grok"
    ]);
    expect(result.stdout).not.toMatch(
      /prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|GEMINI_API_KEY|GROK_API_KEY/i
    );
  });

  it("rejects invalid provider proof concurrency", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-readonly-providers.mjs",
        "--dry-run",
        "--provider",
        "family:gemini",
        "--concurrency",
        "9"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--concurrency must be an integer from 1 to 3");
  });

  it("uses the packaged MCP boundary and public read-only tools for confirmed provider proof", async () => {
    const script = await readText("scripts/live-smoke-readonly-providers.mjs");

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
    expect(script).toContain("liveSmokeEnabled");
    expect(script).toContain("--concurrency");
    expect(script).toContain("runBoundedProofs");
    expect(script).toContain("Live provider transport proof only");
    expect(script).toContain("Do not inspect files");
    expect(script).toContain("StdioClientTransport");
    expect(script).toContain("env: process.env");
    expect(script).not.toContain("runClaudePrint");
    expect(script).not.toContain("startClaudeBackgroundSession");
    expect(script).not.toContain("requireProviderRuntime");
  });

  it("does not count failed dispatch results as successful provider proofs", async () => {
    const script = await readText("scripts/live-smoke-readonly-providers.mjs");

    expect(script).toContain(
      'status: input.result.status === "completed" ? "completed" : "failed"'
    );
    expect(script).toContain('proof?.status === "completed"');
  });
});
