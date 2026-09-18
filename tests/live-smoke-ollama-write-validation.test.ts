import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("Ollama write validation live smoke script", () => {
  it("fails closed unless live provider use is explicitly confirmed or dry-run is requested", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-ollama-write-validation.mjs",
        "--provider",
        "ollama-claude-code:glm-5.2"
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm-live-provider-use");
    expect(result.stderr).toContain("--dry-run");
  });

  it("requires exact Ollama Claude Code provider selectors", () => {
    const result = spawnSync(
      "node",
      ["scripts/live-smoke-ollama-write-validation.mjs", "--dry-run", "--provider", "gemini"],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ollama-claude-code:<profile>");
  });

  it("prints a sanitized dry-run write validation plan without connecting to MCP", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/live-smoke-ollama-write-validation.mjs",
        "--dry-run",
        "--provider",
        "ollama-claude-code:glm-5.2",
        "--provider",
        "ollama-claude-code:kimi-k2.7-code"
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
      toolFlow?: readonly string[];
      plannedProofs?: Array<{ role?: string; expectedFile?: string }>;
    };
    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      providerSelectors: ["ollama-claude-code:glm-5.2", "ollama-claude-code:kimi-k2.7-code"]
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
    expect(report.plannedProofs?.map((proof) => proof.role)).toEqual([
      "slice-implementer",
      "slice-implementer"
    ]);
    expect(report.plannedProofs?.map((proof) => proof.expectedFile)).toEqual([
      "OLLAMA_WRITE_PROOF.txt",
      "OLLAMA_WRITE_PROOF.txt"
    ]);
    expect(result.stdout).not.toMatch(
      /prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OLLAMA_API_KEY/i
    );
  });

  it("is registered as an opt-in script outside CI", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["smoke:ollama-write"]).toBe(
      "node scripts/live-smoke-ollama-write-validation.mjs"
    );
    expect(packageJson.scripts?.ci).not.toContain("smoke:ollama-write");
  });

  it("uses packaged MCP tools and fixture-local write validation", async () => {
    const script = await readText("scripts/live-smoke-ollama-write-validation.mjs");

    expect(script).toContain("@modelcontextprotocol/sdk/client/index.js");
    expect(script).toContain("@modelcontextprotocol/sdk/client/stdio.js");
    expect(script).toContain('join(repoRoot, "dist", "index.js")');
    expect(script).toContain("buildToolRequestOptions");
    expect(script).toContain("writeValidated: true");
    expect(script).toContain("allowedWorktreeRoots");
    expect(script).toContain("rev-parse");
    expect(script).toContain("slice-implementer");
    expect(script).toContain("OLLAMA_WRITE_PROOF.txt");
    expect(script).toContain("agent_team_cleanup");
    expect(script).toContain("StdioClientTransport");
    expect(script).not.toContain("runClaudePrint");
    expect(script).not.toContain("startClaudeBackgroundSession");
    expect(script).not.toContain("requireProviderRuntime");
  });
});
