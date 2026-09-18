import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

async function loadNativeMcpConfig(): Promise<{
  readNativeMcpServerConfig(input: {
    readonly pluginRoot: string;
    readonly serverName: string;
    readonly hostCwd: string;
  }): Promise<{
    readonly args: readonly string[];
    readonly command: string;
    readonly cwd: string;
    readonly startup_timeout_sec?: number;
  }>;
}> {
  return (await import(
    pathToFileURL(join(process.cwd(), "scripts/lib/native-mcp-config.mjs")).href
  )) as {
    readNativeMcpServerConfig(input: {
      readonly pluginRoot: string;
      readonly serverName: string;
      readonly hostCwd: string;
    }): Promise<{
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string;
      readonly startup_timeout_sec?: number;
    }>;
  };
}

async function writeMcpJson(pluginRoot: string, server: unknown): Promise<void> {
  await writeFile(
    join(pluginRoot, ".mcp.json"),
    `${JSON.stringify({ mcpServers: { "agent-team": server } }, null, 2)}\n`,
    "utf8"
  );
}

describe("native MCP config resolution", () => {
  it("resolves plugin-relative cwd from an unrelated host cwd", async () => {
    const { readNativeMcpServerConfig } = await loadNativeMcpConfig();
    const pluginRoot = await mkdtemp(join(tmpdir(), "agent-team-plugin-root-"));
    const hostCwd = await mkdtemp(join(tmpdir(), "agent-team-host-cwd-"));
    await writeMcpJson(pluginRoot, {
      command: "sh",
      args: ["./scripts/start-mcp.sh"],
      cwd: ".",
      startup_timeout_sec: 120
    });

    await expect(
      readNativeMcpServerConfig({ pluginRoot, serverName: "agent-team", hostCwd })
    ).resolves.toEqual({
      command: "sh",
      args: ["./scripts/start-mcp.sh"],
      cwd: pluginRoot,
      startup_timeout_sec: 120
    });
  });

  it("falls back to the host cwd when the plugin config omits cwd", async () => {
    const { readNativeMcpServerConfig } = await loadNativeMcpConfig();
    const pluginRoot = await mkdtemp(join(tmpdir(), "agent-team-plugin-root-"));
    const hostCwd = await mkdtemp(join(tmpdir(), "agent-team-host-cwd-"));
    await writeMcpJson(pluginRoot, {
      command: "sh",
      args: ["./scripts/start-mcp.sh"]
    });

    await expect(
      readNativeMcpServerConfig({ pluginRoot, serverName: "agent-team", hostCwd })
    ).resolves.toEqual({
      command: "sh",
      args: ["./scripts/start-mcp.sh"],
      cwd: hostCwd
    });
  });

  it("rejects non-stdio native MCP server shapes", async () => {
    const { readNativeMcpServerConfig } = await loadNativeMcpConfig();
    const pluginRoot = await mkdtemp(join(tmpdir(), "agent-team-plugin-root-"));
    const hostCwd = await mkdtemp(join(tmpdir(), "agent-team-host-cwd-"));
    await mkdir(join(pluginRoot, "scripts"), { recursive: true });
    await writeMcpJson(pluginRoot, {
      type: "http",
      url: "https://example.test/mcp"
    });

    await expect(
      readNativeMcpServerConfig({ pluginRoot, serverName: "agent-team", hostCwd })
    ).rejects.toThrow("must declare a stdio command");
  });
});
