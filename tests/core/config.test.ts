import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentTeamConfigError,
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "../../src/core/config.js";

describe("loadAgentTeamConfig", () => {
  it("defaults write mode and API-key fallback to disabled when config is missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));

    await expect(loadAgentTeamConfig(workspace)).resolves.toEqual(
      DEFAULT_AGENT_TEAM_CONFIG
    );
  });

  it("loads explicit isolated write mode without enabling API-key fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        writeMode: { enabled: true, requireIsolatedWorktree: true }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toEqual({
      writeMode: { enabled: true, requireIsolatedWorktree: true },
      auth: { allowApiKeyFallback: false },
      providers: DEFAULT_AGENT_TEAM_CONFIG.providers
    });
  });

  it("loads explicit OpenAI-compatible provider config without inferring env fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          openaiCompatible: {
            enabled: true,
            baseUrl: "https://ollama.example/v1",
            model: "kimi-k2.6",
            apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
            displayName: "Ollama Cloud",
            capabilities: {
              structuredOutput: true,
              longContext: true
            }
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        openaiCompatible: {
          enabled: true,
          baseUrl: "https://ollama.example/v1",
          model: "kimi-k2.6",
          apiKeyEnv: "OLLAMA_CLOUD_API_KEY",
          displayName: "Ollama Cloud",
          capabilities: {
            structuredOutput: true,
            longContext: true,
            reasoning: false
          }
        }
      }
    });
  });

  it("loads explicit Ollama Cloud profiles without inferring env fallback", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          ollamaCloud: {
            enabled: true,
            profiles: [
              {
                id: "kimi-k2.6",
                baseUrl: "https://ollama.example/v1",
                model: "kimi-k2.6",
                apiKeyEnv: "KIMI_API_KEY",
                displayName: "Kimi K2.6",
                capabilities: {
                  structuredOutput: true,
                  longContext: true
                }
              },
              {
                id: "glm-5.1",
                baseUrl: "https://ollama.example/v1",
                model: "glm-5.1",
                apiKeyEnv: "GLM_API_KEY",
                displayName: "GLM 5.1",
                capabilities: {
                  structuredOutput: true
                }
              }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
      providers: {
        ollamaCloud: {
          enabled: true,
          profiles: [
            {
              id: "kimi-k2.6",
              baseUrl: "https://ollama.example/v1",
              model: "kimi-k2.6",
              apiKeyEnv: "KIMI_API_KEY",
              displayName: "Kimi K2.6",
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
              displayName: "GLM 5.1",
              capabilities: {
                structuredOutput: true,
                longContext: false,
                reasoning: false
              }
            }
          ]
        }
      }
    });
  });

  it("rejects unsupported Ollama Cloud profile capabilities and duplicate ids", async () => {
    const unsupported = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(unsupported, ".agent-team"), { recursive: true });
    await writeFile(
      join(unsupported, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          ollamaCloud: {
            enabled: true,
            profiles: [
              {
                id: "kimi",
                baseUrl: "https://ollama.example/v1",
                model: "kimi-k2.6",
                apiKeyEnv: "KIMI_API_KEY",
                capabilities: { structuredOutput: true, tools: true }
              }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(unsupported)).rejects.toThrow(
      "Ollama Cloud profile kimi does not support capability tools"
    );

    const duplicate = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(duplicate, ".agent-team"), { recursive: true });
    await writeFile(
      join(duplicate, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          ollamaCloud: {
            enabled: true,
            profiles: [
              { id: "kimi", capabilities: { structuredOutput: true } },
              { id: "kimi", capabilities: { structuredOutput: true } }
            ]
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(duplicate)).rejects.toThrow(
      "Duplicate Ollama Cloud profile id: kimi"
    );
  });

  it("rejects unsupported OpenAI-compatible capability claims", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        providers: {
          openaiCompatible: {
            enabled: true,
            baseUrl: "https://api.example/v1",
            model: "model",
            apiKeyEnv: "EXAMPLE_API_KEY",
            capabilities: {
              structuredOutput: true,
              tools: true
            }
          }
        }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
      "OpenAI-compatible provider does not support capability tools"
    );
  });

  it("fails closed on invalid config JSON", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      "{ nope",
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
      AgentTeamConfigError
    );
  });

  it("rejects write mode without isolated worktrees", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        writeMode: { enabled: true, requireIsolatedWorktree: false }
      }),
      "utf8"
    );

    await expect(loadAgentTeamConfig(workspace)).rejects.toThrow(
      "requires isolated worktrees"
    );
  });
});
