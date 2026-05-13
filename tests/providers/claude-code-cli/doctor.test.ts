import { describe, expect, it } from "vitest";
import {
  checkClaudeAgentDefinitions,
  inspectClaudeEnvironment
} from "../../../src/providers/claude-code-cli/doctor.js";

describe("inspectClaudeEnvironment", () => {
  it("warns when API-key variables may override subscription OAuth", () => {
    const report = inspectClaudeEnvironment({
      authMode: "subscription-oauth",
      env: {
        ANTHROPIC_API_KEY: "secret",
        ANTHROPIC_AUTH_TOKEN: "token",
        CLAUDE_CODE_OAUTH_TOKEN: "oauth-token"
      }
    });

    expect(report.warnings).toContain(
      "ANTHROPIC_API_KEY is set and may override Claude Code subscription OAuth."
    );
    expect(report.warnings).toContain(
      "ANTHROPIC_AUTH_TOKEN is set and may override Claude Code subscription OAuth."
    );
    expect(report.warnings).toContain(
      "CLAUDE_CODE_OAUTH_TOKEN is set and may override Claude Code subscription OAuth."
    );
  });

  it("does not warn about API-key variables outside subscription mode", () => {
    const report = inspectClaudeEnvironment({
      authMode: "api-key",
      env: { ANTHROPIC_API_KEY: "secret" }
    });

    expect(report.warnings).toEqual([]);
  });

  it("passes generated Claude agent definition validation", () => {
    expect(checkClaudeAgentDefinitions()).toMatchObject({
      id: "claude-agent-definitions",
      status: "pass",
      details: { count: 17 }
    });
  });
});
