import { readFile } from "node:fs/promises";
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
});
