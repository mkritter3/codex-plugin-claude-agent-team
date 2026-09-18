import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readText = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readText(path)) as T;

describe("Codex operator skill packaging", () => {
  it("ships a Codex-facing operator skill through the plugin manifest and package", async () => {
    const pluginJson = await readJson<{
      skills?: string;
      interface?: { defaultPrompt?: readonly string[] };
    }>("../.codex-plugin/plugin.json");
    const packageJson = await readJson<{ files?: readonly string[] }>("../package.json");
    const packageSmoke = await readText("../scripts/smoke-package.mjs");

    expect(pluginJson.skills).toBe("./skills/");
    expect(packageJson.files).toContain("skills");
    expect(packageSmoke).toContain(
      '"skills/codex-agent-team-orchestrator/SKILL.md"'
    );
    expect(pluginJson.interface?.defaultPrompt).toEqual([
      "Use Agent Team to plan, delegate, review, and integrate this feature.",
      "Choose economical implementation models and independent reviewers for this task.",
      "Have a panel of my selected models agree on a plan and review the finished work."
    ]);
  });

  it("documents direct MCP orchestration as the product path", async () => {
    const skill = await readText(
      "../skills/codex-agent-team-orchestrator/SKILL.md"
    );

    for (const text of [
      "agent_team_configure_orchestration",
      "agent_team_prepare_assignments",
      "agent_team_record_native_implementation",
      "direct MCP orchestration",
      "agent_team_doctor",
      "agent_team_create_workflow",
      "agent_team_plan_consensus",
      "agent_team_start_slices",
      "agent_team_status_many",
      "agent_team_message_many",
      "agent_team_unblock_slice",
      "agent_team_review_slice",
      "agent_team_integration_queue",
      "agent_team_record_integration",
      "agent_team_workflow_report",
      "agent_team_cleanup",
      "allowedRoles",
      "allowedProviderSelectors",
      "allowWriteMode",
      "allowedWorktreeRoots",
      "policy.liveSmokeEnabled",
      "live-smoke harnesses",
      "normal direct MCP starts",
      "runId",
      "sidecarPath",
      "logPath",
      "transcriptPath",
      "mailboxPaths",
      "recorded_for_resume",
      "workflow report",
      "final integration evidence",
      "CEO/product-level",
      "harnesses are regression and live-proof tools only",
      "Do not use dogfood scripts as the orchestration path",
      "retained isolated worktrees",
      "bounded concurrency",
      "partial-failure evidence",
      "no provider ranking",
      "mcp-runtime",
      "workflowWriteScopeAllowsEmpty",
      "stale Agent Team MCP server processes",
      "launchMode: \"ollama-launch\"",
      "does not require `OLLAMA_API_KEY`",
      "launchMode: \"direct-api\"",
      "ollama-claude-code:glm-5.2",
      "ollama-claude-code:kimi-k2.7-code",
      "/reload-plugins",
      "tool_search",
      "Transport closed",
      "source repo",
      "installed cache",
      "native subagents are a supported execution route",
      "claude-code-cli:opus",
      "default read-only senior review profile",
      "omitting `providers.claudeCodeCli.profiles` inherits",
      "`profiles: []` intentionally disables"
    ]) {
      expect(skill).toContain(text);
    }

    expect(skill).not.toMatch(/ANTHROPIC_API_KEY\s*=/);
    expect(skill).not.toMatch(/OLLAMA_API_KEY\s*=/);
    expect(skill).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(skill).not.toMatch(/OPENAI_API_KEY\s*=/);
    expect(skill).not.toMatch(/internal prompt/i);
    expect(skill).not.toMatch(/raw provider payload/i);
    expect(skill).not.toMatch(/model-quality comparison/i);
  });
});
