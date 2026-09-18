import { describe, expect, it } from "vitest";
import {
  classifyProviderFailure,
  isProviderDegraded,
  recordProviderFailure
} from "../../src/core/provider-health.js";
import {
  explainProviderSelection,
  selectProvider
} from "../../src/core/router.js";
import type { AgentProviderDescriptor } from "../../src/core/types.js";

const claudeProvider: AgentProviderDescriptor = {
  id: "claude-code-cli",
  displayName: "Claude",
  authMode: "subscription-oauth",
  capabilities: ["structuredOutput", "longContext"],
  available: true
};

const ollamaProvider: AgentProviderDescriptor = {
  id: "ollama-claude-code:kimi-k2.7-code",
  displayName: "Kimi K2.7 Code",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext"],
  available: true
};

describe("provider health cooldown policy", () => {
  it("classifies transient provider failures without making model-quality claims", () => {
    expect(classifyProviderFailure({ stderr: "HTTP 503 rate_limit from upstream" })).toEqual({
      transient: true,
      reason: "rate_limited"
    });
    expect(classifyProviderFailure({ stderr: "request timeout exceeded" })).toEqual({
      transient: true,
      reason: "timeout"
    });
    expect(classifyProviderFailure({ stderr: "bad prompt shape" })).toEqual({
      transient: false,
      reason: "non_transient"
    });
  });

  it("records cooldown windows with evidence and increasing failure counts", () => {
    const first = recordProviderFailure({
      providerId: ollamaProvider.id,
      failure: { stderr: "HTTP 503 rate_limit" },
      now: new Date("2026-05-13T10:00:00.000Z"),
      evidencePath: "/tmp/run.log"
    });
    const second = recordProviderFailure({
      providerId: ollamaProvider.id,
      failure: { stderr: "HTTP 503 rate_limit" },
      now: new Date("2026-05-13T10:01:00.000Z"),
      previous: first,
      evidencePath: "/tmp/run-2.log"
    });

    expect(second).toMatchObject({
      providerId: ollamaProvider.id,
      status: "degraded",
      reason: "rate_limited",
      failureCount: 2,
      evidencePaths: ["/tmp/run.log", "/tmp/run-2.log"]
    });
    expect(second.degradedUntil).toBe("2026-05-13T10:31:00.000Z");
    expect(isProviderDegraded(second, new Date("2026-05-13T10:20:00.000Z"))).toBe(true);
    expect(isProviderDegraded(second, new Date("2026-05-13T10:32:00.000Z"))).toBe(false);
  });

  it("skips degraded providers for default routing but permits explicit probes", () => {
    const degraded = recordProviderFailure({
      providerId: ollamaProvider.id,
      failure: { stderr: "HTTP 503 rate_limit" },
      now: new Date("2026-05-13T10:00:00.000Z")
    });

    const selected = selectProvider({
      roleId: "architect",
      providers: [ollamaProvider, claudeProvider],
      providerHealth: [degraded],
      now: new Date("2026-05-13T10:05:00.000Z")
    });

    expect(selected.id).toBe("claude-code-cli");

    const explicit = explainProviderSelection({
      roleId: "architect",
      providers: [ollamaProvider, claudeProvider],
      providerHealth: [degraded],
      requestedProviderId: ollamaProvider.id,
      now: new Date("2026-05-13T10:05:00.000Z")
    });

    expect(explicit.selectedProviderId).toBe(ollamaProvider.id);
    expect(explicit.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: ollamaProvider.id,
          eligible: true,
          degraded: true,
          degradationReason: "rate_limited"
        })
      ])
    );
  });

  it("treats provider order as preference so cooldown can fall through to stable providers", () => {
    const degraded = recordProviderFailure({
      providerId: ollamaProvider.id,
      failure: { stderr: "HTTP 503 rate_limit" },
      now: new Date("2026-05-13T10:00:00.000Z")
    });

    const selected = selectProvider({
      roleId: "architect",
      providers: [ollamaProvider, claudeProvider],
      routingPolicy: {
        rolePins: {},
        providerOrder: ["family:ollama-claude-code"]
      },
      providerHealth: [degraded],
      now: new Date("2026-05-13T10:05:00.000Z")
    });

    expect(selected.id).toBe("claude-code-cli");
  });
});
