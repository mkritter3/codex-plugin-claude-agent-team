import { describe, expect, it } from "vitest";
import { AgentTeamConfigError, DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  CLAUDE_CODE_CLI_PROVIDER_PREFIX,
  claudeCodeCliProfileProviderId,
  listClaudeCodeCliProfileProviders,
  resolveClaudeCodeCliProfile
} from "../../../src/providers/claude-code-cli/config.js";

function config(input: {
  readonly profiles?: readonly unknown[];
  readonly writeMode?: AgentTeamConfig["writeMode"];
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    writeMode: input.writeMode ?? DEFAULT_AGENT_TEAM_CONFIG.writeMode,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      claudeCodeCli: {
        profiles:
          input.profiles ??
          [
            {
              id: "opus",
              model: "opus",
              displayName: "Claude Opus",
              capabilities: { structuredOutput: true, longContext: true, reasoning: true }
            }
          ]
      }
    }
  } as AgentTeamConfig;
}

describe("Claude Code CLI model profile config", () => {
  it("exposes Opus as a default read-only senior review profile", () => {
    const providers = listClaudeCodeCliProfileProviders(DEFAULT_AGENT_TEAM_CONFIG);

    expect(providers).toEqual([
      expect.objectContaining({
        id: "claude-code-cli:opus",
        displayName: "Claude Opus - planning and senior review",
        authMode: "subscription-oauth",
        model: "opus",
        capabilities: [
          "structuredOutput",
          "longContext",
          "tools",
          "sessionResume",
          "cancellation",
          "reasoning"
        ],
        available: true
      })
    ]);
    expect(providers[0]?.capabilities).not.toContain("edits");
    expect(providers[0]?.capabilities).not.toContain("workspaceIsolation");
  });

  it("builds subscription OAuth provider descriptors for alias profiles", () => {
    const providers = listClaudeCodeCliProfileProviders(
      config({
        profiles: [
          {
            id: "opus",
            model: "opus",
            displayName: "Claude Opus",
            capabilities: { structuredOutput: true, longContext: true, reasoning: true }
          },
          {
            id: "haiku",
            model: "haiku",
            displayName: "Claude Haiku",
            capabilities: { structuredOutput: true }
          }
        ]
      })
    );

    expect(providers).toEqual([
      expect.objectContaining({
        id: `${CLAUDE_CODE_CLI_PROVIDER_PREFIX}:opus`,
        displayName: "Claude Opus",
        authMode: "subscription-oauth",
        model: "opus",
        capabilities: [
          "structuredOutput",
          "longContext",
          "tools",
          "sessionResume",
          "cancellation",
          "reasoning"
        ],
        available: true
      }),
      expect.objectContaining({
        id: `${CLAUDE_CODE_CLI_PROVIDER_PREFIX}:haiku`,
        displayName: "Claude Haiku",
        authMode: "subscription-oauth",
        model: "haiku",
        capabilities: ["structuredOutput", "tools", "sessionResume", "cancellation"],
        available: true
      })
    ]);
  });

  it("keeps write capabilities disabled until a profile is explicitly write validated", () => {
    const [readOnly, writeValidated] = listClaudeCodeCliProfileProviders(
      config({
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        profiles: [
          {
            id: "sonnet",
            model: "sonnet",
            capabilities: { structuredOutput: true, edits: true, workspaceIsolation: true }
          },
          {
            id: "sonnet-write",
            model: "sonnet",
            writeValidated: true,
            capabilities: { structuredOutput: true, edits: true, workspaceIsolation: true }
          }
        ]
      })
    );

    expect(readOnly?.capabilities).not.toContain("edits");
    expect(readOnly?.capabilities).not.toContain("workspaceIsolation");
    expect(readOnly?.warnings).toContain(
      "Claude Code CLI profile sonnet declares write capabilities without writeValidated."
    );
    expect(writeValidated?.capabilities).toEqual(
      expect.arrayContaining(["edits", "workspaceIsolation"])
    );
  });

  it("resolves profile ids from dynamic provider ids", () => {
    const profile = resolveClaudeCodeCliProfile(
      config(),
      claudeCodeCliProfileProviderId("opus")
    );

    expect(profile).toMatchObject({
      id: "opus",
      model: "opus"
    });
  });

  it("rejects duplicate profile ids", () => {
    expect(() =>
      listClaudeCodeCliProfileProviders(
        config({
          profiles: [{ id: "opus" }, { id: "opus" }]
        })
      )
    ).toThrow(AgentTeamConfigError);
  });
});
