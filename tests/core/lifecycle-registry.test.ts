import { describe, expect, it } from "vitest";
import { LifecycleRegistry } from "../../src/core/lifecycle-registry.js";
import type { AgentTeamConfig } from "../../src/core/types.js";

function config(input: {
  readonly writeEnabled?: boolean;
  readonly requireWorktree?: boolean;
  readonly allowApiKeyFallback?: boolean;
  readonly openAIEnabled?: boolean;
  readonly openAIModel?: string;
  readonly ollamaEnabled?: boolean;
  readonly ollamaModel?: string;
} = {}): AgentTeamConfig {
  return {
    writeMode: {
      enabled: input.writeEnabled ?? false,
      requireIsolatedWorktree: input.requireWorktree ?? true
    },
    auth: {
      allowApiKeyFallback: input.allowApiKeyFallback ?? false
    },
    providers: {
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
  });
});
