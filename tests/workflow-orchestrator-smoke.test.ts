import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path: string): Promise<string> {
  return readFile(join(repoRoot, path), "utf8");
}

describe("workflow orchestrator packaged smoke script", () => {
  it("uses the packaged MCP boundary and public workflow tools", async () => {
    const script = await readText("scripts/smoke-workflow-orchestrator.mjs");

    expect(script).toContain("@modelcontextprotocol/sdk/client/index.js");
    expect(script).toContain("@modelcontextprotocol/sdk/client/stdio.js");
    expect(script).toContain('join(repoRoot, "dist", "index.js")');
    expect(script).toContain("StdioClientTransport");
    expect(script).toContain("mkdtemp");
    expect(script).toContain("agent-team-workflow-smoke-");
    expect(script).toContain("rm(fixtureRoot");
    for (const toolName of [
      "agent_team_doctor",
      "agent_team_create_workflow",
      "agent_team_get_workflow",
      "agent_team_plan_consensus",
      "agent_team_unblock_slice",
      "agent_team_review_slice",
      "agent_team_integration_queue",
      "agent_team_record_integration",
      "agent_team_workflow_report",
      "agent_team_list_workflows"
    ]) {
      expect(script).toContain(toolName);
    }
    expect(script).not.toContain("agent_team_start_slices");
    expect(script).not.toContain("agent_team_dispatch");
    expect(script).not.toContain("agent_team_start");
  });

  it("asserts workflow state gates without leaking private provider details", async () => {
    const script = await readText("scripts/smoke-workflow-orchestrator.mjs");

    for (const text of [
      "completionStatus",
      "complete",
      "ready-to-integrate",
      "missing-evidence",
      "degraded",
      "required-when-available",
      "fixtureCleaned",
      "sanitizedReport",
      "passing final gate evidence"
    ]) {
      expect(script).toContain(text);
    }
    expect(script).not.toMatch(
      /internal prompt|hidden instruction|raw provider payload|provider session id|process\.pid|command args|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OLLAMA_API_KEY|quality score|model-quality comparison|provider ranking claim|api-key fallback/i
    );
  });
});
