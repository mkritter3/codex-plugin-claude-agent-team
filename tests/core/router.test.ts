import { describe, expect, it } from "vitest";
import {
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
  id: "ollama-cloud:kimi-k2.6",
  displayName: "Kimi K2.6",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext"],
  model: "kimi-k2.6",
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
      selectedProviderId: "ollama-cloud:kimi-k2.6",
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

  it("does not advertise implementation capabilities by default", () => {
    const [provider] = listProviders();

    expect(provider?.capabilities).toContain("sessionResume");
    expect(provider?.capabilities).not.toContain("edits");
    expect(provider?.capabilities).not.toContain("workspaceIsolation");
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers: listProviders()
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("advertises implementation capabilities only when isolated write mode is enabled", () => {
    const providers = listProviders({
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        providers: {
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

  it("omits the OpenAI-compatible provider unless explicitly configured", () => {
    expect(listProviders().map((provider) => provider.id)).toEqual([
      "claude-code-cli"
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
        providers: {
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
        providers: {
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
                id: "kimi-k2.6",
                baseUrl: "https://ollama.example/v1",
                model: "kimi-k2.6",
                apiKeyEnv: "KIMI_API_KEY",
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
      }
    });

    expect(
      selectProvider({
        roleId: "planner",
        providers,
        requestedProviderId: "ollama-cloud:glm-5.1"
      }).id
    ).toBe("ollama-cloud:glm-5.1");
    expect(
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "ollama-cloud:kimi-k2.6"
      }).id
    ).toBe("ollama-cloud:kimi-k2.6");
    expect(() =>
      selectProvider({
        roleId: "architect",
        providers,
        requestedProviderId: "ollama-cloud:glm-5.1"
      })
    ).toThrow(ProviderCapabilityError);
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "ollama-cloud:kimi-k2.6"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("routes requested Ollama Claude Code profiles through lifecycle-safe capabilities", () => {
    const providers = listProviders({
      config: {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          ollamaClaudeCode: {
            enabled: true,
            baseUrl: "http://localhost:11434",
            apiKeyEnv: "OLLAMA_API_KEY",
            profiles: [
              {
                id: "kimi-k2.6",
                model: "kimi-k2.6:cloud",
                displayName: "Kimi K2.6",
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
        requestedProviderId: "ollama-claude-code:kimi-k2.6"
      }).id
    ).toBe("ollama-claude-code:kimi-k2.6");
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers,
        requestedProviderId: "ollama-claude-code:kimi-k2.6"
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("routes requested Gemini only through declared read-only capabilities", () => {
    const providers = listProviders({
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        providers: {
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
            model: "gemini-2.5-flash",
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
        providers: {
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
            model: "gemini-2.5-flash",
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

  it("routes requested Grok profiles only through declared read-only capabilities", () => {
    const providers = listProviders({
	      config: {
	        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
	        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy,
        providers: {
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
