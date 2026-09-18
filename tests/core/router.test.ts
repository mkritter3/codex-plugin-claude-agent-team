import { describe, expect, it } from "vitest";
import {
  ProviderAmbiguousSelectorError,
  ProviderCapabilityError,
  ProviderNotFoundError
} from "../../src/core/errors.js";
import {
  explainProviderSelection,
  selectProvider
} from "../../src/core/router.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import type { AgentProviderDescriptor } from "../../src/core/types.js";
import { listProviders } from "../../src/providers/index.js";

const readonlyProvider: AgentProviderDescriptor = {
  id: "readonly-provider",
  displayName: "Read Only",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext"],
  available: true
};

const toolProvider: AgentProviderDescriptor = {
  id: "tool-provider",
  displayName: "Tool Provider",
  authMode: "subscription-oauth",
  capabilities: [
    "structuredOutput",
    "tools",
    "edits",
    "sessionResume",
    "cancellation",
    "workspaceIsolation"
  ],
  available: true
};

const unavailableGrokProvider: AgentProviderDescriptor = {
  id: "grok:offline",
  displayName: "Grok Offline",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext", "reasoning"],
  model: "grok-offline",
  available: false,
  warnings: ["Grok profile offline is missing apiKeyEnv."]
};

const grokReasoningProvider: AgentProviderDescriptor = {
  id: "grok:grok-4.20-reasoning",
  displayName: "Grok 4.20 Reasoning",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext", "reasoning"],
  model: "grok-4.20",
  available: true
};

const grokReviewProvider: AgentProviderDescriptor = {
  id: "grok:grok-review",
  displayName: "Grok Review",
  authMode: "api-key",
  capabilities: ["structuredOutput"],
  model: "grok-review",
  available: true
};

const ollamaArchitectProvider: AgentProviderDescriptor = {
  id: "ollama-cloud:kimi-k2.7-code",
  displayName: "Kimi K2.7 Code",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext"],
  model: "kimi-k2.7-code",
  available: true
};

const ollamaClaudeHarnessProvider: AgentProviderDescriptor = {
  id: "ollama-claude-code:kimi-k2.7-code",
  displayName: "Kimi K2.7 Code Claude Code",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext", "tools", "sessionResume", "cancellation"],
  model: "kimi-k2.7-code",
  available: true
};

