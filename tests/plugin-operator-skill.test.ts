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
      "Start an L11 agent-team workflow with Codex as orchestrator.",
      "Run agent_team_doctor and prepare direct MCP orchestration."
    ]);
  });

  it("documents direct MCP orchestration as the product path", async () => {
    const skill = await readText(
      "../skills/codex-agent-team-orchestrator/SKILL.md"
    );

    for (const text of [
      "Codex remains the senior engineer, orchestrator, reviewer, integrator, and final authority",
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
      "CEO/product-level",
      "harnesses are regression and live-proof tools only",
      "Do not use dogfood scripts as the orchestration path",
      "retained isolated worktrees",
      "bounded concurrency",
      "partial-failure evidence",
      "no provider ranking"
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
