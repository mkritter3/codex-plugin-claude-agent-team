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
    }>("../package.json");
    const mcpJson = await readJson<{
      mcpServers?: Record<string, { command?: string; args?: readonly string[] }>;
    }>("../.mcp.json");
    const buildConfig = await readJson<{
      compilerOptions?: Record<string, unknown>;
      include?: readonly string[];
    }>("../tsconfig.build.json");

    expect(packageJson.bin?.["agent-team-mcp"]).toBe("./dist/index.js");
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
      'assertToolRequires(tools.tools, "agent_team_message", ["runId", "message"])'
    );
    expect(smokeScript).not.toContain("tsx");
    expect(smokeScript).not.toContain(join("src", "index.ts"));
  });
});
