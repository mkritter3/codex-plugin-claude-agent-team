import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  GROK_PROVIDER_PREFIX,
  listGrokProviders,
  resolveGrokProfile
} from "../../../src/providers/grok/config.js";

function config(input: {
  readonly enabled?: boolean;
  readonly profiles?: readonly unknown[];
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      grok: {
        enabled: input.enabled ?? true,
        profiles:
          input.profiles ??
          [
            {
              id: "grok-4.20-reasoning",
              baseUrl: "https://api.x.ai/v1",
              model: "grok-4.20",
              apiKeyEnv: "XAI_API_KEY",
              displayName: "Grok 4.20 Reasoning",
              capabilities: { structuredOutput: true, longContext: true, reasoning: true }
            }
          ]
      }
    }
  } as AgentTeamConfig;
}

describe("Grok profile config", () => {
  it("omits profile descriptors when Grok is disabled", () => {
    expect(listGrokProviders(config({ enabled: false }))).toEqual([]);
  });

  it("builds one provider descriptor per configured profile", () => {
    const providers = listGrokProviders(
      config({
        profiles: [
          {
            id: "grok-4.20-reasoning",
            baseUrl: "https://api.x.ai/v1",
            model: "grok-4.20",
            apiKeyEnv: "XAI_API_KEY",
            displayName: "Grok 4.20 Reasoning",
            capabilities: { structuredOutput: true, longContext: true, reasoning: true }
          },
          {
            id: "grok-review",
            baseUrl: "https://api.x.ai/v1",
            model: "grok-review",
            apiKeyEnv: "GROK_API_KEY",
            displayName: "Grok Review",
            capabilities: { structuredOutput: true }
          }
        ]
      })
    );

    expect(providers).toEqual([
      expect.objectContaining({
        id: `${GROK_PROVIDER_PREFIX}:grok-4.20-reasoning`,
        displayName: "Grok 4.20 Reasoning",
        authMode: "api-key",
        model: "grok-4.20",
        capabilities: ["structuredOutput", "longContext", "reasoning"],
        available: true
      }),
      expect.objectContaining({
        id: `${GROK_PROVIDER_PREFIX}:grok-review`,
        displayName: "Grok Review",
        authMode: "api-key",
        model: "grok-review",
        capabilities: ["structuredOutput"],
        available: true
      })
    ]);
  });

  it("marks incomplete profiles unavailable while preserving doctor visibility", () => {
    const [provider] = listGrokProviders(
      config({
        profiles: [
          {
            id: "missing-auth",
            baseUrl: "https://api.x.ai/v1",
            model: "grok-4.20",
            capabilities: { structuredOutput: true }
          }
        ]
      })
    );

    expect(provider).toMatchObject({
      id: `${GROK_PROVIDER_PREFIX}:missing-auth`,
      available: false,
      warnings: ["Grok profile missing-auth is missing apiKeyEnv."]
    });
  });

  it("resolves profile ids from dynamic provider ids", () => {
    const profile = resolveGrokProfile(
      config(),
      `${GROK_PROVIDER_PREFIX}:grok-4.20-reasoning`
    );

    expect(profile).toMatchObject({
      id: "grok-4.20-reasoning",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.20",
      apiKeyEnv: "XAI_API_KEY"
    });
  });
});
