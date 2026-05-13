import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")) as T;
}

describe("package runtime contract", () => {
  it("aligns package bin and MCP config with the emitted runtime entrypoint", async () => {
    const packageJson = await readJson<{
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
      codexPlugin?: string;
    }>("../package.json");
    const mcpJson = await readJson<{
      mcpServers?: Record<string, { command?: string; args?: readonly string[] }>;
    }>("../.mcp.json");
    const buildConfig = await readJson<{
      compilerOptions?: Record<string, unknown>;
      include?: readonly string[];
    }>("../tsconfig.build.json");

    expect(packageJson.bin?.["agent-team-mcp"]).toBe("./dist/index.js");
    expect(packageJson.codexPlugin).toBe(".codex-plugin/plugin.json");
    expect(packageJson.scripts?.build).toBe("tsc -p tsconfig.build.json");
    expect(packageJson.scripts?.["smoke:mcp-stdio"]).toBe(
      "node scripts/smoke-mcp-stdio.mjs"
    );
    expect(mcpJson.mcpServers?.["agent-team"]).toEqual({
      command: "node",
      args: ["./dist/index.js"]
    });
    expect(buildConfig.compilerOptions).toMatchObject({
      rootDir: "src",
      outDir: "dist"
    });
    expect(buildConfig.include).toEqual(["src/**/*.ts"]);
  });

  it("aligns package metadata with the Codex plugin manifest", async () => {
    const packageJson = await readJson<{
      name?: string;
      version?: string;
      homepage?: string;
      repository?: { type?: string; url?: string };
      license?: string;
      keywords?: readonly string[];
      bin?: Record<string, string>;
      codexPlugin?: string;
    }>("../package.json");
    const pluginJson = await readJson<{
      name?: string;
      version?: string;
      homepage?: string;
      repository?: string;
      license?: string;
      mcpServers?: string;
      interface?: {
        defaultPrompt?: readonly string[];
      };
    }>("../.codex-plugin/plugin.json");
    const mcpJson = await readJson<{
      mcpServers?: Record<string, { command?: string; args?: readonly string[] }>;
    }>("../.mcp.json");

    expect(packageJson.name).toBe(pluginJson.name);
    expect(packageJson.version).toBe(pluginJson.version);
    expect(packageJson.homepage).toBe(pluginJson.homepage);
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/mkritter3/codex-plugin-claude-agent-team.git"
    });
    expect(pluginJson.repository).toBe(
      "https://github.com/mkritter3/codex-plugin-claude-agent-team"
    );
    expect(packageJson.license).toBe(pluginJson.license);
    expect(packageJson.keywords).toEqual(["codex", "mcp", "agents", "claude-code"]);
    expect(packageJson.codexPlugin).toBe(".codex-plugin/plugin.json");
    expect(pluginJson.mcpServers).toBe("./.mcp.json");
    expect(pluginJson.interface?.defaultPrompt).toBeDefined();
    expect(pluginJson.interface?.defaultPrompt?.length).toBeLessThanOrEqual(3);
    for (const prompt of pluginJson.interface?.defaultPrompt ?? []) {
      expect(prompt.length).toBeLessThanOrEqual(128);
    }
    expect(packageJson.bin?.["agent-team-mcp"]).toBe("./dist/index.js");
    expect(mcpJson.mcpServers?.["agent-team"]).toEqual({
      command: "node",
      args: ["./dist/index.js"]
    });
  });

  it("keeps packaged stdio smoke pointed at the built MCP entrypoint", async () => {
    const smokeScript = await readFile(
      new URL("../scripts/smoke-mcp-stdio.mjs", import.meta.url),
      "utf8"
    );

    expect(smokeScript).toContain('join(repoRoot, "dist", "index.js")');
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_dispatch", ["role", "task"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_start_parallel", ["runs"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_status_many", ["runs"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_summary", ["runs"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_create_team", ["runs"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_get_team", ["teamId"])'
    );
    expect(smokeScript).toContain(
      'assertObjectSchema(tools.tools, "agent_team_list_teams")'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_create_workflow", ["goal", "slices"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_get_workflow", ["workflowId"])'
    );
    expect(smokeScript).toContain(
      'assertObjectSchema(tools.tools, "agent_team_list_workflows")'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_plan_consensus", ['
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_start_slices", ["workflowId"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_unblock_slice", ['
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_review_slice", ['
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_integration_queue", ["workflowId"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_record_integration", ['
    );
    expect(smokeScript).toContain(
      'assertObjectSchema(tools.tools, "agent_team_dashboard")'
    );
    expect(smokeScript).toContain(
      'assertValidationError(client, "agent_team_dashboard", {})'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_cancel_many", ["runs"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_wind_down_many", ["runs"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_message", ["runId", "message"])'
    );
    expect(smokeScript).toContain(
      'assertToolRequires(tools.tools, "agent_team_message_many", ["messages"])'
    );
    expect(smokeScript).not.toContain("tsx");
    expect(smokeScript).not.toContain(join("src", "index.ts"));
  });
});
