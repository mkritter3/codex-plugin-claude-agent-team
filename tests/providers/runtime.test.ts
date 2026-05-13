import { describe, expect, it } from "vitest";
import {
  getProviderRuntime,
  listProviderRuntimes,
  requireProviderRuntime
} from "../../src/providers/index.js";
import { describeProviderRuntimeConformance } from "./conformance/runtime-conformance.js";

describe("provider runtime registry", () => {
  it("lists the bundled Claude Code CLI runtime", () => {
    expect(listProviderRuntimes().map((runtime) => runtime.id)).toEqual([
      "claude-code-cli",
      "openai-compatible",
      "ollama-claude-code",
      "gemini",
      "gemini-cli",
      "codex-cli"
    ]);
  });

  it("resolves the Claude runtime descriptor with subscription OAuth", () => {
    const runtime = getProviderRuntime("claude-code-cli");

    expect(runtime?.descriptor().authMode).toBe("subscription-oauth");
    expect(runtime?.descriptor().available).toBe(true);
  });

  it("resolves the OpenAI-compatible runtime as disabled by default", () => {
    const runtime = getProviderRuntime("openai-compatible");

    expect(runtime?.descriptor().authMode).toBe("api-key");
    expect(runtime?.descriptor().available).toBe(false);
  });

  it("resolves the Gemini runtime as disabled by default", () => {
    const runtime = getProviderRuntime("gemini");

    expect(runtime?.descriptor().authMode).toBe("api-key");
    expect(runtime?.descriptor().available).toBe(false);
  });

  it("resolves the Gemini CLI runtime as OAuth and disabled by default", () => {
    const runtime = getProviderRuntime("gemini-cli");

    expect(runtime?.descriptor().authMode).toBe("oauth");
    expect(runtime?.descriptor().available).toBe(false);
  });

  it("resolves the Codex CLI runtime as subscription OAuth and disabled by default", () => {
    const runtime = getProviderRuntime("codex-cli");

    expect(runtime?.descriptor().authMode).toBe("subscription-oauth");
    expect(runtime?.descriptor().available).toBe(false);
  });

  it("aliases Ollama Cloud profile provider ids to the OpenAI-compatible runtime", () => {
    const runtime = getProviderRuntime("ollama-cloud:kimi-k2.6");

    expect(runtime?.id).toBe("openai-compatible");
  });

  it("aliases Grok profile provider ids to the OpenAI-compatible runtime", () => {
    const runtime = getProviderRuntime("grok:grok-4.20-reasoning");

    expect(runtime?.id).toBe("openai-compatible");
  });

  it("aliases Ollama Claude Code profile provider ids to the scoped Claude Code runtime", () => {
    const runtime = getProviderRuntime("ollama-claude-code:kimi-k2.6");

    expect(runtime?.id).toBe("ollama-claude-code");
  });

  it("aliases Claude Code CLI model profile ids to the subscription OAuth Claude runtime", () => {
    const runtime = getProviderRuntime("claude-code-cli:opus");

    expect(runtime?.id).toBe("claude-code-cli");
  });

  it("fails closed when a selected provider has no runtime", () => {
    expect(() => requireProviderRuntime("missing-provider")).toThrow(
      "No provider runtime registered for missing-provider."
    );
  });

  it("exports the provider runtime conformance helper for future adapters", () => {
    expect(typeof describeProviderRuntimeConformance).toBe("function");
  });
});
