import { describe, expect, it } from "vitest";
import {
  getProviderRuntime,
  listProviderRuntimes,
  requireProviderRuntime
} from "../../src/providers/index.js";

describe("provider runtime registry", () => {
  it("lists the bundled Claude Code CLI runtime", () => {
    expect(listProviderRuntimes().map((runtime) => runtime.id)).toEqual([
      "claude-code-cli"
    ]);
  });

  it("resolves the Claude runtime descriptor with subscription OAuth", () => {
    const runtime = getProviderRuntime("claude-code-cli");

    expect(runtime?.descriptor().authMode).toBe("subscription-oauth");
    expect(runtime?.descriptor().available).toBe(true);
  });

  it("fails closed when a selected provider has no runtime", () => {
    expect(() => requireProviderRuntime("missing-provider")).toThrow(
      "No provider runtime registered for missing-provider."
    );
  });
});
