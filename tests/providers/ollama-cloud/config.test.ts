import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  OLLAMA_CLOUD_PROVIDER_PREFIX,
  listOllamaCloudProviders,
  resolveOllamaCloudProfile
} from "../../../src/providers/ollama-cloud/config.js";

function config(input: {
  readonly enabled?: boolean;
  readonly profiles?: readonly unknown[];
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      ollamaCloud: {
        enabled: input.enabled ?? true,
        profiles:
          input.profiles ??
          [
            {
              id: "kimi-k2.6",
              baseUrl: "https://ollama.example/v1",
              model: "kimi-k2.6",
              apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
              displayName: "Kimi K2.6",
              capabilities: { structuredOutput: true, longContext: true }
            }
          ]
      }
    }
  } as AgentTeamConfig;
}

describe("Ollama Cloud profile config", () => {
  it("omits profile descriptors when Ollama Cloud is disabled", () => {
    expect(listOllamaCloudProviders(config({ enabled: false }))).toEqual([]);
  });

  it("builds one provider descriptor per configured profile", () => {
    const providers = listOllamaCloudProviders(
      config({
        profiles: [
          {
            id: "kimi-k2.6",
            baseUrl: "https://ollama.example/v1",
            model: "kimi-k2.6",
            apiKeyEnv: "KIMI_API_KEY",
            displayName: "Kimi K2.6",
            capabilities: { structuredOutput: true, longContext: true }
          },
          {
            id: "glm-5.1",
            baseUrl: "https://ollama.example/v1",
            model: "glm-5.1",
            apiKeyEnv: "GLM_API_KEY",
            displayName: "GLM 5.1",
            capabilities: { structuredOutput: true }
          }
        ]
      })
    );

    expect(providers).toEqual([
      expect.objectContaining({
        id: `${OLLAMA_CLOUD_PROVIDER_PREFIX}:kimi-k2.6`,
        displayName: "Kimi K2.6",
        authMode: "api-key",
        model: "kimi-k2.6",
        capabilities: ["structuredOutput", "longContext"],
        available: true
      }),
      expect.objectContaining({
        id: `${OLLAMA_CLOUD_PROVIDER_PREFIX}:glm-5.1`,
        displayName: "GLM 5.1",
        authMode: "api-key",
        model: "glm-5.1",
        capabilities: ["structuredOutput"],
        available: true
      })
    ]);
  });

  it("marks incomplete profiles unavailable while preserving doctor visibility", () => {
    const [provider] = listOllamaCloudProviders(
      config({
        profiles: [
          {
            id: "missing-auth",
            baseUrl: "https://ollama.example/v1",
            model: "kimi-k2.6",
            capabilities: { structuredOutput: true }
          }
        ]
      })
    );

    expect(provider).toMatchObject({
      id: `${OLLAMA_CLOUD_PROVIDER_PREFIX}:missing-auth`,
      available: false,
      warnings: ["Ollama Cloud profile missing-auth is missing apiKeyEnv."]
    });
  });

  it("resolves profile ids from dynamic provider ids", () => {
    const profile = resolveOllamaCloudProfile(
      config(),
      `${OLLAMA_CLOUD_PROVIDER_PREFIX}:kimi-k2.6`
    );

    expect(profile).toMatchObject({
      id: "kimi-k2.6",
      baseUrl: "https://ollama.example/v1",
      model: "kimi-k2.6",
      apiKeyEnv: "OLLAMA_CLOUD_API_KEY"
    });
  });
});
