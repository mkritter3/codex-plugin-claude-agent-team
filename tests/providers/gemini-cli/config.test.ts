import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  GEMINI_CLI_PROVIDER_ID,
  geminiCliProvider
} from "../../../src/providers/gemini-cli/config.js";

function config(input: {
  readonly enabled?: boolean;
  readonly executable?: string;
  readonly model?: string;
  readonly displayName?: string;
  readonly projectEnv?: string;
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
      geminiCli: {
        enabled: input.enabled ?? true,
        executable: input.executable ?? "gemini",
        model: input.model ?? "gemini-3-pro-preview",
        displayName: input.displayName ?? "Gemini CLI",
        projectEnv: input.projectEnv ?? "GOOGLE_CLOUD_PROJECT",
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

describe("Gemini CLI provider config", () => {
  it("is disabled by default and separate from the API-key Gemini adapter", () => {
    expect(geminiCliProvider(DEFAULT_AGENT_TEAM_CONFIG)).toBeUndefined();
    expect(DEFAULT_AGENT_TEAM_CONFIG.providers.gemini.enabled).toBe(false);
  });

  it("builds an OAuth descriptor without API-key env requirements", () => {
    expect(geminiCliProvider(config())).toEqual(
      expect.objectContaining({
        id: GEMINI_CLI_PROVIDER_ID,
        displayName: "Gemini CLI",
        authMode: "oauth",
        model: "gemini-3-pro-preview",
        capabilities: ["structuredOutput", "longContext", "reasoning"],
        available: true
      })
    );
    expect(geminiCliProvider(config())).not.toHaveProperty("apiKeyEnv");
  });

  it("withholds write capabilities until explicitly write validated", () => {
    expect(
      geminiCliProvider(
        config({
          tools: true,
          edits: true,
          sessionResume: true,
          cancellation: true,
          workspaceIsolation: true
        })
      )
    ).toMatchObject({
      id: GEMINI_CLI_PROVIDER_ID,
      available: false,
      warnings: [
        "Gemini CLI provider declares write capabilities without writeValidated."
      ]
    });
  });

  it("advertises autonomous worker capabilities only after write validation", () => {
    expect(
      geminiCliProvider(
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
      id: GEMINI_CLI_PROVIDER_ID,
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

  it("marks incomplete config unavailable while preserving doctor visibility", () => {
    expect(
      geminiCliProvider({
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          geminiCli: {
            enabled: true,
            executable: "",
            projectEnv: "GOOGLE_CLOUD_PROJECT",
            writeValidated: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false,
              tools: false,
              edits: false,
              sessionResume: false,
              cancellation: false,
              workspaceIsolation: false
            }
          }
        }
      })
    ).toMatchObject({
      id: GEMINI_CLI_PROVIDER_ID,
      available: false,
      warnings: [
        "Gemini CLI provider is missing executable.",
        "Gemini CLI provider is missing model.",
        "Gemini CLI provider declares no supported capabilities."
      ]
    });
  });

  it("loads Gemini CLI config without inferring GEMINI_API_KEY fallback", async () => {
    await expect(loadAgentTeamConfig("/tmp/does-not-exist")).resolves.toMatchObject({
      providers: {
        geminiCli: {
          enabled: false,
          executable: "gemini",
          projectEnv: "GOOGLE_CLOUD_PROJECT",
          writeValidated: false
        }
      }
    });
  });
});
