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
  readonly launchMode?: string;
  readonly authToken?: string;
  readonly executable?: string;
  readonly profiles?: readonly unknown[];
} = {}): AgentTeamConfig {
  return {
    ...DEFAULT_AGENT_TEAM_CONFIG,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      ollamaClaudeCode: {
        enabled: input.enabled ?? true,
        launchMode: input.launchMode ?? "ollama-launch",
        baseUrl: input.baseUrl ?? "http://localhost:11434",
        authToken: input.authToken ?? "ollama",
        executable: input.executable ?? "ollama",
        apiKeyEnv: input.apiKeyEnv ?? "OLLAMA_API_KEY",
        profiles:
          input.profiles ??
          [
            {
              id: "kimi-k2.7-code",
              model: "kimi-k2.7-code",
              displayName: "Kimi K2.7 Code",
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

  it("builds native Ollama launch provider descriptors without an API key env", () => {
    const providers = listOllamaClaudeCodeProviders(
      config({
        profiles: [
          {
            id: "kimi-k2.7-code",
            model: "kimi-k2.7-code:cloud",
            displayName: "Kimi K2.7 Code",
            capabilities: { structuredOutput: true, longContext: true, reasoning: true }
          },
          {
            id: "glm-5.2",
            model: "glm-5.2:cloud",
            displayName: "GLM 5.2",
            capabilities: { structuredOutput: true }
          }
        ]
      }),
      { env: {}, ollamaAvailable: true }
    );

    expect(providers).toEqual([
      expect.objectContaining({
        id: `${OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:kimi-k2.7-code`,
        displayName: "Kimi K2.7 Code",
        authMode: "ollama-local",
        model: "kimi-k2.7-code:cloud",
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
        id: `${OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX}:glm-5.2`,
        displayName: "GLM 5.2",
        authMode: "ollama-local",
        model: "glm-5.2:cloud",
        capabilities: ["structuredOutput", "tools", "sessionResume", "cancellation"],
        available: true
      })
    ]);
  });

  it("lists default Ollama-native Claude Code profiles without requiring an API key", () => {
    const providers = listOllamaClaudeCodeProviders(DEFAULT_AGENT_TEAM_CONFIG, {
      env: {},
      ollamaAvailable: true
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      "ollama-claude-code:glm-5.2",
      "ollama-claude-code:kimi-k2.7-code"
    ]);
    expect(providers.every((provider) => provider.available === true)).toBe(true);
    expect(providers.every((provider) => provider.warnings === undefined)).toBe(true);
    expect(providers[0]?.capabilities).toEqual(
      expect.arrayContaining(["edits", "workspaceIsolation"])
    );
    expect(providers[1]?.capabilities).toEqual(
      expect.arrayContaining(["edits", "workspaceIsolation"])
    );
  });

  it("reports native Ollama launch profiles unavailable when the Ollama CLI is missing", () => {
    const providers = listOllamaClaudeCodeProviders(DEFAULT_AGENT_TEAM_CONFIG, {
      env: {},
      ollamaAvailable: false
    });

    expect(providers.every((provider) => provider.available === false)).toBe(true);
    expect(providers[0]?.warnings).toContain(
      "Ollama Claude Code launch mode requires the ollama CLI on PATH."
    );
  });

  it("reports native Ollama launch profiles unavailable when Claude Code CLI is missing", () => {
    const providers = listOllamaClaudeCodeProviders(DEFAULT_AGENT_TEAM_CONFIG, {
      env: {},
      ollamaAvailable: true,
      claudeAvailable: false
    });

    expect(providers.every((provider) => provider.available === false)).toBe(true);
    expect(providers[0]?.warnings).toContain(
      "Ollama Claude Code requires the claude CLI on PATH."
    );
  });

  it("does not fall back to ambient auth when direct API mode receives an explicit env", () => {
    const previous = process.env.OLLAMA_API_KEY;
    process.env.OLLAMA_API_KEY = "ambient-token";
    try {
      const providers = listOllamaClaudeCodeProviders(config({ launchMode: "direct-api" }), {
        env: {}
      });

      expect(providers.every((provider) => provider.available === false)).toBe(true);
      expect(providers[0]?.warnings).toContain(
        "Ollama Claude Code profile kimi-k2.7-code auth env OLLAMA_API_KEY is missing."
      );
    } finally {
      if (previous === undefined) {
        delete process.env.OLLAMA_API_KEY;
      } else {
        process.env.OLLAMA_API_KEY = previous;
      }
    }
  });

  it("marks direct API profiles available when shared auth is present", () => {
    const providers = listOllamaClaudeCodeProviders(config({ launchMode: "direct-api" }), {
      env: { OLLAMA_API_KEY: "secret-token" }
    });

    expect(providers.map((provider) => provider.id)).toEqual([
      "ollama-claude-code:kimi-k2.7-code",
    ]);
    expect(providers.every((provider) => provider.available === true)).toBe(true);
    expect(providers.every((provider) => provider.warnings === undefined)).toBe(true);
  });

  it("loads default Ollama Claude Code profiles with Ollama-native launch settings", async () => {
    await expect(
      loadAgentTeamConfig("/tmp/does-not-exist")
    ).resolves.toMatchObject({
      providers: {
        ollamaClaudeCode: {
          enabled: true,
          launchMode: "ollama-launch",
          baseUrl: "http://localhost:11434",
          authToken: "ollama",
          executable: "ollama",
          apiKeyEnv: "OLLAMA_API_KEY",
          profiles: [
            expect.objectContaining({
              id: "glm-5.2",
              model: "glm-5.2:cloud",
              writeValidated: true,
              capabilities: expect.objectContaining({
                edits: true,
                workspaceIsolation: true
              })
            }),
            expect.objectContaining({
              id: "kimi-k2.7-code",
              model: "kimi-k2.7-code:cloud",
              writeValidated: true,
              capabilities: expect.objectContaining({
                edits: true,
                workspaceIsolation: true
              })
            })
          ]
        }
      }
    });
  });

  it("uses bare model ids for omitted profiles in direct API fallback mode", async () => {
    const workspace = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp("/tmp/agent-team-ollama-direct-api-")
    );
    await import("node:fs/promises").then(async (fs) => {
      await fs.mkdir(`${workspace}/.agent-team`, { recursive: true });
      await fs.writeFile(
        `${workspace}/.agent-team/config.json`,
        JSON.stringify({
          providers: {
            ollamaClaudeCode: {
              enabled: true,
              launchMode: "direct-api"
            }
          }
        }),
        "utf8"
      );
    });

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        ollamaClaudeCode: {
          launchMode: "direct-api",
          baseUrl: "https://ollama.com",
          profiles: [
            expect.objectContaining({
              id: "glm-5.2",
              model: "glm-5.2",
              writeValidated: false,
              capabilities: expect.objectContaining({
                edits: false,
                workspaceIsolation: false
              })
            }),
            expect.objectContaining({
              id: "kimi-k2.7-code",
              model: "kimi-k2.7-code",
              writeValidated: false,
              capabilities: expect.objectContaining({
                edits: false,
                workspaceIsolation: false
              })
            })
          ]
        }
      }
    });
  });

  it("creates Ollama-native Claude Code env without mutating the source env", () => {
    const sourceEnv = {
      PATH: "/usr/bin",
      OLLAMA_API_KEY: "ambient-ollama-api-key",
      CUSTOM_OLLAMA_KEY: "custom-secret-token",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-token",
      ANTHROPIC_AUTH_TOKEN: "ambient-anthropic-token",
      ANTHROPIC_API_KEY: "ambient-api-key"
    };
    const scoped = scopedOllamaClaudeCodeEnv({
      env: sourceEnv,
      launchMode: "ollama-launch",
      baseUrl: "http://localhost:11434",
      authToken: "ollama",
      apiKeyEnv: "CUSTOM_OLLAMA_KEY"
    });

    expect(scoped).toMatchObject({
      PATH: "/usr/bin",
      ANTHROPIC_BASE_URL: "http://localhost:11434",
      ANTHROPIC_AUTH_TOKEN: "ollama",
      ANTHROPIC_API_KEY: ""
    });
    expect(scoped.OLLAMA_API_KEY).toBeUndefined();
    expect(scoped.CUSTOM_OLLAMA_KEY).toBeUndefined();
    expect(scoped.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(sourceEnv).toEqual({
      PATH: "/usr/bin",
      OLLAMA_API_KEY: "ambient-ollama-api-key",
      CUSTOM_OLLAMA_KEY: "custom-secret-token",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-token",
      ANTHROPIC_AUTH_TOKEN: "ambient-anthropic-token",
      ANTHROPIC_API_KEY: "ambient-api-key"
    });
  });

  it("creates direct API Claude Code env without mutating the source env", () => {
    const sourceEnv = {
      PATH: "/usr/bin",
      OLLAMA_API_KEY: "secret-token",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-token",
      ANTHROPIC_AUTH_TOKEN: "ambient-anthropic-token",
      ANTHROPIC_API_KEY: "ambient-api-key"
    };
    const scoped = scopedOllamaClaudeCodeEnv({
      env: sourceEnv,
      launchMode: "direct-api",
      baseUrl: "https://ollama.com",
      authToken: "ollama",
      apiKeyEnv: "OLLAMA_API_KEY"
    });

    expect(scoped).toMatchObject({
      PATH: "/usr/bin",
      OLLAMA_API_KEY: "secret-token",
      ANTHROPIC_BASE_URL: "https://ollama.com",
      ANTHROPIC_AUTH_TOKEN: "secret-token",
      ANTHROPIC_API_KEY: ""
    });
    expect(scoped.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(sourceEnv).toEqual({
      PATH: "/usr/bin",
      OLLAMA_API_KEY: "secret-token",
      CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-token",
      ANTHROPIC_AUTH_TOKEN: "ambient-anthropic-token",
      ANTHROPIC_API_KEY: "ambient-api-key"
    });
  });

  it("keeps write capabilities disabled until a profile is explicitly write validated", () => {
    const [readOnly, writeValidated] = listOllamaClaudeCodeProviders(
      config({
        profiles: [
          {
            id: "fixture-write",
            model: "fixture-write-model",
            capabilities: { structuredOutput: true, edits: true, workspaceIsolation: true }
          },
          {
            id: "fixture-write-validated",
            model: "fixture-write-model",
            writeValidated: true,
            capabilities: { structuredOutput: true, edits: true, workspaceIsolation: true }
          }
        ]
      })
    );

    expect(readOnly?.capabilities).not.toContain("edits");
    expect(readOnly?.capabilities).not.toContain("workspaceIsolation");
    expect(readOnly?.warnings).toContain(
      "Ollama Claude Code profile fixture-write declares write capabilities without writeValidated."
    );
    expect(writeValidated?.capabilities).toEqual(
      expect.arrayContaining(["edits", "workspaceIsolation"])
    );
  });

  it("marks incomplete direct API config unavailable while preserving doctor visibility", () => {
    const [provider] = listOllamaClaudeCodeProviders(
      {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          ollamaClaudeCode: {
            enabled: true,
            launchMode: "direct-api",
            baseUrl: undefined as unknown as string,
            authToken: "ollama",
            executable: "ollama",
            apiKeyEnv: "OLLAMA_API_KEY",
            profiles: [
              {
                id: "missing-shared",
                model: "kimi-k2.7-code",
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
      warnings: expect.arrayContaining([
        "Ollama Claude Code provider is missing baseUrl.",
        "Ollama Claude Code profile missing-shared auth env OLLAMA_API_KEY is missing."
      ])
    });
  });

  it("resolves profile ids from dynamic provider ids", () => {
    const profile = resolveOllamaClaudeCodeProfile(
      config(),
      ollamaClaudeCodeProviderId("kimi-k2.7-code")
    );

    expect(profile).toMatchObject({
      id: "kimi-k2.7-code",
      model: "kimi-k2.7-code"
    });
  });

  it("rejects duplicate Ollama Claude Code profile ids", async () => {
    const invalid = {
      ...DEFAULT_AGENT_TEAM_CONFIG,
	      providers: {
	        ...DEFAULT_AGENT_TEAM_CONFIG.providers,
	        ollamaClaudeCode: {
	          enabled: true,
	          baseUrl: "https://ollama.com",
	          apiKeyEnv: "OLLAMA_API_KEY",
	          profiles: [{ id: "kimi" }, { id: "kimi" }]
	        }
	      }
	    } as unknown as AgentTeamConfig;

    expect(() => listOllamaClaudeCodeProviders(invalid)).toThrow(AgentTeamConfigError);
  });
});
