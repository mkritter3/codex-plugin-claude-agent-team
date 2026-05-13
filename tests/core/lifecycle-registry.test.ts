import { describe, expect, it } from "vitest";
import { LifecycleRegistry } from "../../src/core/lifecycle-registry.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import type { AgentTeamConfig } from "../../src/core/types.js";

function config(input: {
  readonly writeEnabled?: boolean;
  readonly requireWorktree?: boolean;
  readonly allowApiKeyFallback?: boolean;
  readonly openAIEnabled?: boolean;
  readonly openAIModel?: string;
  readonly ollamaEnabled?: boolean;
  readonly ollamaModel?: string;
  readonly geminiEnabled?: boolean;
  readonly geminiModel?: string;
  readonly grokEnabled?: boolean;
  readonly grokModel?: string;
  readonly rolePin?: string;
  readonly providerOrder?: readonly string[];
  readonly allowedRoles?: AgentTeamConfig["policy"]["allowedRoles"];
  readonly allowedProviderSelectors?: readonly string[];
  readonly allowWriteMode?: boolean;
  readonly allowedWorktreeRoots?: readonly string[];
  readonly liveSmokeEnabled?: boolean;
  readonly auditEnabled?: boolean;
} = {}): AgentTeamConfig {
	  return {
	    schemaVersion: 1,
	    writeMode: {
      enabled: input.writeEnabled ?? false,
      requireIsolatedWorktree: input.requireWorktree ?? true
    },
    auth: {
      allowApiKeyFallback: input.allowApiKeyFallback ?? false
    },
    routing: {
      rolePins:
        input.rolePin === undefined
          ? {}
          : {
              architect: input.rolePin
            },
      providerOrder: input.providerOrder ?? []
    },
    policy: {
      allowedRoles: input.allowedRoles ?? [],
      allowedProviderSelectors: input.allowedProviderSelectors ?? [],
      allowWriteMode: input.allowWriteMode ?? true,
      allowedWorktreeRoots: input.allowedWorktreeRoots ?? [],
      liveSmokeEnabled: input.liveSmokeEnabled ?? false,
      auditEnabled: input.auditEnabled ?? true
    },
    seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
    providers: {
      ...DEFAULT_AGENT_TEAM_CONFIG.providers,
      claudeCodeCli: {
        profiles: []
      },
      openaiCompatible: {
        enabled: input.openAIEnabled ?? false,
        ...(input.openAIModel === undefined ? {} : { model: input.openAIModel }),
        capabilities: {
          structuredOutput: input.openAIEnabled ?? false,
          longContext: false,
          reasoning: false
        }
      },
	      ollamaCloud: {
	        enabled: input.ollamaEnabled ?? false,
	        profiles:
          input.ollamaEnabled === true
            ? [
                {
                  id: "kimi-k2.6",
                  baseUrl: "https://ollama.example/v1",
                  model: input.ollamaModel ?? "kimi-k2.6",
                  apiKeyEnv: "KIMI_API_KEY",
                  capabilities: {
                    structuredOutput: true,
                    longContext: true,
                    reasoning: false
                  }
                }
              ]
	            : []
	      },
	      ollamaClaudeCode: {
	        enabled: false,
	        apiKeyEnv: "OLLAMA_API_KEY",
	        profiles: []
	      },
	      gemini: {
	        enabled: input.geminiEnabled ?? false,
        ...(input.geminiModel === undefined ? {} : { model: input.geminiModel }),
        capabilities: {
          structuredOutput: input.geminiEnabled ?? false,
          longContext: input.geminiEnabled ?? false,
          reasoning: false
        }
      },
      grok: {
        enabled: input.grokEnabled ?? false,
        profiles:
          input.grokEnabled === true
            ? [
                {
                  id: "grok-4.20-reasoning",
                  baseUrl: "https://api.x.ai/v1",
                  model: input.grokModel ?? "grok-4.20",
                  apiKeyEnv: "XAI_API_KEY",
                  capabilities: {
                    structuredOutput: true,
                    longContext: true,
                    reasoning: true
                  }
                }
              ]
            : []
      }
    }
  };
}

