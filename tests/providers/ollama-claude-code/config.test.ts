import { describe, expect, it } from "vitest";
import {
  AgentTeamConfigError,
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "../../../src/core/config.js";
import type { AgentTeamConfig } from "../../../src/core/types.js";
import {
  OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX,
  listOllamaClaudeCodeProviders,
  ollamaClaudeCodeProviderId,
  resolveOllamaClaudeCodeProfile,
  scopedOllamaClaudeCodeEnv
} from "../../../src/providers/ollama-claude-code/config.js";

function config(input: {
  readonly enabled?: boolean;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly profiles?: readonly unknown[];
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      ollamaClaudeCode: {
        enabled: input.enabled ?? true,
        baseUrl: input.baseUrl ?? "http://localhost:11434",
        apiKeyEnv: input.apiKeyEnv ?? "OLLAMA_API_KEY",
        profiles:
          input.profiles ??
          [
            {
              id: "kimi-k2.6",
              model: "kimi-k2.6:cloud",
              displayName: "Kimi K2.6",
              capabilities: { structuredOutput: true, longContext: true }
            }
          ]
      }
    }
  } as AgentTeamConfig;
}

describe("Ollama Claude Code profile config", () => {
  it("omits profile descriptors when disabled", () => {
    expect(listOllamaClaudeCodeProviders(config({ enabled: false }))).toEqual([]);
  });

  it("builds explicit provider descriptors with one shared API key env", () => {
    const providers = listOllamaClaudeCodeProviders(
      config({
        profiles: [
          {
            id: "kimi-k2.6",
            model: "kimi-k2.6:cloud",
            displayName: "Kimi K2.6",
            capabilities: { structuredOutput: true, longContext: true, reasoning: true }
          },
          {
            id: "glm-5.1",
            model: "glm-5.1:cloud",
            displayName: "GLM 5.1",
            capabilities: { structuredOutput: true }
          }
        ]
      })
    );

    expect(providers).toEqual([
      expect.objectContaining({
        id: `${OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:kimi-k2.6`,
        displayName: "Kimi K2.6",
        authMode: "api-key",
        model: "kimi-k2.6:cloud",
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
        id: `${OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:glm-5.1`,
        displayName: "GLM 5.1",
        authMode: "api-key",
        model: "glm-5.1:cloud",
        capabilities: ["structuredOutput", "tools", "sessionResume", "cancellation"],
        available: true
      })
    ]);
  });

  it("keeps write capabilities disabled until a profile is explicitly write validated", () => {
    const [readOnly, writeValidated] = listOllamaClaudeCodeProviders(
      config({
        profiles: [
          {
            id: "deepseek-v4",
            model: "deepseek-v4-flash:cloud",
            capabilities: { structuredOutput: true, edits: true, workspaceIsolation: true }
          },
          {
            id: "deepseek-v4-validated",
            model: "deepseek-v4-flash:cloud",
            writeValidated: true,
            capabilities: { structuredOutput: true, edits: true, workspaceIsolation: true }
          }
        ]
      })
    );

    expect(readOnly?.capabilities).not.toContain("edits");
    expect(readOnly?.capabilities).not.toContain("workspaceIsolation");
    expect(readOnly?.warnings).toContain(
      "Ollama Claude Code profile deepseek-v4 declares write capabilities without writeValidated."
    );
    expect(writeValidated?.capabilities).toEqual(
      expect.arrayContaining(["edits", "workspaceIsolation"])
    );
  });

  it("marks incomplete shared config unavailable while preserving doctor visibility", () => {
    const [provider] = listOllamaClaudeCodeProviders(
      {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          ollamaClaudeCode: {
            enabled: true,
            apiKeyEnv: "OLLAMA_API_KEY",
            profiles: [
              {
                id: "missing-shared",
                model: "kimi-k2.6:cloud",
                writeValidated: false,
                capabilities: {
                  structuredOutput: true,
                  longContext: false,
                  tools: true,
                  sessionResume: true,
                  cancellation: true,
                  reasoning: false,
                  edits: false,
                  workspaceIsolation: false
                }
              }
            ]
          }
        }
      }
    );

    expect(provider).toMatchObject({
      id: `${OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:missing-shared`,
      available: false,
      warnings: [
        "Ollama Claude Code provider is missing baseUrl."
      ]
    });
  });

  it("resolves profile ids from dynamic provider ids", () => {
    const profile = resolveOllamaClaudeCodeProfile(
      config(),
      ollamaClaudeCodeProviderId("kimi-k2.6")
    );

    expect(profile).toMatchObject({
      id: "kimi-k2.6",
      model: "kimi-k2.6:cloud"
    });
  });

  it("creates scoped Claude Code env without mutating the source env", () => {
    const sourceEnv = { PATH: "/usr/bin", OLLAMA_API_KEY: "secret-token" };
    const scoped = scopedOllamaClaudeCodeEnv({
      env: sourceEnv,
      baseUrl: "http://localhost:11434",
      apiKeyEnv: "OLLAMA_API_KEY"
    });

    expect(scoped).toMatchObject({
      PATH: "/usr/bin",
      OLLAMA_API_KEY: "secret-token",
      ANTHROPIC_BASE_URL: "http://localhost:11434",
      ANTHROPIC_AUTH_TOKEN: "secret-token",
      ANTHROPIC_API_KEY: "secret-token"
    });
    expect(sourceEnv).toEqual({ PATH: "/usr/bin", OLLAMA_API_KEY: "secret-token" });
  });

  it("loads shared Ollama Claude Code config with default OLLAMA_API_KEY env", async () => {
    await expect(
      loadAgentTeamConfig("/tmp/does-not-exist")
    ).resolves.toMatchObject({
      providers: {
        ollamaClaudeCode: {
          enabled: false,
          apiKeyEnv: "OLLAMA_API_KEY",
          profiles: []
        }
      }
    });
  });

  it("rejects duplicate Ollama Claude Code profile ids", async () => {
    const invalid = {
      ...DEFAULT_AGENT_TEAM_CONFIG,
	      providers: {
	        ...DEFAULT_AGENT_TEAM_CONFIG.providers,
	        ollamaClaudeCode: {
	          enabled: true,
	          baseUrl: "http://localhost:11434",
	          apiKeyEnv: "OLLAMA_API_KEY",
	          profiles: [{ id: "kimi" }, { id: "kimi" }]
	        }
	      }
	    } as unknown as AgentTeamConfig;

    expect(() => listOllamaClaudeCodeProviders(invalid)).toThrow(AgentTeamConfigError);
  });
});
