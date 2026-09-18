import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

interface InstallCheck {
  readonly id: string;
  readonly status: "pass" | "fail";
  readonly path: string;
  readonly message?: string;
  readonly details?: Record<string, unknown>;
}

interface InstallPreflightReport {
  readonly status: "ready" | "blocked";
  readonly packageRoot: string;
  readonly serverName: string;
  readonly mcpConfig: {
    readonly mcpServers: Record<
      string,
      { command: string; args: readonly string[]; startup_timeout_sec: number }
    >;
  };
  readonly checks: readonly InstallCheck[];
  readonly nextSteps: readonly string[];
}

async function loadPreflight(): Promise<{
  buildInstallPreflightReport(input: {
    readonly packageRoot: string;
    readonly serverName?: string;
    readonly listServerProcesses?: () => Promise<
      readonly { readonly pid: number; readonly command: string }[]
    >;
  }): Promise<InstallPreflightReport>;
  parseAgentTeamServerProcessList(stdout: string): readonly {
    readonly pid: number;
    readonly command: string;
  }[];
}> {
  return (await import(
    pathToFileURL(join(repoRoot, "scripts/lib/install-preflight.mjs")).href
  )) as {
    buildInstallPreflightReport(input: {
      readonly packageRoot: string;
      readonly serverName?: string;
      readonly listServerProcesses?: () => Promise<
        readonly { readonly pid: number; readonly command: string }[]
      >;
    }): Promise<InstallPreflightReport>;
    parseAgentTeamServerProcessList(stdout: string): readonly {
      readonly pid: number;
      readonly command: string;
    }[];
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function createInstallFixture(input: {
  readonly runtime?: boolean;
  readonly buildInputs?: boolean;
  readonly lockfile?: boolean | "malformed";
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-team-install-preflight-"));
  await mkdir(join(root, ".codex-plugin"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  if (input.runtime !== false) {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "index.js"), "#!/usr/bin/env node\n");
  }
  await writeFile(join(root, "scripts", "install-check.mjs"), "#!/usr/bin/env node\n");
  await writeFile(join(root, "scripts", "start-mcp.sh"), "#!/bin/sh\n");
  if (input.buildInputs === true) {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export {};\n");
    await writeFile(join(root, "tsconfig.build.json"), "{}\n");
  }
  if (input.lockfile === "malformed") {
    await writeFile(join(root, "npm-shrinkwrap.json"), "{not valid json");
  } else if (input.lockfile !== false) {
    await writeJson(join(root, "npm-shrinkwrap.json"), {
      name: "codex-plugin-claude-agent-team",
      version: "0.1.5",
      lockfileVersion: 3,
      packages: {}
    });
  }
  await writeJson(join(root, "package.json"), {
    bin: { "agent-team-mcp": "./dist/index.js" }
  });
  await writeJson(join(root, ".codex-plugin", "plugin.json"), {
    mcpServers: "./.mcp.json"
  });
  await writeJson(join(root, ".mcp.json"), {
    mcpServers: {
      "agent-team": {
        command: "sh",
        args: ["./scripts/start-mcp.sh"],
        cwd: ".",
        startup_timeout_sec: 120
      }
    }
  });
  return root;
}

describe("install handoff preflight", () => {
  it("builds a sanitized ready report with an absolute MCP config", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture();

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("ready");
    expect(report.packageRoot).toBe(fixtureRoot);
    expect(report.serverName).toBe("agent-team");
    expect(report.mcpConfig.mcpServers["agent-team"]).toEqual({
      command: "sh",
      args: [join(fixtureRoot, "scripts", "start-mcp.sh")],
      startup_timeout_sec: 120
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "package-json",
      "plugin-manifest",
      "local-mcp-config",
      "first-run-launcher",
      "first-run-lockfile",
      "runtime-build-cache",
      "install-check-script",
      "running-mcp-processes"
    ]);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.nextSteps).toContain(
      "Install or update codex-plugin-claude-agent-team through the local-plugins marketplace, then run /reload-plugins or start a fresh Codex session."
    );
    expect(report.nextSteps).toContain(
      "Use mcpConfig only as a fallback for MCP hosts that do not support Codex plugins."
    );
    expect(JSON.stringify(report)).not.toMatch(
      /prompt|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
    );
  });

  it("blocks native plugin MCP configs that omit the plugin-root cwd", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture();
    await writeJson(join(fixtureRoot, ".mcp.json"), {
      mcpServers: {
        "agent-team": {
          command: "sh",
          args: ["./scripts/start-mcp.sh"]
        }
      }
    });

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "local-mcp-config",
        status: "fail",
        path: join(fixtureRoot, ".mcp.json")
      })
    );
  });

  it("blocks native plugin MCP configs that omit the first-run startup timeout", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture();
    await writeJson(join(fixtureRoot, ".mcp.json"), {
      mcpServers: {
        "agent-team": {
          command: "sh",
          args: ["./scripts/start-mcp.sh"],
          cwd: "."
        }
      }
    });

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "local-mcp-config",
        status: "fail",
        path: join(fixtureRoot, ".mcp.json")
      })
    );
  });

  it("returns ready with first-run build evidence when source build inputs are present", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture({ runtime: false, buildInputs: true });

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("ready");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "runtime-build-cache",
        status: "pass",
        path: join(fixtureRoot, "dist", "index.js"),
        details: expect.objectContaining({
          builtRuntimePresent: false,
          buildInputsPresent: true
        })
      })
    );
  });

  it("blocks package surfaces missing a valid first-run lockfile", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture({ lockfile: false });

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "first-run-lockfile",
        status: "fail",
        path: join(fixtureRoot, "npm-shrinkwrap.json")
      })
    );
  });

  it("blocks package surfaces with malformed first-run shrinkwrap", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture({ lockfile: "malformed" });

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "first-run-lockfile",
        status: "fail",
        path: join(fixtureRoot, "npm-shrinkwrap.json")
      })
    );
    expect(JSON.stringify(report)).not.toContain("not valid json");
  });

  it("blocks package surfaces missing both built runtime and build inputs", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture({ runtime: false });

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "runtime-build-cache",
        status: "fail",
        details: expect.objectContaining({
          builtRuntimePresent: false,
          buildInputsPresent: false
        })
      })
    );
  });

  it("warns with sanitized evidence when stale Agent Team MCP server processes are running", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture();

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team",
      listServerProcesses: async () => [
        {
          pid: 12345,
          command: `node ${join(fixtureRoot, "dist", "index.js")}`
        },
        {
          pid: 67890,
          command: `node ${join(fixtureRoot, "dist", "index.js")} --old`
        }
      ]
    });

    expect(report.status).toBe("ready");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "running-mcp-processes",
        status: "pass",
        details: {
          runningProcessCount: 2,
          message:
            "Existing Agent Team MCP server processes may keep serving old schemas until Codex reloads or restarts them."
        }
      })
    );
    const processCheck = report.checks.find((check) => check.id === "running-mcp-processes");
    expect(JSON.stringify(processCheck?.details)).not.toContain("12345");
    expect(JSON.stringify(processCheck?.details)).not.toContain("67890");
    expect(JSON.stringify(processCheck?.details)).not.toContain(fixtureRoot);
  });

  it("detects stale versioned cache MCP server processes", async () => {
    const { parseAgentTeamServerProcessList } = await loadPreflight();

    const processes = parseAgentTeamServerProcessList(
      [
        " 1174 node /Users/example/.codex/plugins/cache/local-plugins/codex-plugin-claude-agent-team/0.1.0+stale/dist/index.js",
        " 96345 /opt/homebrew/bin/node /Users/example/.codex/plugins/cache/local-plugins/codex-plugin-claude-agent-team/0.1.3/dist/index.js",
        " 1111 node /Users/example/local-coding/plugins/codex-plugin-claude-agent-team/dist/index.js",
        " 2222 rg codex-plugin-claude-agent-team/0.1.3/dist/index.js"
      ].join("\n")
    );

    expect(processes.map((process) => process.pid)).toEqual([1174, 96345, 1111]);
  });

  it("returns blocked with sanitized evidence when local MCP config is malformed", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture();
    await writeFile(join(fixtureRoot, ".mcp.json"), "{not valid json");

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "local-mcp-config",
        status: "fail",
        path: join(fixtureRoot, ".mcp.json")
      })
    );
    expect(JSON.stringify(report)).not.toContain("not valid json");
  });

  it("rejects invalid server names before building config output", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture();

    await expect(
      buildInstallPreflightReport({ packageRoot: fixtureRoot, serverName: "../bad" })
    ).rejects.toThrow("server name");
  });

  it("prints a ready install report from the CLI", async () => {
    const fixtureRoot = await createInstallFixture();

    const result = spawnSync(
      "node",
      ["scripts/install-check.mjs", "--package-root", fixtureRoot],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as InstallPreflightReport;
    expect(report.status).toBe("ready");
    expect(report.mcpConfig.mcpServers["agent-team"]).toEqual({
      command: "sh",
      args: [join(fixtureRoot, "scripts", "start-mcp.sh")],
      startup_timeout_sec: 120
    });
  });

  it("prints a ready CLI report before the first runtime build", async () => {
    const fixtureRoot = await createInstallFixture({ runtime: false, buildInputs: true });

    const result = spawnSync(
      "node",
      ["scripts/install-check.mjs", "--package-root", fixtureRoot],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as InstallPreflightReport;
    expect(report.status).toBe("ready");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "runtime-build-cache",
        status: "pass",
        details: expect.objectContaining({
          builtRuntimePresent: false,
          buildInputsPresent: true
        })
      })
    );
  });
});
