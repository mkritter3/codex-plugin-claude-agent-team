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
              id: "kimi-k2.7-code",
              baseUrl: "https://ollama.example/v1",
              model: "kimi-k2.7-code",
              apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
              displayName: "Kimi K2.7 Code",
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
            id: "kimi-k2.7-code",
            baseUrl: "https://ollama.example/v1",
            model: "kimi-k2.7-code",
            apiKeyEnv: "KIMI_API_KEY",
            displayName: "Kimi K2.7 Code",
            capabilities: { structuredOutput: true, longContext: true }
          },
          {
            id: "glm-5.2",
            baseUrl: "https://ollama.example/v1",
            model: "glm-5.2",
            apiKeyEnv: "GLM_API_KEY",
            displayName: "GLM 5.2",
            capabilities: { structuredOutput: true }
          }
        ]
      }),
      { env: { KIMI_API_KEY: "token", GLM_API_KEY: "token" } }
    );

    expect(providers).toEqual([
      expect.objectContaining({
        id: `${OLLAMA_CLOUD_PROVIDER_PREFIX}:kimi-k2.7-code`,
        displayName: "Kimi K2.7 Code",
        authMode: "api-key",
        model: "kimi-k2.7-code",
        capabilities: ["structuredOutput", "longContext"],
        available: true
      }),
      expect.objectContaining({
        id: `${OLLAMA_CLOUD_PROVIDER_PREFIX}:glm-5.2`,
        displayName: "GLM 5.2",
        authMode: "api-key",
        model: "glm-5.2",
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
            model: "kimi-k2.7-code",
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

  it("does not fall back to ambient auth when an explicit env is supplied", () => {
    const previous = process.env.OLLAMA_CLOUD_API_KEY;
    process.env.OLLAMA_CLOUD_API_KEY = "ambient-token";
    try {
      const [provider] = listOllamaCloudProviders(config(), { env: {} });

      expect(provider).toMatchObject({
        id: `${OLLAMA_CLOUD_PROVIDER_PREFIX}:kimi-k2.7-code`,
        available: false,
        warnings: ["Ollama Cloud profile kimi-k2.7-code auth env OLLAMA_CLOUD_API_KEY is missing."]
      });
    } finally {
      if (previous === undefined) {
        delete process.env.OLLAMA_CLOUD_API_KEY;
      } else {
        process.env.OLLAMA_CLOUD_API_KEY = previous;
      }
    }
  });

  it("resolves profile ids from dynamic provider ids", () => {
    const profile = resolveOllamaCloudProfile(
      config(),
      `${OLLAMA_CLOUD_PROVIDER_PREFIX}:kimi-k2.7-code`
    );

    expect(profile).toMatchObject({
      id: "kimi-k2.7-code",
      baseUrl: "https://ollama.example/v1",
      model: "kimi-k2.7-code",
      apiKeyEnv: "OLLAMA_CLOUD_API_KEY"
    });
  });
});
