import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readText = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("package smoke gate", () => {
  it("declares an npm pack dry-run smoke script for the installable runtime", async () => {
    const packageJson = JSON.parse(await readText("../package.json")) as {
      bin?: Record<string, string>;
      files?: readonly string[];
      scripts?: Record<string, string>;
    };
    const smokeScript = await readText("../scripts/smoke-package.mjs");

    expect(packageJson.bin?.["agent-team-mcp"]).toBe("./dist/index.js");
    expect(packageJson.files).toEqual([
      "dist",
      ".codex-plugin",
      ".mcp.json",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
      "docs/releases",
      "docs/runbooks",
      "scripts"
    ]);
    expect(packageJson.scripts?.["smoke:package"]).toBe(
      "node scripts/smoke-package.mjs"
    );
    expect(smokeScript).toContain('"pack", "--dry-run", "--json"');
    expect(smokeScript).toContain('"agent-team-mcp"');
    expect(smokeScript).toContain('"./dist/index.js"');
    expect(smokeScript).toContain('".mcp.json"');
    expect(smokeScript).toContain('".codex-plugin/plugin.json"');
    expect(smokeScript).toContain('"README.md"');
    expect(smokeScript).toContain('"CHANGELOG.md"');
    expect(smokeScript).toContain('"LICENSE"');
    expect(smokeScript).toContain('"docs/runbooks/claude-team-session.md"');
    expect(smokeScript).toContain('"scripts/install-check.mjs"');
    expect(smokeScript).toContain('"scripts/lib/install-preflight.mjs"');
    expect(smokeScript).toContain('"scripts/live-smoke-claude-team.mjs"');
    expect(smokeScript).toContain("mkdtempSync");
    expect(smokeScript).toContain("npm_config_cache");
    expect(smokeScript).toContain("rmSync");
    expect(smokeScript).not.toContain("tsx");
    expect(smokeScript).not.toContain("src/index.ts");
  });
});
