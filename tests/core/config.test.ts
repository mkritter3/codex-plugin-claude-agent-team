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
      auth: { allowApiKeyFallback: false }
    });
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
