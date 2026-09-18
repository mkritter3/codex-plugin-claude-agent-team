import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("Codex CLI write validation live smoke script", () => {
  it("fails closed unless live provider use is explicitly confirmed or dry-run is requested", () => {
    const result = spawnSync(
      "node",
      ["scripts/live-smoke-codex-write-validation.mjs", "--provider", "codex-cli"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm-live-provider-use");
    expect(result.stderr).toContain("--dry-run");
  });

  it("requires Codex CLI provider selectors only", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-codex-write-validation.mjs",
        "--dry-run",
        "--provider",
        "agy"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("codex-cli");
  });

  it("prints a sanitized dry-run write validation plan without connecting to MCP", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-codex-write-validation.mjs",
        "--dry-run",
        "--provider",
        "codex-cli"
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
      authMode?: string;
      model?: string;
      toolFlow?: readonly string[];
      plannedProofs?: Array<{
        role?: string;
        expectedFiles?: readonly string[];
        verificationCommand?: string;
      }>;
    };
    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      providerSelectors: ["codex-cli"],
      authMode: "subscription-oauth",
      model: "gpt-5.5"
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
        role: "slice-implementer",
        providerSelector: "codex-cli",
        expectedFiles: ["src/math.js", "tests/math.test.js", "TEST_RUN_PROOF.txt"],
        verificationCommand: "npm test"
      }
    ]);
    expect(result.stdout).not.toMatch(
      /prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|OPENAI_BASE_URL/i
    );
  });

  it("is registered as an opt-in script outside CI", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["smoke:codex-write"]).toBe(
      "node scripts/live-smoke-codex-write-validation.mjs"
    );
    expect(packageJson.scripts?.ci).not.toContain("smoke:codex-write");
  });

  it("uses packaged MCP tools and fixture-local Codex write validation", async () => {
    const script = await readText("scripts/live-smoke-codex-write-validation.mjs");

    expect(script).toContain("@modelcontextprotocol/sdk/client/index.js");
    expect(script).toContain("@modelcontextprotocol/sdk/client/stdio.js");
    expect(script).toContain('join(repoRoot, "dist", "index.js")');
    expect(script).toContain("buildToolRequestOptions");
    expect(script).toContain("writeValidated: true");
    expect(script).toContain("allowedWorktreeRoots");
    expect(script).toContain("rev-parse");
    expect(script).toContain("slice-implementer");
    expect(script).toContain("src/math.js");
    expect(script).toContain("tests/math.test.js");
    expect(script).toContain("TEST_RUN_PROOF.txt");
    expect(script).toContain("npm test");
    expect(script).toContain("sourceUnmodified");
    expect(script).toContain("independentNpmTestPassed");
    expect(script).toContain("agent_team_cleanup");
    expect(script).toContain("StdioClientTransport");
    expect(script).not.toContain("runClaudePrint");
    expect(script).not.toContain("startClaudeBackgroundSession");
    expect(script).not.toContain("requireProviderRuntime");
    expect(script).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});
