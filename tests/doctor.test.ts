import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor, type DoctorInput } from "../src/doctor.js";
import { stateLayoutPath } from "../src/core/state/paths.js";
import { upsertProviderHealthRecord } from "../src/core/state/provider-health-store.js";
import type { AgentProviderRuntime } from "../src/providers/index.js";

function cliFound(): Pick<DoctorInput, "findExecutable" | "getVersion" | "runProviderCommand"> {
  return {
    findExecutable: async () => "/usr/local/bin/claude",
    getVersion: async () => "1.0.0",
    runProviderCommand: async () => ({
      ok: true,
      stdout: "authenticated",
      stderr: "",
      exitCode: 0
    })
  };
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-team-doctor-"));
}

async function writeConfig(workspace: string, config: unknown): Promise<void> {
  await mkdir(join(workspace, ".agent-team"), { recursive: true });
  await writeFile(
    join(workspace, ".agent-team", "config.json"),
    typeof config === "string" ? config : JSON.stringify(config),
    "utf8"
  );
}

describe("runDoctor", () => {
  it("reports host Node runtime readiness", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      nodeVersion: "22.15.3",
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "node-version")).toMatchObject({
      status: "pass",
      details: {
        version: "22.15.3",
        required: ">=22"
      }
    });
  });

  it("reports MCP runtime metadata and direct schema compatibility", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      nodeVersion: "22.15.3",
      ...cliFound()
    });

    expect(report.checks.find((check) => check.id === "mcp-runtime")).toMatchObject({
      status: "pass",
      details: {
        pid: expect.any(Number),
        nodeVersion: "22.15.3",
        workflowWriteScopeAllowsEmpty: true
      }
    });
  });

  it("fails closed when host Node is below the runtime floor", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      nodeVersion: "20.11.1",
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "node-version")).toMatchObject({
      status: "fail",
      details: {
        version: "20.11.1",
        required: ">=22",
        fix: "Use Node.js 22 or newer to run the Agent Team MCP server."
      }
    });
  });

  it("fails closed when the MCP server module cannot be loaded", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound(),
      checkMcpServerLoadable: async () => {
        throw new Error("module import failed");
      }
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "mcp-server-loadable")).toMatchObject({
      status: "fail",
      details: {
        error: "module import failed",
        fix: "Run npm run build and verify the MCP server entrypoint can be imported."
      }
    });
  });

  it("reports provider runtime health checks", async () => {
    const workspace = await tempWorkspace();
    const commandResults: boolean[] = [];
    const healthWorkspaceRoots: string[] = [];
    const runtime: AgentProviderRuntime = {
      id: "fake-runtime",
      descriptor: () => ({
        id: "fake-runtime",
        displayName: "Fake Runtime",
        authMode: "subscription-oauth",
        capabilities: ["structuredOutput", "tools"],
        available: true
      }),
      inspectEnvironment: () => ({ warnings: [] }),
      async runPrint() {
        throw new Error("should not run");
      },
      startSession() {
        throw new Error("should not start");
      },
      async healthCheck(input) {
        const result = await input.runCommand("/bin/echo", ["ok"]);
        commandResults.push(result.ok);
        healthWorkspaceRoots.push(input.workspaceRoot);
        return [
          {
            id: "fake-runtime-health",
            status: "pass",
            message: "Fake runtime ready."
          }
        ];
      }
    };

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      providers: [runtime.descriptor()],
      runtimes: [runtime]
    });

    expect(report.checks.find((check) => check.id === "fake-runtime-health")).toMatchObject({
      status: "pass",
      message: "Fake runtime ready."
    });
    expect(commandResults).toEqual([true]);
    expect(healthWorkspaceRoots).toEqual([workspace]);
  });

  it("fails closed when a configured provider has no runtime", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      providers: [
        {
          id: "missing-runtime",
          displayName: "Missing Runtime",
          authMode: "subscription-oauth",
          capabilities: ["structuredOutput", "tools"],
          available: true
        }
      ],
      runtimes: []
    });

    expect(report.ok).toBe(false);
    expect(
      report.checks.find((check) => check.id === "provider-runtime:missing-runtime")
    ).toMatchObject({
      status: "fail"
    });
  });

  it("uses runtime environment inspection for auth precedence", async () => {
    const workspace = await tempWorkspace();
    const runtime: AgentProviderRuntime = {
      id: "fake-runtime",
      descriptor: () => ({
        id: "fake-runtime",
        displayName: "Fake Runtime",
        authMode: "subscription-oauth",
        capabilities: ["structuredOutput", "tools"],
        available: true
      }),
      inspectEnvironment: () => ({
        warnings: ["Fake runtime API key would override subscription OAuth."]
      }),
      async runPrint() {
        throw new Error("should not run");
      },
      startSession() {
        throw new Error("should not start");
      },
      async healthCheck() {
        return [];
      }
    };

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      providers: [runtime.descriptor()],
      runtimes: [runtime]
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "fail",
      details: { warnings: ["Fake runtime API key would override subscription OAuth."] }
    });
  });

  it("reports missing Claude CLI without throwing", async () => {
    const workspace = await tempWorkspace();
    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      findExecutable: async () => undefined,
      getVersion: async () => undefined
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "claude-cli")?.status).toBe(
      "fail"
    );
  });

  it("fails closed when subscription auth may be overridden without explicit API fallback", async () => {
    const workspace = await tempWorkspace();
    const report = await runDoctor({
      workspaceRoot: workspace,
      env: { ANTHROPIC_API_KEY: "secret" },
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "fail"
    });
    expect(report.warnings).toContain(
      "ANTHROPIC_API_KEY is set and may override Claude Code subscription OAuth."
    );
  });

  it("warns instead of failing when API fallback is explicitly allowed", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      auth: { allowApiKeyFallback: true }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: { ANTHROPIC_AUTH_TOKEN: "token" },
      ...cliFound()
    });

    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "warn"
    });
    expect(report.ok).toBe(true);
  });

  it("reports default config details when config is missing", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.checks.find((check) => check.id === "config")).toMatchObject({
      status: "pass",
      details: {
        writeMode: { enabled: false, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        providers: {
          openaiCompatible: {
            enabled: false,
            hasBaseUrl: false,
            hasModel: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          },
          ollamaCloud: {
            enabled: false,
            profileCount: 0
          },
          grok: {
            enabled: false,
            profileCount: 0
          },
          gemini: {
            enabled: false,
            hasBaseUrl: false,
            hasModel: false,
            capabilities: {
              structuredOutput: false,
              longContext: false,
              reasoning: false
            }
          }
        }
      }
    });
    expect(report.checks.some((check) => check.id.startsWith("openai-compatible"))).toBe(
      false
    );
    expect(report.checks.find((check) => check.id === "role-routing:planner")).toMatchObject({
      status: "pass",
      details: {
        provider: "claude-code-cli",
        selection: {
          ok: true,
          selectedProviderId: "claude-code-cli",
          requiredCapabilities: ["structuredOutput"],
          candidates: [
            expect.objectContaining({
              providerId: "claude-code-cli",
              eligible: true
            })
          ]
        }
      }
    });
  });

  it("reports config schema and missing state layout upgrade posture", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "config-schema")).toMatchObject({
      status: "pass",
      message: "Agent Team config schema version is supported.",
      details: {
        schemaVersion: 1,
        supportedVersion: 1
      }
    });
    expect(report.checks.find((check) => check.id === "state-layout")).toMatchObject({
      status: "pass",
      message: "State layout marker is missing; layout version 1 can be initialized.",
      details: {
        status: "missing",
        currentVersion: 1,
        path: stateLayoutPath(workspace)
      }
    });
  });

  it("fails doctor when state layout marker is newer than this runtime supports", async () => {
    const workspace = await tempWorkspace();
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(stateLayoutPath(workspace), JSON.stringify({ layoutVersion: 2 }), "utf8");

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "state-layout")).toMatchObject({
      status: "fail",
      details: {
        reason: "state_layout_incompatible",
        observedVersion: 2,
        currentVersion: 1,
        path: stateLayoutPath(workspace)
      }
    });
  });

  it("fails doctor when state layout marker is corrupt", async () => {
    const workspace = await tempWorkspace();
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(stateLayoutPath(workspace), "{ nope", "utf8");

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "state-layout")).toMatchObject({
      status: "fail",
      details: {
        reason: "state_layout_corrupt",
        currentVersion: 1,
        path: stateLayoutPath(workspace)
      }
    });
  });

  it("fails role routing with selector evidence when a role pin is unroutable", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      routing: {
        rolePins: {
          planner: "family:grok"
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "role-routing:planner")).toMatchObject({
      status: "fail",
      details: {
        role: "planner",
        selection: {
          ok: false,
          selector: {
            source: "role-pin",
            value: "family:grok",
            kind: "family"
          },
          candidates: [
            expect.objectContaining({
              providerId: "claude-code-cli",
              matchedSelector: false,
              rejectionReason: "selector_mismatch"
            })
          ]
        }
      }
    });
  });

  it("reports explicit OpenAI-compatible config and missing provider auth env", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        openaiCompatible: {
          enabled: true,
          baseUrl: "https://api.example/v1",
          model: "review-model",
          apiKeyEnv: "REVIEW_MODEL_API_KEY",
          capabilities: { structuredOutput: true }
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "openai-compatible-config")).toMatchObject({
      status: "pass",
      details: {
        hasBaseUrl: true,
        hasModel: true,
        hasApiKeyEnv: true
      }
    });
    expect(
      report.checks.find((check) => check.id === "openai-compatible-auth-env")
    ).toMatchObject({
      status: "fail",
      message: "OpenAI-compatible provider auth env REVIEW_MODEL_API_KEY is missing.",
      details: { env: "REVIEW_MODEL_API_KEY", present: false }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("does not treat provider-scoped OpenAI-compatible API keys as Claude fallback", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        openaiCompatible: {
          enabled: true,
          baseUrl: "https://api.example/v1",
          model: "review-model",
          apiKeyEnv: "REVIEW_MODEL_API_KEY",
          capabilities: { structuredOutput: true }
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: { REVIEW_MODEL_API_KEY: "secret-token" },
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "openai-compatible-auth-env")
    ).toMatchObject({
      status: "pass",
      details: { env: "REVIEW_MODEL_API_KEY", present: true }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("reports explicit Ollama Cloud profile config and missing provider auth env", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        ollamaCloud: {
          enabled: true,
          profiles: [
            {
              id: "kimi-k2.6",
              baseUrl: "https://ollama.example/v1",
              model: "kimi-k2.6",
              apiKeyEnv: "KIMI_API_KEY",
              capabilities: { structuredOutput: true, longContext: true }
            }
          ]
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "ollama-cloud:kimi-k2.6:config")).toMatchObject({
      status: "pass",
      details: {
        providerId: "ollama-cloud:kimi-k2.6",
        hasBaseUrl: true,
        hasModel: true,
        hasApiKeyEnv: true
      }
    });
    expect(
      report.checks.find((check) => check.id === "ollama-cloud:kimi-k2.6:auth-env")
    ).toMatchObject({
      status: "fail",
      message: "Ollama Cloud profile kimi-k2.6 auth env KIMI_API_KEY is missing.",
      details: { env: "KIMI_API_KEY", present: false }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("does not treat provider-scoped Ollama Cloud API keys as Claude fallback", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        ollamaCloud: {
          enabled: true,
          profiles: [
            {
              id: "glm-5.1",
              baseUrl: "https://ollama.example/v1",
              model: "glm-5.1",
              apiKeyEnv: "GLM_API_KEY",
              capabilities: { structuredOutput: true }
            }
          ]
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: { GLM_API_KEY: "secret-token" },
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "ollama-cloud:glm-5.1:auth-env")
    ).toMatchObject({
      status: "pass",
      details: { env: "GLM_API_KEY", present: true }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("reports explicit Ollama Claude Code config and missing shared auth env", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        ollamaClaudeCode: {
          enabled: true,
          baseUrl: "https://ollama.com",
          apiKeyEnv: "OLLAMA_API_KEY",
          profiles: [
            {
              id: "kimi-k2.6",
              model: "kimi-k2.6",
              displayName: "Kimi K2.6",
              capabilities: { structuredOutput: true, longContext: true, reasoning: true }
            }
          ]
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "config")).toMatchObject({
      details: {
        providers: {
          ollamaClaudeCode: {
            enabled: true,
            hasBaseUrl: true,
            apiKeyEnv: "OLLAMA_API_KEY",
            profileCount: 1
          }
        }
      }
    });
    expect(
      report.checks.find((check) => check.id === "ollama-claude-code:kimi-k2.6:config")
    ).toMatchObject({
      status: "pass",
      details: {
        providerId: "ollama-claude-code:kimi-k2.6",
        hasBaseUrl: true,
        hasModel: true,
        apiKeyEnv: "OLLAMA_API_KEY"
      }
    });
    expect(
      report.checks.find((check) => check.id === "ollama-claude-code:kimi-k2.6:auth-env")
    ).toMatchObject({
      status: "fail",
      message: "Ollama Claude Code profile Kimi K2.6 auth env OLLAMA_API_KEY is missing.",
      details: { env: "OLLAMA_API_KEY", present: false }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("does not treat scoped Ollama Claude Code Anthropic env as Claude subscription fallback", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        ollamaClaudeCode: {
          enabled: true,
          baseUrl: "https://ollama.com",
          profiles: [
            {
              id: "glm-5.1",
              model: "glm-5.1",
              capabilities: { structuredOutput: true }
            }
          ]
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {
        OLLAMA_API_KEY: "secret-token"
      },
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "ollama-claude-code:glm-5.1:auth-env")
    ).toMatchObject({
      status: "pass",
      details: { env: "OLLAMA_API_KEY", present: true }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("reports explicit Grok profile config and missing provider auth env", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        grok: {
          enabled: true,
          profiles: [
            {
              id: "grok-4.20-reasoning",
              baseUrl: "https://api.x.ai/v1",
              model: "grok-4.20",
              apiKeyEnv: "XAI_API_KEY",
              capabilities: { structuredOutput: true, longContext: true, reasoning: true }
            }
          ]
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(
      report.checks.find((check) => check.id === "grok:grok-4.20-reasoning:config")
    ).toMatchObject({
      status: "pass",
      details: {
        providerId: "grok:grok-4.20-reasoning",
        hasBaseUrl: true,
        hasModel: true,
        hasApiKeyEnv: true
      }
    });
    expect(
      report.checks.find((check) => check.id === "grok:grok-4.20-reasoning:auth-env")
    ).toMatchObject({
      status: "fail",
      message: "Grok profile grok-4.20-reasoning auth env XAI_API_KEY is missing.",
      details: { env: "XAI_API_KEY", present: false }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("does not treat provider-scoped Grok API keys as Claude fallback", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        grok: {
          enabled: true,
          profiles: [
            {
              id: "grok-4.20-reasoning",
              baseUrl: "https://api.x.ai/v1",
              model: "grok-4.20",
              apiKeyEnv: "XAI_API_KEY",
              capabilities: { structuredOutput: true, longContext: true }
            }
          ]
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: { XAI_API_KEY: "secret-token" },
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "grok:grok-4.20-reasoning:auth-env")
    ).toMatchObject({
      status: "pass",
      details: { env: "XAI_API_KEY", present: true }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("reports explicit Gemini config and missing provider auth env", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        gemini: {
          enabled: true,
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-3-pro-preview",
          apiKeyEnv: "GEMINI_API_KEY",
          capabilities: { structuredOutput: true, longContext: true }
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "gemini-config")).toMatchObject({
      status: "pass",
      details: {
        providerId: "gemini",
        hasBaseUrl: true,
        hasModel: true,
        hasApiKeyEnv: true
      }
    });
    expect(report.checks.find((check) => check.id === "gemini-auth-env")).toMatchObject({
      status: "fail",
      message: "Gemini provider auth env GEMINI_API_KEY is missing.",
      details: { env: "GEMINI_API_KEY", present: false }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("reports Gemini CLI OAuth readiness without requiring an API key", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        geminiCli: {
          enabled: true,
          executable: "gemini",
          model: "gemini-3-pro-preview",
          projectEnv: "GOOGLE_CLOUD_PROJECT",
          capabilities: { structuredOutput: true, longContext: true, reasoning: true }
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: { GOOGLE_CLOUD_PROJECT: "project-id", GEMINI_API_KEY: "ignored-provider-key" },
      findExecutable: async (name) => (name === "gemini" || name === "claude" ? `/usr/local/bin/${name}` : undefined),
      getVersion: async (path) => `${path} 1.0.0`,
      runProviderCommand: async () => ({
        ok: true,
        stdout: "authenticated",
        stderr: "",
        exitCode: 0
      })
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "gemini-cli-config")).toMatchObject({
      status: "pass",
      details: {
        providerId: "gemini-cli",
        hasModel: true,
        executable: "gemini",
        projectEnv: "GOOGLE_CLOUD_PROJECT"
      }
    });
    expect(report.checks.find((check) => check.id === "gemini-cli-executable")).toMatchObject({
      status: "pass"
    });
    expect(report.checks.find((check) => check.id === "gemini-cli-project-env")).toMatchObject({
      status: "pass",
      details: { env: "GOOGLE_CLOUD_PROJECT", present: true }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("reports provider cooldown evidence and routes around degraded providers", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        ollamaClaudeCode: {
          enabled: true,
          baseUrl: "https://ollama.example",
          apiKeyEnv: "OLLAMA_API_KEY",
          profiles: [
            {
              id: "kimi-k2.6",
              model: "kimi-k2.6",
              capabilities: { structuredOutput: true, longContext: true }
            }
          ]
        }
      }
    });
    await upsertProviderHealthRecord(workspace, {
      providerId: "ollama-claude-code:kimi-k2.6",
      status: "degraded",
      reason: "rate_limited",
      failureCount: 2,
      updatedAt: "2026-05-13T10:00:00.000Z",
      degradedUntil: "2099-05-13T10:30:00.000Z",
      evidencePaths: ["/tmp/run.log"]
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: { OLLAMA_API_KEY: "secret-token" },
      ...cliFound()
    });

    expect(report.checks.find((check) => check.id === "provider-health")).toMatchObject({
      status: "warn",
      message: "Provider health has active degradation records.",
      details: {
        degradedProviders: [
          expect.objectContaining({
            providerId: "ollama-claude-code:kimi-k2.6",
            reason: "rate_limited",
            failureCount: 2
          })
        ]
      }
    });
    expect(report.checks.find((check) => check.id === "role-routing:architect")).toMatchObject({
      status: "pass",
      details: {
        selection: {
          candidates: expect.arrayContaining([
            expect.objectContaining({
              providerId: "ollama-claude-code:kimi-k2.6",
              rejectionReason: "degraded"
            })
          ])
        }
      }
    });
  });

  it("does not treat provider-scoped Gemini API keys as Claude fallback", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      providers: {
        gemini: {
          enabled: true,
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          model: "gemini-3-pro-preview",
          apiKeyEnv: "GEMINI_API_KEY",
          capabilities: { structuredOutput: true }
        }
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: { GEMINI_API_KEY: "secret-token" },
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "gemini-auth-env")).toMatchObject({
      status: "pass",
      details: { env: "GEMINI_API_KEY", present: true }
    });
    expect(report.checks.find((check) => check.id === "auth-precedence")).toMatchObject({
      status: "pass"
    });
  });

  it("fails doctor when workspace config is invalid", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, "{ nope");

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "config")).toMatchObject({
      status: "fail"
    });
  });

  it("fails doctor when state directory is not writable", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound(),
      ensureWritableState: async () => {
        throw new Error("permission denied");
      }
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "state-writable")).toMatchObject({
      status: "fail",
      details: { error: "permission denied" }
    });
  });

  it("checks git worktree support when isolated write mode is enabled", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      writeMode: { enabled: true, requireIsolatedWorktree: true }
    });
    const inspected: string[] = [];

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound(),
      inspectGitWorktreeSupport: async ({ workspaceRoot }) => {
        inspected.push(workspaceRoot);
        return {
          ok: true,
          gitVersion: "git version 2.50.0",
          sourceRoot: workspace,
          worktreeList: "worktree repo"
        };
      }
    });

    expect(inspected).toEqual([workspace]);
    expect(report.checks.find((check) => check.id === "git-worktree")).toMatchObject({
      status: "pass",
      details: {
        gitVersion: "git version 2.50.0",
        sourceRoot: workspace
      }
    });
  });

  it("reports policy posture without exposing provider implementation details", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      policy: {
        allowedRoles: ["planner", "code-reviewer"],
        allowedProviderSelectors: ["claude-code-cli", "family:grok"],
        allowWriteMode: true,
        allowedWorktreeRoots: ["/tmp/.agent-team-worktrees"],
        liveSmokeEnabled: true,
        auditEnabled: true
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === "policy")).toMatchObject({
      status: "pass",
      message: "Agent Team policy posture is compatible with workspace config.",
      details: {
        allowedRoles: ["planner", "code-reviewer"],
        allowedProviderSelectors: ["claude-code-cli", "family:grok"],
        allowWriteMode: true,
        allowedWorktreeRoots: ["/tmp/.agent-team-worktrees"],
        liveSmokeEnabled: true,
        auditEnabled: true
      }
    });
    expect(JSON.stringify(report.checks.find((check) => check.id === "policy"))).not.toMatch(
      /prompt|providerSessionId|command|payload|secret/i
    );
  });

  it("fails doctor when write mode is enabled but policy forbids write-capable starts", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      writeMode: { enabled: true, requireIsolatedWorktree: true },
      policy: {
        allowWriteMode: false
      }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound(),
      inspectGitWorktreeSupport: async () => ({ ok: true })
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "policy")).toMatchObject({
      status: "fail",
      details: {
        reason: "write_mode_not_allowed"
      }
    });
  });

  it("does not require git worktree support when write mode is disabled", async () => {
    const workspace = await tempWorkspace();
    let called = false;

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound(),
      inspectGitWorktreeSupport: async () => {
        called = true;
        return { ok: false, message: "should not be required" };
      }
    });

    expect(called).toBe(false);
    expect(report.checks.find((check) => check.id === "git-worktree")).toMatchObject({
      status: "pass",
      message: "Git worktree support is not required while write mode is disabled."
    });
  });

  it("reports slice implementer routing as a warning until write mode is enabled", async () => {
    const workspace = await tempWorkspace();

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound()
    });

    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "role-routing:planner")
    ).toMatchObject({
      status: "pass"
    });
    expect(
      report.checks.find((check) => check.id === "role-routing:slice-implementer")
    ).toMatchObject({
      status: "warn",
      message: "slice-implementer is unavailable until isolated write mode is enabled."
    });
  });

  it("fails slice implementer routing when write mode is enabled but no provider can satisfy it", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      writeMode: { enabled: true, requireIsolatedWorktree: true }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound(),
      providers: [],
      inspectGitWorktreeSupport: async () => ({ ok: true })
    });

    expect(report.ok).toBe(false);
    expect(
      report.checks.find((check) => check.id === "role-routing:slice-implementer")
    ).toMatchObject({
      status: "fail"
    });
  });

  it("passes slice implementer routing when write mode enables edit-capable Claude provider", async () => {
    const workspace = await tempWorkspace();
    await writeConfig(workspace, {
      writeMode: { enabled: true, requireIsolatedWorktree: true }
    });

    const report = await runDoctor({
      workspaceRoot: workspace,
      env: {},
      ...cliFound(),
      inspectGitWorktreeSupport: async () => ({ ok: true })
    });

    expect(report.ok).toBe(true);
    expect(
      report.checks.find((check) => check.id === "role-routing:slice-implementer")
    ).toMatchObject({
      status: "pass",
      details: { provider: "claude-code-cli" }
    });
  });
});
