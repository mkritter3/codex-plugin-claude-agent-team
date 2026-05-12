import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentTeamConfigError,
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "../../src/core/config.js";

describe("loadAgentTeamConfig", () => {
  it("defaults write mode and API-key fallback to disabled when config is missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));

    await expect(loadAgentTeamConfig(workspace)).resolves.toEqual(
      DEFAULT_AGENT_TEAM_CONFIG
    );
  });

  it("defaults provider routing policy to no role pins or provider order", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      routing: {
        rolePins: {},
        providerOrder: []
      }
    });
  });

  it("defaults policy to unrestricted roles and providers with audit enabled", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      policy: {
        allowedRoles: [],
        allowedProviderSelectors: [],
        allowWriteMode: true,
        allowedWorktreeRoots: [],
        liveSmokeEnabled: false,
        auditEnabled: true
      }
    });
  });

  it("loads explicit isolated write mode without enabling API-key fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        writeMode: { enabled: true, requireIsolatedWorktree: true }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toEqual({
      writeMode: { enabled: true, requireIsolatedWorktree: true },
      auth: { allowApiKeyFallback: false },
      routing: { rolePins: {}, providerOrder: [] },
      providers: DEFAULT_AGENT_TEAM_CONFIG.providers,
      policy: DEFAULT_AGENT_TEAM_CONFIG.policy
    });
  });

  it("loads explicit policy restrictions without changing provider config", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        policy: {
          allowedRoles: ["planner", "code-reviewer"],
          allowedProviderSelectors: ["claude-code-cli", "family:grok", "capability:reasoning"],
          allowWriteMode: false,
          allowedWorktreeRoots: ["/tmp/agent-team-worktrees"],
          liveSmokeEnabled: true,
          auditEnabled: false
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: DEFAULT_AGENT_TEAM_CONFIG.providers,
      policy: {
        allowedRoles: ["planner", "code-reviewer"],
        allowedProviderSelectors: ["claude-code-cli", "family:grok", "capability:reasoning"],
        allowWriteMode: false,
        allowedWorktreeRoots: ["/tmp/agent-team-worktrees"],
        liveSmokeEnabled: true,
        auditEnabled: false
      }
    });
  });

  it("rejects invalid policy role ids and selectors", async () => {
    const invalidConfigs = [
      { policy: { allowedRoles: ["not-a-role"] } },
      { policy: { allowedRoles: [""] } },
      { policy: { allowedProviderSelectors: [""] } },
      { policy: { allowedProviderSelectors: ["capability:not-real"] } },
      { policy: { allowedWorktreeRoots: [1] } },
      { policy: { allowedWorktreeRoots: [""] } },
      { policy: { allowWriteMode: "yes" } },
      { policy: { liveSmokeEnabled: "yes" } },
      { policy: { auditEnabled: "yes" } }
    ];

    for (const [index, config] of invalidConfigs.entries()) {
      const workspace = await mkdtemp(join(tmpdir(), `agent-team-config-invalid-${index}-`));
      await mkdir(join(workspace, ".agent-team"), { recursive: true });
      await writeFile(
        join(workspace, ".agent-team", "config.json"),
        JSON.stringify(config),
        "utf8"
      );

      await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
        AgentTeamConfigError
      );
    }
  });

  it("loads explicit provider routing policy without changing auth or provider config", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        routing: {
          rolePins: {
            architect: "family:grok",
            "code-reviewer": "model:grok-4.20"
          },
          providerOrder: ["family:grok", "family:ollama-cloud", "claude-code-cli"]
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      auth: { allowApiKeyFallback: false },
      providers: DEFAULT_AGENT_TEAM_CONFIG.providers,
      routing: {
        rolePins: {
          architect: "family:grok",
          "code-reviewer": "model:grok-4.20"
        },
        providerOrder: ["family:grok", "family:ollama-cloud", "claude-code-cli"]
      }
    });
  });

  it("loads explicit OpenAI-compatible provider config without inferring env fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          openaiCompatible: {
            enabled: true,
            baseUrl: "https://ollama.example/v1",
            model: "kimi-k2.6",
            apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
            displayName: "Ollama Cloud",
            capabilities: {
              structuredOutput: true,
              longContext: true
            }
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        openaiCompatible: {
          enabled: true,
          baseUrl: "https://ollama.example/v1",
          model: "kimi-k2.6",
          apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
          displayName: "Ollama Cloud",
          capabilities: {
            structuredOutput: true,
            longContext: true,
            reasoning: false
          }
        }
      }
    });
  });

  it("loads explicit Ollama Cloud profiles without inferring env fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          ollamaCloud: {
            enabled: true,
            profiles: [
              {
                id: "kimi-k2.6",
                baseUrl: "https://ollama.example/v1",
                model: "kimi-k2.6",
                apiKeyEnv: "KIMI_API_KEY",
                displayName: "Kimi K2.6",
                capabilities: {
                  structuredOutput: true,
                  longContext: true
                }
              },
              {
                id: "glm-5.1",
                baseUrl: "https://ollama.example/v1",
                model: "glm-5.1",
                apiKeyEnv: "GLM_API_KEY",
                displayName: "GLM 5.1",
                capabilities: {
                  structuredOutput: true
                }
              }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        ollamaCloud: {
          enabled: true,
          profiles: [
            {
              id: "kimi-k2.6",
              baseUrl: "https://ollama.example/v1",
              model: "kimi-k2.6",
              apiKeyEnv: "KIMI_API_KEY",
              displayName: "Kimi K2.6",
              capabilities: {
                structuredOutput: true,
                longContext: true,
                reasoning: false
              }
            },
            {
              id: "glm-5.1",
              baseUrl: "https://ollama.example/v1",
              model: "glm-5.1",
              apiKeyEnv: "GLM_API_KEY",
              displayName: "GLM 5.1",
              capabilities: {
                structuredOutput: true,
                longContext: false,
                reasoning: false
              }
            }
          ]
        }
      }
    });
  });

  it("loads explicit Gemini provider config without inferring env fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          gemini: {
            enabled: true,
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            model: "gemini-2.5-flash",
            apiKeyEnv: "GEMINI_API_KEY",
            displayName: "Gemini Review",
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: true
            }
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        gemini: {
          enabled: true,
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-2.5-flash",
          apiKeyEnv: "GEMINI_API_KEY",
          displayName: "Gemini Review",
          capabilities: {
            structuredOutput: true,
            longContext: true,
            reasoning: true
          }
        }
      }
    });
  });

  it("loads explicit Grok profiles without inferring env fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          grok: {
            enabled: true,
            profiles: [
              {
                id: "grok-4.20-reasoning",
                baseUrl: "https://api.x.ai/v1",
                model: "grok-4.20",
                apiKeyEnv: "XAI_API_KEY",
                displayName: "Grok 4.20 Reasoning",
                capabilities: {
                  structuredOutput: true,
                  longContext: true,
                  reasoning: true
                }
              },
              {
                id: "grok-review",
                baseUrl: "https://api.x.ai/v1",
                model: "grok-review",
                apiKeyEnv: "GROK_API_KEY",
                displayName: "Grok Review",
                capabilities: {
                  structuredOutput: true
                }
              }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        grok: {
          enabled: true,
          profiles: [
            {
              id: "grok-4.20-reasoning",
              baseUrl: "https://api.x.ai/v1",
              model: "grok-4.20",
              apiKeyEnv: "XAI_API_KEY",
              displayName: "Grok 4.20 Reasoning",
              capabilities: {
                structuredOutput: true,
                longContext: true,
                reasoning: true
              }
            },
            {
              id: "grok-review",
              baseUrl: "https://api.x.ai/v1",
              model: "grok-review",
              apiKeyEnv: "GROK_API_KEY",
              displayName: "Grok Review",
              capabilities: {
                structuredOutput: true,
                longContext: false,
                reasoning: false
              }
            }
          ]
        }
      }
    });
  });

  it("rejects unsupported Ollama Cloud profile capabilities and duplicate ids", async () => {
    const unsupported = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(unsupported, ".agent-team"), { recursive: true });
    await writeFile(
      join(unsupported, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          ollamaCloud: {
            enabled: true,
            profiles: [
              {
                id: "kimi",
                baseUrl: "https://ollama.example/v1",
                model: "kimi-k2.6",
                apiKeyEnv: "KIMI_API_KEY",
                capabilities: { structuredOutput: true, tools: true }
              }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(unsupported)).rejects.toThrow(
      "Ollama Cloud profile kimi does not support capability tools"
    );

    const duplicate = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(duplicate, ".agent-team"), { recursive: true });
    await writeFile(
      join(duplicate, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          ollamaCloud: {
            enabled: true,
            profiles: [
              { id: "kimi", capabilities: { structuredOutput: true } },
              { id: "kimi", capabilities: { structuredOutput: true } }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(duplicate)).rejects.toThrow(
      "Duplicate Ollama Cloud profile id: kimi"
    );
  });

  it("rejects unsupported OpenAI-compatible capability claims", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          openaiCompatible: {
            enabled: true,
            baseUrl: "https://api.example/v1",
            model: "model",
            apiKeyEnv: "EXAMPLE_API_KEY",
            capabilities: {
              structuredOutput: true,
              tools: true
            }
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
      "OpenAI-compatible provider does not support capability tools"
    );
  });

  it("rejects unsupported Gemini capability claims", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          gemini: {
            enabled: true,
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            model: "gemini-2.5-flash",
            apiKeyEnv: "GEMINI_API_KEY",
            capabilities: {
              structuredOutput: true,
              sessionResume: true
            }
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
      "Gemini provider does not support capability sessionResume"
    );
  });

  it("rejects unsupported Grok profile capabilities and duplicate ids", async () => {
    const unsupported = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(unsupported, ".agent-team"), { recursive: true });
    await writeFile(
      join(unsupported, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          grok: {
            enabled: true,
            profiles: [
              {
                id: "grok",
                baseUrl: "https://api.x.ai/v1",
                model: "grok-4.20",
                apiKeyEnv: "XAI_API_KEY",
                capabilities: { structuredOutput: true, edits: true }
              }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(unsupported)).rejects.toThrow(
      "Grok profile grok does not support capability edits"
    );

    const duplicate = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(duplicate, ".agent-team"), { recursive: true });
    await writeFile(
      join(duplicate, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          grok: {
            enabled: true,
            profiles: [
              { id: "grok", capabilities: { structuredOutput: true } },
              { id: "grok", capabilities: { structuredOutput: true } }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(duplicate)).rejects.toThrow(
      "Duplicate Grok profile id: grok"
    );
  });

  it("rejects invalid provider routing policy", async () => {
    const invalidRole = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(invalidRole, ".agent-team"), { recursive: true });
    await writeFile(
      join(invalidRole, ".agent-team", "config.json"),
      JSON.stringify({
        routing: {
          rolePins: {
            writer: "claude-code-cli"
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(invalidRole)).rejects.toThrow(
      "Invalid routing role pin: writer"
    );

    const emptySelector = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(emptySelector, ".agent-team"), { recursive: true });
    await writeFile(
      join(emptySelector, ".agent-team", "config.json"),
      JSON.stringify({
        routing: {
          rolePins: {
            planner: "   "
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(emptySelector)).rejects.toThrow(
      "Routing selector for planner must be a non-empty string"
    );

    const invalidCapability = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(invalidCapability, ".agent-team"), { recursive: true });
    await writeFile(
      join(invalidCapability, ".agent-team", "config.json"),
      JSON.stringify({
        routing: {
          providerOrder: ["capability:telepathy"]
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(invalidCapability)).rejects.toThrow(
      "Routing selector capability:telepathy references unsupported capability telepathy"
    );

    const nonStringOrder = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(nonStringOrder, ".agent-team"), { recursive: true });
    await writeFile(
      join(nonStringOrder, ".agent-team", "config.json"),
      JSON.stringify({
        routing: {
          providerOrder: ["family:grok", 42]
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(nonStringOrder)).rejects.toThrow(
      "routing.providerOrder[1] must be a non-empty string"
    );
  });

  it("fails closed on invalid config JSON", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      "{ nope",
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
      AgentTeamConfigError
    );
  });

  it("rejects write mode without isolated worktrees", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        writeMode: { enabled: true, requireIsolatedWorktree: false }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
      "requires isolated worktrees"
    );
  });
});