describe("LifecycleRegistry", () => {
  it("reuses a lifecycle manager for the same workspace and config identity", () => {
    const created: AgentTeamConfig[] = [];
    const registry = new LifecycleRegistry({
      createLifecycle: (lifecycleConfig) => {
        created.push(lifecycleConfig);
        return { id: `manager_${created.length}` };
      }
    });

    const first = registry.get("/repo", config());
    const second = registry.get("/repo", config());

    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });

  it("keeps different workspace roots isolated", () => {
    const registry = new LifecycleRegistry({
      createLifecycle: () => ({ id: crypto.randomUUID() })
    });

    expect(registry.get("/repo-a", config())).not.toBe(registry.get("/repo-b", config()));
  });

  it("creates a new lifecycle when config identity changes", () => {
    const registry = new LifecycleRegistry({
      createLifecycle: () => ({ id: crypto.randomUUID() })
    });
    const baseline = registry.get("/repo", config());

    expect(registry.get("/repo", config({ writeEnabled: true }))).not.toBe(baseline);
    expect(registry.get("/repo", config({ requireWorktree: false }))).not.toBe(baseline);
    expect(registry.get("/repo", config({ allowApiKeyFallback: true }))).not.toBe(baseline);
    expect(registry.get("/repo", config({ openAIEnabled: true }))).not.toBe(baseline);
    expect(
      registry.get("/repo", config({ openAIEnabled: true, openAIModel: "model-b" }))
    ).not.toBe(registry.get("/repo", config({ openAIEnabled: true, openAIModel: "model-a" })));
    expect(registry.get("/repo", config({ ollamaEnabled: true }))).not.toBe(baseline);
    expect(
      registry.get("/repo", config({ ollamaEnabled: true, ollamaModel: "glm-5.1" }))
    ).not.toBe(
      registry.get("/repo", config({ ollamaEnabled: true, ollamaModel: "kimi-k2.6" }))
    );
    expect(registry.get("/repo", config({ geminiEnabled: true }))).not.toBe(baseline);
    expect(
      registry.get("/repo", config({ geminiEnabled: true, geminiModel: "gemini-2.5-pro" }))
    ).not.toBe(
      registry.get("/repo", config({ geminiEnabled: true, geminiModel: "gemini-2.5-flash" }))
    );
    expect(registry.get("/repo", config({ grokEnabled: true }))).not.toBe(baseline);
    expect(
      registry.get("/repo", config({ grokEnabled: true, grokModel: "grok-review" }))
    ).not.toBe(
      registry.get("/repo", config({ grokEnabled: true, grokModel: "grok-4.20" }))
    );
    expect(registry.get("/repo", config({ rolePin: "family:grok" }))).not.toBe(baseline);
    expect(
      registry.get("/repo", config({ providerOrder: ["family:grok"] }))
    ).not.toBe(
      registry.get("/repo", config({ providerOrder: ["family:ollama-cloud"] }))
    );
    expect(registry.get("/repo", config({ allowedRoles: ["planner"] }))).not.toBe(
      baseline
    );
    expect(
      registry.get("/repo", config({ allowedProviderSelectors: ["family:grok"] }))
    ).not.toBe(baseline);
    expect(registry.get("/repo", config({ allowWriteMode: false }))).not.toBe(
      baseline
    );
    expect(
      registry.get("/repo", config({ allowedWorktreeRoots: ["/tmp/approved"] }))
    ).not.toBe(baseline);
    expect(registry.get("/repo", config({ liveSmokeEnabled: true }))).not.toBe(
      baseline
    );
    expect(registry.get("/repo", config({ auditEnabled: false }))).not.toBe(
      baseline
    );
  });
});
