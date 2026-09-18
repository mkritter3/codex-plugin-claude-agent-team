import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  AGY_PROVIDER_ID,
  agyProvider
} from "../../../src/providers/agy/config.js";

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
      agy: {
        enabled: input.enabled ?? true,
        executable: input.executable ?? "agy",
        model: input.model ?? "gemini-3-pro-preview",
        displayName: input.displayName ?? "AGY",
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

describe("AGY provider config", () => {
  it("is auto-enabled by default and separate from the API-key Gemini adapter", () => {
    expect(
      agyProvider(DEFAULT_AGENT_TEAM_CONFIG, { executableAvailable: true })
    ).toMatchObject({
      id: AGY_PROVIDER_ID,
      available: true,
      capabilities: [
        "structuredOutput",
        "longContext",
        "reasoning",
        "sessionResume",
        "cancellation"
      ]
    });
    expect(DEFAULT_AGENT_TEAM_CONFIG.providers.gemini.enabled).toBe(false);
  });

  it("builds an OAuth descriptor without API-key env requirements", () => {
    expect(agyProvider(config())).toEqual(
      expect.objectContaining({
        id: AGY_PROVIDER_ID,
        displayName: "AGY",
        authMode: "oauth",
        model: "gemini-3-pro-preview",
        capabilities: ["structuredOutput", "longContext", "reasoning"],
        available: true
      })
    );
    expect(agyProvider(config())).not.toHaveProperty("apiKeyEnv");
  });

  it("withholds write capabilities until explicitly write validated", () => {
    expect(
      agyProvider(
        config({
          tools: true,
          edits: true,
          sessionResume: true,
          cancellation: true,
          workspaceIsolation: true
        })
      )
    ).toMatchObject({
      id: AGY_PROVIDER_ID,
      available: false,
      warnings: [
        "AGY provider declares write capabilities without writeValidated."
      ]
    });
  });

  it("advertises autonomous worker capabilities only after write validation", () => {
    expect(
      agyProvider(
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
      id: AGY_PROVIDER_ID,
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
      agyProvider({
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          agy: {
            enabled: true,
            executable: "",
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
      id: AGY_PROVIDER_ID,
      available: false,
      warnings: [
        "AGY provider requires an AGY executable.",
        "AGY provider declares no supported capabilities."
      ]
    });
  });

  it("loads auto-enabled AGY config without inferring GEMINI_API_KEY fallback", async () => {
    await expect(loadAgentTeamConfig("/tmp/does-not-exist")).resolves.toMatchObject({
      providers: {
        agy: {
          enabled: true,
          executable: "agy",
          writeValidated: false
        }
      }
    });
  });
});
