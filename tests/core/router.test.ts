import { describe, expect, it } from "vitest";
import { ProviderCapabilityError } from "../../src/core/errors.js";
import { selectProvider } from "../../src/core/router.js";
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
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        providers: {
          openaiCompatible: {
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
        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
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
});
