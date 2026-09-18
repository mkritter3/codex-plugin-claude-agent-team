import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("live dogfood agent team app script", () => {
  it("fails closed unless live provider use is explicitly confirmed or dry-run is requested", () => {
    const result = spawnSync("node", ["scripts/live-dogfood-agent-team-app.mjs"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--confirm-live-provider-use");
    expect(result.stderr).toContain("--dry-run");
  });

  it("prints a sanitized dry-run app workflow plan without connecting to MCP", () => {
    const result = spawnSync("node", ["scripts/live-dogfood-agent-team-app.mjs", "--dry-run"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      status?: string;
      liveProviderUse?: boolean;
      claimBoundary?: string;
      providerSelectors?: readonly string[];
      toolFlow?: readonly string[];
      plannedSlices?: Array<{ sliceId?: string; providerSelector?: string; ownerRole?: string }>;
      plannedOptionalProviderProofs?: Array<{
        sliceId?: string;
        providerSelector?: string;
        ownerRole?: string;
        enabledBy?: string;
      }>;
    };

    expect(report).toMatchObject({
      status: "dry_run",
      liveProviderUse: false,
      claimBoundary: "dogfood_app_workflow_only"
    });
    expect(report.providerSelectors).toEqual([
      "claude-code-cli:opus",
      "gemini-cli",
      "codex-cli",
      "ollama-claude-code:glm-5.2"
    ]);
    expect(report.toolFlow).toEqual([
      "agent_team_doctor",
      "agent_team_create_workflow",
      "agent_team_plan_consensus",
      "agent_team_workflow_next",
      "agent_team_record_user_decision",
      "agent_team_start",
      "agent_team_start_slices",
      "agent_team_status_many",
      "agent_team_review_slice",
      "agent_team_integration_queue",
      "agent_team_record_integration",
      "agent_team_workflow_report",
      "agent_team_dashboard",
      "agent_team_summary",
      "agent_team_cleanup"
    ]);
    expect(report.plannedSlices).toEqual([
      {
        sliceId: "slice_ui",
        ownerRole: "frontend-engineer",
        providerSelector: "gemini-cli"
      },
      {
        sliceId: "slice_logic_tests",
        ownerRole: "slice-implementer",
        providerSelector: "codex-cli"
      },
    ]);
    expect(report.plannedOptionalProviderProofs).toEqual([
      {
        sliceId: "slice_junior_docs",
        ownerRole: "slice-implementer",
        providerSelector: "ollama-claude-code:glm-5.2",
        enabledBy: "--include-optional-ollama"
      }
    ]);
    expect(result.stdout).not.toMatch(
      /internal prompt|prompt|task|raw provider payload|providerSessionId|provider session id|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|GEMINI_API_KEY|OPENAI_API_KEY|OLLAMA_API_KEY|quality score|provider ranking|best model/i
    );
  });

  it("is registered as an opt-in script outside CI", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["dogfood:live-app"]).toBe(
      "node scripts/live-dogfood-agent-team-app.mjs"
    );
    expect(packageJson.scripts?.ci).not.toContain("dogfood:live-app");
  });

  it("uses packaged MCP workflow tools, isolated app fixtures, review evidence, and cleanup", async () => {
    const script = await readText("scripts/live-dogfood-agent-team-app.mjs");

    for (const text of [
      "@modelcontextprotocol/sdk/client/index.js",
      "@modelcontextprotocol/sdk/client/stdio.js",
      'join(repoRoot, "dist", "index.js")',
      "buildToolRequestOptions",
      "agent_team_create_workflow",
      "agent_team_plan_consensus",
      "agent_team_workflow_next",
      "agent_team_record_user_decision",
      "agent_team_start",
      "agent_team_start_slices",
      "agent_team_status_many",
      "agent_team_review_slice",
      "agent_team_integration_queue",
      "agent_team_record_integration",
      "agent_team_workflow_report",
      "agent_team_cleanup",
      "requireIsolatedWorktree",
      "allowedWorktreeRoots",
      "writeValidated: true",
      "claude-code-cli:opus",
      "gemini-cli",
      "codex-cli",
      "ollama-claude-code:glm-5.2",
      'baseUrl: "http://localhost:11434"',
      'launchMode: "ollama-launch"',
      "dogfood_app_workflow_only",
      "optionalOllamaEnabled",
      "--include-optional-ollama",
      "npm test",
      "copyApprovedFiles"
    ]) {
      expect(script).toContain(text);
    }

    expect(script).not.toContain("runClaudePrint");
    expect(script).not.toContain("startClaudeBackgroundSession");
    expect(script).not.toContain("https://ollama.com/anthropic");
    expect(script).not.toContain("--yolo");
  });
});
