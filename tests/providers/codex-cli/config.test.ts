import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  CODEX_CLI_PROVIDER_ID,
  codexCliProvider
} from "../../../src/providers/codex-cli/config.js";

function config(input: {
  readonly enabled?: boolean;
  readonly executable?: string;
  readonly model?: string;
  readonly displayName?: string;
  readonly structuredOutput?: boolean;
  readonly longContext?: boolean;
  readonly reasoning?: boolean;
  readonly tools?: boolean;
  readonly edits?: boolean;
  readonly sessionResume?: boolean;
  readonly cancellation?: boolean;
  readonly workspaceIsolation?: boolean;
  readonly writeValidated?: boolean;
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      codexCli: {
        enabled: input.enabled ?? true,
        executable: input.executable ?? "codex",
        model: input.model ?? "gpt-5.5",
        displayName: input.displayName ?? "Codex CLI",
        writeValidated: input.writeValidated ?? false,
        capabilities: {
          structuredOutput: input.structuredOutput ?? true,
          longContext: input.longContext ?? true,
          reasoning: input.reasoning ?? true,
          tools: input.tools ?? false,
          edits: input.edits ?? false,
          sessionResume: input.sessionResume ?? false,
          cancellation: input.cancellation ?? false,
          workspaceIsolation: input.workspaceIsolation ?? false
        }
      }
    }
  } as AgentTeamConfig;
}

describe("Codex CLI provider config", () => {
  it("is disabled by default and does not affect Codex as the orchestrator", () => {
    expect(codexCliProvider(DEFAULT_AGENT_TEAM_CONFIG)).toBeUndefined();
  });

  it("builds a subscription OAuth descriptor without API-key env requirements", () => {
    expect(codexCliProvider(config())).toEqual(
      expect.objectContaining({
        id: CODEX_CLI_PROVIDER_ID,
        displayName: "Codex CLI",
        authMode: "subscription-oauth",
        model: "gpt-5.5",
        capabilities: ["structuredOutput", "longContext", "reasoning"],
        available: true
      })
    );
    expect(codexCliProvider(config())).not.toHaveProperty("apiKeyEnv");
  });

  it("withholds autonomous worker capabilities until explicitly write validated", () => {
    expect(
      codexCliProvider(
        config({
          tools: true,
          edits: true,
          sessionResume: true,
          cancellation: true,
          workspaceIsolation: true
        })
      )
    ).toMatchObject({
      id: CODEX_CLI_PROVIDER_ID,
      available: false,
      warnings: ["Codex CLI provider declares write capabilities without writeValidated."]
    });
  });

  it("advertises autonomous worker capabilities only after write validation", () => {
    expect(
      codexCliProvider(
        config({
          writeValidated: true,
          tools: true,
          edits: true,
          sessionResume: true,
          cancellation: true,
          workspaceIsolation: true
        })
      )
    ).toMatchObject({
      id: CODEX_CLI_PROVIDER_ID,
      available: true,
      capabilities: [
        "structuredOutput",
        "longContext",
        "reasoning",
        "tools",
        "sessionResume",
        "cancellation",
        "edits",
        "workspaceIsolation"
      ]
    });
  });

  it("loads Codex CLI config without inferring OpenAI API-key fallback", async () => {
    await expect(loadAgentTeamConfig("/tmp/does-not-exist")).resolves.toMatchObject({
      providers: {
        codexCli: {
          enabled: false,
          executable: "codex",
          writeValidated: false
        }
      }
    });
  });
});
