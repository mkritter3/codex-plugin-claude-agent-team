import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("AGY write validation live smoke script", () => {
  it("fails closed unless live provider use is explicitly confirmed or dry-run is requested", () => {
    const result = spawnSync(
      "node",
      ["scripts/live-smoke-agy-write-validation.mjs", "--provider", "agy"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm-live-provider-use");
    expect(result.stderr).toContain("--dry-run");
  });

  it("requires AGY provider selectors only", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-agy-write-validation.mjs",
        "--dry-run",
        "--provider",
        "family:gemini"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("agy");
    expect(result.stderr).toContain("family:agy");
  });

  it("prints a sanitized dry-run write validation plan without connecting to MCP", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-agy-write-validation.mjs",
        "--dry-run",
        "--provider",
        "agy"
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
      providerSelectors?: readonly string[];
      model?: string;
      toolFlow?: readonly string[];
      plannedProofs?: Array<{ role?: string; expectedFile?: string; expectedText?: string }>;
    };
    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      providerSelectors: ["agy"],
      model: "gemini-3.8-flash-high"
    });
    expect(report.toolFlow).toEqual([
      "agent_team_doctor",
      "agent_team_list_providers",
      "agent_team_start",
      "agent_team_status",
      "agent_team_dashboard",
      "agent_team_summary",
      "agent_team_cleanup"
    ]);
    expect(report.plannedProofs).toEqual([
      {
        role: "frontend-engineer",
        providerSelector: "agy",
        expectedFile: "index.html",
        expectedText: "Gemini UI write proof"
      }
    ]);
    expect(result.stdout).not.toMatch(
      /prompt|task|providerSessionId|payload|secret|process id|command args|GEMINI_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN/i
    );
  });

  it("is registered as an opt-in script outside CI", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["smoke:agy-write"]).toBe(
      "node scripts/live-smoke-agy-write-validation.mjs"
    );
    expect(packageJson.scripts?.ci).not.toContain("smoke:agy-write");
  });

  it("uses packaged MCP tools and fixture-local Gemini write validation", async () => {
    const script = await readText("scripts/live-smoke-agy-write-validation.mjs");

    expect(script).toContain("@modelcontextprotocol/sdk/client/index.js");
    expect(script).toContain("@modelcontextprotocol/sdk/client/stdio.js");
    expect(script).toContain('join(repoRoot, "dist", "index.js")');
    expect(script).toContain("buildToolRequestOptions");
    expect(script).toContain("writeValidated: true");
    expect(script).toContain("gemini-3.8-flash-high");
    expect(script).toContain('readValue("--model"');
    expect(script).toContain("allowedWorktreeRoots");
    expect(script).toContain("rev-parse");
    expect(script).toContain("frontend-engineer");
    expect(script).toContain("index.html");
    expect(script).toContain("Gemini UI write proof");
    expect(script).not.toContain("AGY_TRUST_WORKSPACE");
    expect(script).toContain("agent_team_cleanup");
    expect(script).toContain("StdioClientTransport");
    expect(script).not.toContain("runClaudePrint");
    expect(script).not.toContain("startClaudeBackgroundSession");
    expect(script).not.toContain("requireProviderRuntime");
    expect(script).not.toContain("--yolo");
  });
});
