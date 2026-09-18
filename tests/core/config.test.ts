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

  it("defaults provider routing policy to prefer Ollama-native Claude Code", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      routing: {
        rolePins: {},
        providerOrder: [
          "family:ollama-claude-code",
          "claude-code-cli",
          "family:ollama-cloud",
          "agy",
          "codex-cli"
        ]
      }
    });
  });

  it("defaults senior Opus review to required when available", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      seniorReview: {
        opusPlanning: { mode: "required-when-available" },
        opusImplementation: { mode: "required-when-available" }
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

  it("defaults missing config schema version to the current supported version", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      schemaVersion: 1
    });
  });

  it("accepts explicit current config schema version", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({ schemaVersion: 1 }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      schemaVersion: 1
    });
  });

  it("rejects unsupported future config schema versions", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({ schemaVersion: 2 }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
      "Unsupported config schemaVersion 2"
    );
  });

  it("rejects invalid config schema versions", async () => {
    const invalidVersions = ["1", 0, -1, 1.5, null];

    for (const [index, schemaVersion] of invalidVersions.entries()) {
      const workspace = await mkdtemp(join(tmpdir(), `agent-team-config-version-${index}-`));
      await mkdir(join(workspace, ".agent-team"), { recursive: true });
      await writeFile(
        join(workspace, ".agent-team", "config.json"),
        JSON.stringify({ schemaVersion }),
        "utf8"
      );

      await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
        "schemaVersion must be an integer"
      );
    }
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
      schemaVersion: 1,
      writeMode: { enabled: true, requireIsolatedWorktree: true },
      auth: { allowApiKeyFallback: false },
      routing: DEFAULT_AGENT_TEAM_CONFIG.routing,
      providers: DEFAULT_AGENT_TEAM_CONFIG.providers,
      seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
      policy: DEFAULT_AGENT_TEAM_CONFIG.policy
    });
  });

  it("loads explicit senior review policy overrides", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        seniorReview: {
          opusPlanning: { mode: "optional" },
          opusImplementation: { mode: "disabled" }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      seniorReview: {
        opusPlanning: { mode: "optional" },
        opusImplementation: { mode: "disabled" }
      }
    });
  });

  it("uses senior review environment overrides only when workspace values are absent", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    const workspaceOverride = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    const oldPlanning = process.env.AGENT_TEAM_OPUS_PLANNING_REVIEW;
    const oldImplementation = process.env.AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW;
    process.env.AGENT_TEAM_OPUS_PLANNING_REVIEW = "disabled";
    process.env.AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW = "optional";
    try {
      await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
        seniorReview: {
          opusPlanning: { mode: "disabled" },
          opusImplementation: { mode: "optional" }
        }
      });

      await mkdir(join(workspaceOverride, ".agent-team"), { recursive: true });
      await writeFile(
        join(workspaceOverride, ".agent-team", "config.json"),
        JSON.stringify({
          seniorReview: {
            opusPlanning: { mode: "required-blocking" }
          }
        }),
        "utf8"
      );

      await expect(loadAgentTeamConfig(workspaceOverride)).resolves.toMatchObject({
        seniorReview: {
          opusPlanning: { mode: "required-blocking" },
          opusImplementation: { mode: "optional" }
        }
      });
    } finally {
      if (oldPlanning === undefined) {
        delete process.env.AGENT_TEAM_OPUS_PLANNING_REVIEW;
      } else {
        process.env.AGENT_TEAM_OPUS_PLANNING_REVIEW = oldPlanning;
      }
      if (oldImplementation === undefined) {
        delete process.env.AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW;
      } else {
        process.env.AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW = oldImplementation;
      }
    }
  });

  it("rejects invalid senior review modes from config and env", async () => {
    const invalidConfig = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(invalidConfig, ".agent-team"), { recursive: true });
    await writeFile(
      join(invalidConfig, ".agent-team", "config.json"),
      JSON.stringify({
        seniorReview: {
          opusPlanning: { mode: "always" }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(invalidConfig)).rejects.toThrow(
      "seniorReview.opusPlanning.mode must be one of"
    );

    const oldPlanning = process.env.AGENT_TEAM_OPUS_PLANNING_REVIEW;
    process.env.AGENT_TEAM_OPUS_PLANNING_REVIEW = "sometimes";
    try {
      await expect(
        loadAgentTeamConfig(await mkdtemp(join(tmpdir(), "agent-team-config-")))
      ).rejects.toThrow("AGENT_TEAM_OPUS_PLANNING_REVIEW must be one of");
    } finally {
      if (oldPlanning === undefined) {
        delete process.env.AGENT_TEAM_OPUS_PLANNING_REVIEW;
      } else {
        process.env.AGENT_TEAM_OPUS_PLANNING_REVIEW = oldPlanning;
      }
    }
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
            model: "kimi-k2.7-code",
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
          model: "kimi-k2.7-code",
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

  it("loads explicit Claude Code CLI model profiles without API-key fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          claudeCodeCli: {
            profiles: [
              {
                id: "opus",
                model: "opus",
                displayName: "Claude Opus",
                capabilities: {
                  structuredOutput: true,
                  longContext: true,
                  reasoning: true
                }
              },
              {
                id: "haiku",
                model: "haiku",
                displayName: "Claude Haiku",
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
      auth: { allowApiKeyFallback: false },
      providers: {
        claudeCodeCli: {
          profiles: [
            {
              id: "opus",
              model: "opus",
              displayName: "Claude Opus",
              writeValidated: false,
              capabilities: {
                structuredOutput: true,
                longContext: true,
                tools: true,
                sessionResume: true,
                cancellation: true,
                reasoning: true,
                edits: false,
                workspaceIsolation: false
              }
            },
            {
              id: "haiku",
              model: "haiku",
              displayName: "Claude Haiku",
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
    });
  });

  it("defaults direct Ollama Claude Code API mode to the remote Ollama endpoint", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          ollamaClaudeCode: {
            enabled: true,
            launchMode: "direct-api",
            profiles: [
              {
                id: "glm-5.2",
                model: "glm-5.2",
                capabilities: { structuredOutput: true }
              }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        ollamaClaudeCode: {
          launchMode: "direct-api",
          baseUrl: "https://ollama.com"
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
                id: "kimi-k2.7-code",
                baseUrl: "https://ollama.example/v1",
                model: "kimi-k2.7-code",
                apiKeyEnv: "KIMI_API_KEY",
                displayName: "Kimi K2.7 Code",
                capabilities: {
                  structuredOutput: true,
                  longContext: true
                }
              },
              {
                id: "glm-5.2",
                baseUrl: "https://ollama.example/v1",
                model: "glm-5.2",
                apiKeyEnv: "GLM_API_KEY",
                displayName: "GLM 5.2",
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
              id: "kimi-k2.7-code",
              baseUrl: "https://ollama.example/v1",
              model: "kimi-k2.7-code",
              apiKeyEnv: "KIMI_API_KEY",
              displayName: "Kimi K2.7 Code",
              capabilities: {
                structuredOutput: true,
                longContext: true,
                reasoning: false
              }
            },
            {
              id: "glm-5.2",
              baseUrl: "https://ollama.example/v1",
              model: "glm-5.2",
              apiKeyEnv: "GLM_API_KEY",
              displayName: "GLM 5.2",
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
            model: "gemini-3-pro-preview",
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
          model: "gemini-3-pro-preview",
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

  it("loads explicit AGY autonomous worker config without API-key fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          agy: {
            enabled: true,
            executable: "agy",
            model: "gemini-3-pro-preview",
            displayName: "Gemini UI Worker",
            writeValidated: true,
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: true,
              tools: true,
              edits: true,
              sessionResume: true,
              cancellation: true,
              workspaceIsolation: true
            }
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        agy: {
          enabled: true,
          executable: "agy",
          model: "gemini-3-pro-preview",
          displayName: "Gemini UI Worker",
          writeValidated: true,
          capabilities: {
            structuredOutput: true,
            longContext: true,
            reasoning: true,
            tools: true,
            edits: true,
            sessionResume: true,
            cancellation: true,
            workspaceIsolation: true
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
                model: "kimi-k2.7-code",
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
            model: "gemini-3-pro-preview",
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