describe("selectProvider", () => {
  it("selects a provider that satisfies the role capabilities", () => {
    const selected = selectProvider({
      roleId: "code-reviewer",
      providers: [readonlyProvider, toolProvider]
    });

    expect(selected.id).toBe("readonly-provider");
  });

  it("fails closed when no provider satisfies implementation capabilities", () => {
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers: [readonlyProvider]
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("honors requested provider only after capability validation", () => {
    const selected = selectProvider({
      roleId: "slice-implementer",
      requestedProviderId: "tool-provider",
      providers: [readonlyProvider, toolProvider]
    });

    expect(selected.id).toBe("tool-provider");
  });

  it("explains exact request provider selection without bypassing capabilities", () => {
    const explanation = explainProviderSelection({
      roleId: "architect",
      providers: [readonlyProvider, grokReasoningProvider],
      requestedProviderId: "grok:grok-4.20-reasoning"
    });

    expect(explanation).toMatchObject({
      ok: true,
      selectedProviderId: "grok:grok-4.20-reasoning",
      selector: {
        source: "request",
        value: "grok:grok-4.20-reasoning",
        kind: "id"
      },
      requiredCapabilities: ["structuredOutput", "longContext"]
    });
    expect(explanation.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "grok:grok-4.20-reasoning",
          eligible: true,
          matchedSelector: true
        })
      ])
    );
  });

  it("preserves not-found behavior for an exact requested provider that is unavailable", () => {
    expect(() =>
      selectProvider({
        roleId: "architect",
        providers: [unavailableGrokProvider, ollamaArchitectProvider],
        requestedProviderId: "grok:offline"
      })
    ).toThrow(ProviderNotFoundError);

    expect(
      explainProviderSelection({
        roleId: "architect",
        providers: [unavailableGrokProvider, ollamaArchitectProvider],
        requestedProviderId: "grok:offline"
      }).candidates
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "grok:offline",
          matchedSelector: true,
          eligible: false,
          rejectionReason: "unavailable"
        })
      ])
    );
  });

  it("explains family selectors and rejects family matches that miss role capabilities", () => {
    const explanation = explainProviderSelection({
      roleId: "architect",
      providers: [grokReviewProvider, grokReasoningProvider, ollamaArchitectProvider],
      requestedProviderId: "family:grok"
    });

    expect(explanation).toMatchObject({
      ok: true,
      selectedProviderId: "grok:grok-4.20-reasoning",
      selector: {
        source: "request",
        value: "family:grok",
        kind: "family"
      }
    });
    expect(explanation.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "grok:grok-review",
          matchedSelector: true,
          eligible: false,
          missingCapabilities: ["longContext"],
          rejectionReason: "missing_capabilities"
        }),
        expect.objectContaining({
          providerId: "grok:grok-4.20-reasoning",
          matchedSelector: true,
          eligible: true
        })
      ])
    );
  });

  it("explains model and capability selectors while keeping role requirements mandatory", () => {
    const byModel = explainProviderSelection({
      roleId: "architect",
      providers: [ollamaArchitectProvider, grokReasoningProvider],
      requestedProviderId: "model:grok-4.20"
    });
    expect(byModel).toMatchObject({
      ok: true,
      selectedProviderId: "grok:grok-4.20-reasoning",
      selector: { source: "request", kind: "model", value: "model:grok-4.20" }
    });

    const byCapability = explainProviderSelection({
      roleId: "architect",
      providers: [grokReviewProvider, grokReasoningProvider],
      requestedProviderId: "capability:reasoning"
    });
    expect(byCapability).toMatchObject({
      ok: true,
      selectedProviderId: "grok:grok-4.20-reasoning",
      selector: {
        source: "request",
        kind: "capability",
        value: "capability:reasoning"
      }
    });
    expect(byCapability.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "grok:grok-review",
          matchedSelector: false,
          eligible: false,
          missingCapabilities: ["longContext"],
          rejectionReason: "selector_mismatch"
        })
      ])
    );
  });

  it("fails closed when a requested model selector matches multiple available providers", () => {
    const providers = [ollamaArchitectProvider, ollamaClaudeHarnessProvider];
    const explanation = explainProviderSelection({
      roleId: "architect",
      providers,
      requestedProviderId: "model:kimi-k2.7-code"
    });

    expect(explanation).toMatchObject({
      ok: false,
      selector: {
        source: "request",
        kind: "model",
        value: "model:kimi-k2.7-code"
      }
    });
    expect(explanation.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "ollama-cloud:kimi-k2.7-code",
          matchedSelector: true,
          eligible: false,
          rejectionReason: "ambiguous_model_selector"
        }),
        expect.objectContaining({
          providerId: "ollama-claude-code:kimi-k2.7-code",
          matchedSelector: true,
          eligible: false,
          rejectionReason: "ambiguous_model_selector"
        })
      ])
    );
    expect(() =>
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "model:kimi-k2.7-code"
      })
    ).toThrow(ProviderAmbiguousSelectorError);
  });

  it("fails closed when a requested GLM model selector matches multiple available providers", () => {
    const providers: readonly AgentProviderDescriptor[] = [
      {
        id: "ollama-cloud:glm-5.2",
        displayName: "GLM 5.2",
        authMode: "api-key",
        capabilities: ["structuredOutput", "longContext"],
        model: "glm-5.2",
        available: true
      },
      {
        id: "ollama-claude-code:glm-5.2",
        displayName: "GLM 5.2 Claude Code",
        authMode: "ollama-local",
        capabilities: [
          "structuredOutput",
          "longContext",
          "tools",
          "sessionResume",
          "cancellation",
          "edits",
          "workspaceIsolation"
        ],
        model: "glm-5.2",
        available: true
      }
    ];

    const explanation = explainProviderSelection({
      roleId: "architect",
      providers,
      requestedProviderId: "model:glm-5.2"
    });

    expect(explanation).toMatchObject({
      ok: false,
      selector: {
        source: "request",
        kind: "model",
        value: "model:glm-5.2"
      }
    });
    expect(explanation.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "ollama-cloud:glm-5.2",
          matchedSelector: true,
          eligible: false,
          rejectionReason: "ambiguous_model_selector"
        }),
        expect.objectContaining({
          providerId: "ollama-claude-code:glm-5.2",
          matchedSelector: true,
          eligible: false,
          rejectionReason: "ambiguous_model_selector"
        })
      ])
    );
    expect(() =>
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "model:glm-5.2"
      })
    ).toThrow(ProviderAmbiguousSelectorError);
  });

  it("applies request selector before role pins and role pins before provider order", () => {
    const providers = [readonlyProvider, ollamaArchitectProvider, grokReasoningProvider];

    expect(
      explainProviderSelection({
        roleId: "architect",
        providers,
        requestedProviderId: "family:ollama-cloud",
        routingPolicy: {
          rolePins: { architect: "family:grok" },
          providerOrder: ["family:grok"]
        }
      })
    ).toMatchObject({
      ok: true,
      selectedProviderId: "ollama-cloud:kimi-k2.7-code",
      selector: { source: "request", value: "family:ollama-cloud" }
    });

    expect(
      explainProviderSelection({
        roleId: "architect",
        providers,
        routingPolicy: {
          rolePins: { architect: "family:grok" },
          providerOrder: ["family:ollama-cloud"]
        }
      })
    ).toMatchObject({
      ok: true,
      selectedProviderId: "grok:grok-4.20-reasoning",
      selector: { source: "role-pin", value: "family:grok" }
    });
  });

  it("uses provider order only among capable available providers", () => {
    const explanation = explainProviderSelection({
      roleId: "architect",
      providers: [
        ollamaArchitectProvider,
        unavailableGrokProvider,
        grokReviewProvider,
        grokReasoningProvider
      ],
      routingPolicy: {
        rolePins: {},
        providerOrder: ["family:grok", "family:ollama-cloud"]
      }
    });

    expect(explanation).toMatchObject({
      ok: true,
      selectedProviderId: "grok:grok-4.20-reasoning",
      selector: { source: "provider-order", value: "family:grok" }
    });
    expect(explanation.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "grok:offline",
          available: false,
          eligible: false,
          rejectionReason: "unavailable"
        }),
        expect.objectContaining({
          providerId: "grok:grok-review",
          eligible: false,
          missingCapabilities: ["longContext"],
          rejectionReason: "missing_capabilities"
        })
      ])
    );
  });

  it("advertises implementation capabilities by default for isolated workers", () => {
    const providers = listProviders({
      cliAvailability: { claude: true, gemini: false, codex: true }
    });
    const [provider] = providers;

    expect(provider?.capabilities).toContain("sessionResume");
    expect(provider?.capabilities).toContain("edits");
    expect(provider?.capabilities).toContain("workspaceIsolation");
    expect(
      selectProvider({
        roleId: "slice-implementer",
        providers
      }).id
    ).toBe("claude-code-cli");
  });

  it("defaults read-oriented routing to the preferred Ollama-native Claude Code profile", () => {
    const providers = listProviders({
      env: {},
      cliAvailability: { claude: true, ollama: true, gemini: false, codex: true }
    });

    expect(
      selectProvider({
        roleId: "architect",
        providers,
        routingPolicy: DEFAULT_AGENT_TEAM_CONFIG.routing
      }).id
    ).toBe("ollama-claude-code:glm-5.2");
  });

  it("can route isolated implementation to the write-validated GLM Ollama-native profile", () => {
    const providers = listProviders({
      env: {},
      cliAvailability: { claude: true, ollama: true, gemini: false, codex: true }
    });

    expect(
      selectProvider({
        roleId: "slice-implementer",
        providers,
        routingPolicy: DEFAULT_AGENT_TEAM_CONFIG.routing
      }).id
    ).toBe("ollama-claude-code:glm-5.2");
  });

  it("can route requested isolated implementation to the write-validated Kimi Ollama-native profile", () => {
    const providers = listProviders({
      env: {},
      cliAvailability: { claude: true, ollama: true, gemini: false, codex: true }
    });

    expect(
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "ollama-claude-code:kimi-k2.7-code"
      }).id
    ).toBe("ollama-claude-code:kimi-k2.7-code");
  });

  it("advertises implementation capabilities only when isolated write mode is enabled", () => {
    const providers = listProviders({
      cliAvailability: { claude: true, ollama: true, gemini: false, codex: false },
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          claudeCodeCli: DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli,
          openaiCompatible: {
            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          },
	          ollamaCloud: {
	            enabled: false,
	            profiles: []
	          },
	          ollamaClaudeCode: DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode,
	          grok: {
	            enabled: false,
	            profiles: []
          },
          gemini: {
            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          }
        }
      }
    });
    const [provider] = providers;

    expect(provider?.capabilities).toContain("edits");
    expect(provider?.capabilities).toContain("workspaceIsolation");
    expect(
      selectProvider({
        roleId: "slice-implementer",
        providers
      }).id
    ).toBe("claude-code-cli");
  });

  it("exposes auto local and Ollama Cloud providers while omitting generic API providers", () => {
    expect(
      listProviders({
        cliAvailability: { claude: true, gemini: false, codex: true }
      }).map((provider) => provider.id)
    ).toEqual([
      "claude-code-cli",
      "claude-code-cli:opus",
      "ollama-cloud:glm-5.2",
      "ollama-cloud:kimi-k2.7-code",
      "ollama-claude-code:glm-5.2",
      "ollama-claude-code:kimi-k2.7-code",
      "gemini-cli",
      "codex-cli"
    ]);
  });

  it("routes read-only roles to explicitly configured OpenAI-compatible capabilities", () => {
    const providers = listProviders({
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          claudeCodeCli: DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli,
          openaiCompatible: {
            enabled: true,
            baseUrl: "https://api.example/v1",
            model: "review-model",
            apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY",
            displayName: "Review Model",
            capabilities: {
              structuredOutput: true,
              longContext: false,
              reasoning: false
            }
          },
	          ollamaCloud: {
	            enabled: false,
	            profiles: []
	          },
	          ollamaClaudeCode: DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode,
	          grok: {
	            enabled: false,
	            profiles: []
          },
          gemini: {
            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          }
        }
      }
    });

    expect(
      selectProvider({
        roleId: "planner",
        providers,
        requestedProviderId: "openai-compatible"
      }).id
    ).toBe("openai-compatible");
    expect(() =>
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "openai-compatible"
      })
    ).toThrow(ProviderCapabilityError);
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "openai-compatible"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("routes requested Ollama Cloud profiles only through declared capabilities", () => {
    const providers = listProviders({
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          claudeCodeCli: DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli,
          openaiCompatible: {
            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          },
	          ollamaCloud: {
	            enabled: true,
	            profiles: [
              {
                id: "kimi-k2.7-code",
                baseUrl: "https://ollama.example/v1",
                model: "kimi-k2.7-code",
                apiKeyEnv: "KIMI_API_KEY",
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
                capabilities: {
                  structuredOutput: true,
                  longContext: false,
                  reasoning: false
                }
	              }
	            ]
	          },
	          ollamaClaudeCode: DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode,
	          grok: {
	            enabled: false,
	            profiles: []
          },
          gemini: {
            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          }
        }
      },
      env: { KIMI_API_KEY: "token", GLM_API_KEY: "token" }
    });

    expect(
      selectProvider({
        roleId: "planner",
        providers,
        requestedProviderId: "ollama-cloud:glm-5.2"
      }).id
    ).toBe("ollama-cloud:glm-5.2");
    expect(
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "ollama-cloud:kimi-k2.7-code"
      }).id
    ).toBe("ollama-cloud:kimi-k2.7-code");
    expect(() =>
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "ollama-cloud:glm-5.2"
      })
    ).toThrow(ProviderCapabilityError);
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "ollama-cloud:kimi-k2.7-code"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("routes requested Ollama Claude Code profiles through lifecycle-safe capabilities", () => {
    const providers = listProviders({
      cliAvailability: { claude: true, ollama: true, gemini: false, codex: false },
      env: { OLLAMA_API_KEY: "secret-token" },
      config: {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          ollamaClaudeCode: {
            enabled: true,
            launchMode: "direct-api",
            baseUrl: "https://ollama.com",
            authToken: "ollama",
            executable: "ollama",
            apiKeyEnv: "OLLAMA_API_KEY",
            profiles: [
              {
                id: "kimi-k2.7-code",
                model: "kimi-k2.7-code",
                displayName: "Kimi K2.7 Code",
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
              }
            ]
          }
        }
      }
    });

    expect(
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "ollama-claude-code:kimi-k2.7-code"
      }).id
    ).toBe("ollama-claude-code:kimi-k2.7-code");
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "ollama-claude-code:kimi-k2.7-code"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("routes requested Claude Code CLI model profiles through subscription OAuth capabilities", () => {
    const providers = listProviders({
      cliAvailability: { claude: true, ollama: true, gemini: false, codex: false },
      config: {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
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
      }
    });

    expect(
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "claude-code-cli:opus"
      }).id
    ).toBe("claude-code-cli:opus");
    expect(
      selectProvider({
        roleId: "planner",
        providers,
        requestedProviderId: "family:claude-code-cli"
      }).id
    ).toBe("claude-code-cli");
    expect(
      selectProvider({
        roleId: "planner",
        providers,
        requestedProviderId: "model:haiku"
      }).id
    ).toBe("claude-code-cli:haiku");
    expect(() =>
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "claude-code-cli:haiku"
      })
    ).toThrow(ProviderCapabilityError);
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "claude-code-cli:opus"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("routes the default Opus profile for explicit senior-review requests", () => {
    const providers = listProviders({
      config: DEFAULT_AGENT_TEAM_CONFIG,
      cliAvailability: { claude: true, ollama: false, gemini: false, codex: false },
      env: {}
    });

    expect(
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "claude-code-cli:opus"
      }).id
    ).toBe("claude-code-cli:opus");
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "claude-code-cli:opus"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("supports explicit Opus planning, Haiku search, and Sonnet execution role pins", () => {
    const providers = listProviders({
      config: {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
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
              },
              {
                id: "sonnet",
                model: "sonnet",
                displayName: "Claude Sonnet",
                writeValidated: true,
                capabilities: {
                  structuredOutput: true,
                  longContext: true,
                  tools: true,
                  sessionResume: true,
                  cancellation: true,
                  reasoning: true,
                  edits: true,
                  workspaceIsolation: true
                }
              }
            ]
          }
        }
      }
    });
    const routingPolicy = {
      rolePins: {
        architect: "model:opus",
        planner: "model:opus",
        "code-reviewer": "model:opus",
        debugger: "model:opus",
        "docs-dx-writer": "model:haiku",
        "frontend-engineer": "model:sonnet",
        "backend-engineer": "model:sonnet",
        "slice-implementer": "model:sonnet"
      },
      providerOrder: ["model:opus", "model:haiku", "model:sonnet"]
    };

    expect(
      explainProviderSelection({
        roleId: "planner",
        providers,
        routingPolicy
      })
    ).toMatchObject({
      ok: true,
      selectedProviderId: "claude-code-cli:opus",
      selector: { source: "role-pin", kind: "model", value: "model:opus" }
    });
    expect(
      explainProviderSelection({
        roleId: "debugger",
        providers,
        routingPolicy
      })
    ).toMatchObject({
      ok: true,
      selectedProviderId: "claude-code-cli:opus"
    });
    expect(
      explainProviderSelection({
        roleId: "docs-dx-writer",
        providers,
        routingPolicy
      })
    ).toMatchObject({
      ok: true,
      selectedProviderId: "claude-code-cli:haiku",
      selector: { source: "role-pin", kind: "model", value: "model:haiku" }
    });
    expect(
      explainProviderSelection({
        roleId: "slice-implementer",
        providers,
        routingPolicy
      })
    ).toMatchObject({
      ok: true,
      selectedProviderId: "claude-code-cli:sonnet",
      selector: { source: "role-pin", kind: "model", value: "model:sonnet" }
    });
  });

  it("routes requested Gemini only through declared read-only capabilities", () => {
    const providers = listProviders({
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          claudeCodeCli: DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli,
          openaiCompatible: {
            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          },
	          ollamaCloud: {
	            enabled: false,
	            profiles: []
	          },
	          ollamaClaudeCode: DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode,
	          grok: {
	            enabled: false,
	            profiles: []
          },
          gemini: {
            enabled: true,
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            model: "gemini-3-pro-preview",
            apiKeyEnv: "GEMINI_API_KEY",
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: false
            }
          }
        }
      }
    });

    expect(
      selectProvider({
        roleId: "planner",
        providers,
        requestedProviderId: "gemini"
      }).id
    ).toBe("gemini");
    expect(
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "gemini"
      }).id
    ).toBe("gemini");
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "gemini"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("fails closed when requested Gemini lacks long-context capability", () => {
    const providers = listProviders({
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          claudeCodeCli: DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli,
          openaiCompatible: {
            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          },
	          ollamaCloud: {
	            enabled: false,
	            profiles: []
	          },
	          ollamaClaudeCode: DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode,
	          grok: {
	            enabled: false,
	            profiles: []
          },
          gemini: {
            enabled: true,
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            model: "gemini-3-pro-preview",
            apiKeyEnv: "GEMINI_API_KEY",
            capabilities: {
              structuredOutput: true,
              longContext: false,
              reasoning: false
            }
          }
        }
      }
    });

    expect(() =>
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "gemini"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("routes frontend implementation to Gemini CLI only after write validation", () => {
    const readOnlyProviders = listProviders({
      config: {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          geminiCli: {
            enabled: true,
            executable: "gemini",
            model: "gemini-3-pro-preview",
            projectEnv: "GOOGLE_CLOUD_PROJECT",
            writeValidated: false,
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
      }
    });

    expect(() =>
      selectProvider({
        roleId: "frontend-engineer",
        providers: readOnlyProviders,
        requestedProviderId: "gemini-cli"
      })
    ).toThrow(ProviderNotFoundError);

    const writeValidatedProviders = listProviders({
      cliAvailability: { claude: true, gemini: true, codex: true },
      config: {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          geminiCli: {
            enabled: true,
            executable: "gemini",
            model: "gemini-3-pro-preview",
            projectEnv: "GOOGLE_CLOUD_PROJECT",
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
      }
    });

    expect(
      selectProvider({
        roleId: "frontend-engineer",
        providers: writeValidatedProviders,
        requestedProviderId: "gemini-cli"
      }).id
    ).toBe("gemini-cli");
  });

  it("routes requested Grok profiles only through declared read-only capabilities", () => {
    const providers = listProviders({
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          claudeCodeCli: DEFAULT_AGENT_TEAM_CONFIG.providers.claudeCodeCli,
          openaiCompatible: {
            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          },
	          ollamaCloud: {
	            enabled: false,
	            profiles: []
	          },
	          ollamaClaudeCode: DEFAULT_AGENT_TEAM_CONFIG.providers.ollamaClaudeCode,
	          gemini: {
	            enabled: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          },
          grok: {
            enabled: true,
            profiles: [
              {
                id: "grok-4.20-reasoning",
                baseUrl: "https://api.x.ai/v1",
                model: "grok-4.20",
                apiKeyEnv: "XAI_API_KEY",
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
                capabilities: {
                  structuredOutput: true,
                  longContext: false,
                  reasoning: false
                }
              }
            ]
          }
        }
      }
    });

    expect(
      selectProvider({
        roleId: "planner",
        providers,
        requestedProviderId: "grok:grok-review"
      }).id
    ).toBe("grok:grok-review");
    expect(
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "grok:grok-4.20-reasoning"
      }).id
    ).toBe("grok:grok-4.20-reasoning");
    expect(() =>
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "grok:grok-review"
      })
    ).toThrow(ProviderCapabilityError);
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "grok:grok-4.20-reasoning"
      })
    ).toThrow(ProviderCapabilityError);
  });
});
