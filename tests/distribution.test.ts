import { readFile, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const readText = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const exec = promisify(execFile);

async function verifyFixture(marketplace?: unknown, requireLocal = false): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "agent-team-distribution-"));
  const root = join(base, marketplace === undefined ? "any-checkout-name" : "codex-plugin-claude-agent-team");
  try {
    for (const file of ["package.json", "package-lock.json", "npm-shrinkwrap.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", ".mcp.json", "README.md", "src/version.ts", "scripts/verify-distribution.mjs"]) {
      const destination = join(root, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(new URL(`../${file}`, import.meta.url), destination);
    }
    if (marketplace !== undefined) {
      await mkdir(join(base, ".agents/plugins"), { recursive: true });
      await writeFile(join(base, ".agents/plugins/marketplace.json"), JSON.stringify(marketplace));
    }
    return (await exec(process.execPath, [join(root, "scripts/verify-distribution.mjs"), ...(requireLocal ? ["--require-local-marketplace"] : [])])).stdout;
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

describe("native Codex plugin distribution", () => {
  it("verifies a standalone checkout without a personal marketplace or fixed folder name", async () => {
    await expect(verifyFixture()).resolves.toContain("Distribution verification passed");
  });

  it("validates an available local marketplace and rejects a broken entry", async () => {
    const entry = {
      name: "codex-plugin-claude-agent-team",
      source: {
        source: "local",
        path: "./codex-plugin-claude-agent-team"
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL"
      },
      category: "Productivity"
    };
    await expect(verifyFixture({ name: "local-plugins", plugins: [entry] }, true)).resolves.toContain("Distribution verification passed");
    await expect(verifyFixture({ name: "local-plugins", plugins: [] }, true)).rejects.toThrow(/marketplace/);
  });

  it("fails closed when local marketplace verification is explicitly required", async () => {
    await expect(verifyFixture(undefined, true)).rejects.toThrow(/marketplace/);
  });

  it("gates release readiness with a native distribution verifier", async () => {
    const packageJson = JSON.parse(await readText("../package.json")) as {
      scripts?: Record<string, string>;
    };
    const packageLock = JSON.parse(await readText("../package-lock.json"));
    const shrinkwrap = JSON.parse(await readText("../npm-shrinkwrap.json"));

    expect(packageJson.scripts?.["verify:distribution"]).toBe(
      "node scripts/verify-distribution.mjs"
    );
    expect(packageJson.scripts?.ci).toContain("npm run verify:distribution");
    expect(packageJson.scripts?.ci).not.toContain("codex mcp add");
    expect(packageLock).toEqual(shrinkwrap);

    const verifier = await readText("../scripts/verify-distribution.mjs");
    expect(verifier).toContain("../.agents/plugins/marketplace.json");
    expect(verifier).toContain("codex-plugin-claude-agent-team");
    expect(verifier).toContain("package-lock.json and npm-shrinkwrap.json must match");
    expect(verifier).toContain("./codex-plugin-claude-agent-team");
    expect(verifier).toContain("startup_timeout_sec");
    expect(verifier).toContain("agent_team_doctor");
    expect(verifier).not.toContain("ANTHROPIC_API_KEY");
    expect(verifier).not.toContain("OLLAMA_API_KEY");
  });

  it("documents the minimal native install and reload path", async () => {
    const readme = await readText("../README.md");

    for (const text of [
      "Native Codex Install",
      "Install `codex-plugin-claude-agent-team` from the `local-plugins` marketplace",
      "/reload-plugins",
      "agent_team_doctor",
      "agent_team_list_providers",
      "Do not run `codex mcp add`",
      "the plugin ships its MCP server through `.codex-plugin/plugin.json` and `.mcp.json`",
      "npm run verify:distribution"
    ]) {
      expect(readme).toContain(text);
    }
  });

  it("preserves the package version under a local Codex cachebuster", async () => {
    const packageJson = JSON.parse(await readText("../package.json")) as {
      version?: string;
    };
    const codexPlugin = JSON.parse(await readText("../.codex-plugin/plugin.json")) as {
      version?: string;
    };
    const sourceVersion = await readText("../src/version.ts");

    expect(packageJson.version).toBe("0.1.5");
    expect(codexPlugin.version?.replace(/\+codex\.[A-Za-z0-9.-]+$/, "")).toBe(packageJson.version);
    expect(sourceVersion).toContain('"0.1.5"');
  });
});
