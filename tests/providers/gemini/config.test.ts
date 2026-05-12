import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  GEMINI_PROVIDER_ID,
  geminiProvider,
  geminiProviderDescriptor
} from "../../../src/providers/gemini/config.js";

function config(input: {
  readonly enabled?: boolean;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly structuredOutput?: boolean;
  readonly longContext?: boolean;
  readonly reasoning?: boolean;
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      gemini: {
        enabled: input.enabled ?? true,
        ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.apiKeyEnv === undefined ? {} : { apiKeyEnv: input.apiKeyEnv }),
        displayName: "Gemini Review",
        capabilities: {
          structuredOutput: input.structuredOutput ?? true,
          longContext: input.longContext ?? true,
          reasoning: input.reasoning ?? false
        }
      }
    }
  } as AgentTeamConfig;
}

describe("Gemini provider config", () => {
  it("omits the Gemini descriptor when disabled", () => {
    expect(geminiProvider(config({ enabled: false }))).toBeUndefined();
  });

  it("builds a conservative descriptor from explicit config", () => {
    expect(
      geminiProviderDescriptor(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKeyEnv: "GEMINI_API_KEY"
        })
      )
    ).toEqual(
      expect.objectContaining({
        id: GEMINI_PROVIDER_ID,
        displayName: "Gemini Review",
        authMode: "api-key",
        model: "gemini-2.5-flash",
        capabilities: ["structuredOutput", "longContext"],
        available: true
      })
    );
  });

  it("marks incomplete Gemini config unavailable while preserving doctor visibility", () => {
    expect(
      geminiProviderDescriptor(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash"
        })
      )
    ).toMatchObject({
      id: GEMINI_PROVIDER_ID,
      available: false,
      warnings: ["Gemini provider is missing apiKeyEnv."]
    });
  });

  it("does not claim implementation or session capabilities", () => {
    expect(
      geminiProviderDescriptor(
        config({
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKeyEnv: "GEMINI_API_KEY"
        })
      ).capabilities
    ).not.toEqual(
      expect.arrayContaining([
        "tools",
        "edits",
        "sessionResume",
        "cancellation",
        "workspaceIsolation",
        "parallelDispatch"
      ])
    );
  });
});
