import { describe, expect, it } from "vitest";
import { ProviderCapabilityError } from "../../src/core/errors.js";
import { selectProvider } from "../../src/core/router.js";
import type { AgentProviderDescriptor } from "../../src/core/types.js";

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
});
