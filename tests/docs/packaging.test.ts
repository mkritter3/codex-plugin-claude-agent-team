import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readText = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("packaging and install docs", () => {
  it("keeps README sufficient for local installation and operation", async () => {
    const readme = await readText("../../README.md");

    for (const text of [
      "Prerequisites",
      "Node.js 22",
      "Claude Code CLI subscription OAuth",
      "npm ci",
      "npm run build",
      "agent-team-mcp",
      "\"./dist/index.js\"",
      ".agent-team/config.json",
      "agent_team_doctor",
      "agent_team_start_parallel",
      "agent_team_create_team",
      "agent_team_get_team",
      "agent_team_dashboard",
      "agent_team_summary",
      "agent_team_cleanup",
      "npm run ci",
      "Troubleshooting",
      "docs/runbooks/claude-team-session.md"
    ]) {
      expect(readme).toContain(text);
    }
    expect(readme).toContain("opt-in live smoke");
    expect(readme).toContain("not part of CI");
    expect(readme).toContain("read-only dashboard");
  });

  it("documents versioning and changelog policy", async () => {
    const changelog = await readText("../../CHANGELOG.md");

    expect(changelog).toContain("# Changelog");
    expect(changelog).toContain("0.1.0");
    expect(changelog).toContain("Versioning Policy");
    expect(changelog).toContain("MCP tool surface changes");
    expect(changelog).toContain("npm run ci");
  });

  it("ships the declared MIT license text", async () => {
    const license = await readText("../../LICENSE");

    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright");
    expect(license).toContain("Permission is hereby granted");
  });

  it("keeps docs free of private implementation leakage and unsafe onboarding paths", async () => {
    const combined = `${await readText("../../README.md")}\n${await readText("../../CHANGELOG.md")}`;
    const forbiddenAuthPattern = new RegExp(
      [
        "ANTHROPIC" + "_API_KEY=.*",
        "ANTHROPIC" + "_AUTH_TOKEN=.*",
        "api[- ]key " + "fallback"
      ].join("|"),
      "i"
    );
    const forbiddenPrivatePattern = new RegExp(
      [
        "internal " + "prompt",
        "hidden " + "instruction",
        "generated " + "agent definition",
        "bypass" + "Permissions",
        "process " + "id"
      ].join("|"),
      "i"
    );
    const forbiddenClaimPattern = new RegExp(
      ["bench" + "mark", "quality " + "score", "model-quality " + "comparison"].join("|"),
      "i"
    );

    expect(combined).not.toMatch(forbiddenAuthPattern);
    expect(combined).not.toMatch(forbiddenPrivatePattern);
    expect(combined).not.toMatch(forbiddenClaimPattern);
  });
});
