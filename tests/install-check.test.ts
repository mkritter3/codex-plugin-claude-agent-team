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
    readonly mcpServers: Record<string, { command: string; args: readonly string[] }>;
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
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function createInstallFixture(input: {
  readonly runtime?: boolean;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-team-install-preflight-"));
  await mkdir(join(root, ".codex-plugin"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  if (input.runtime !== false) {
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "index.js"), "#!/usr/bin/env node\n");
  }
  await writeFile(join(root, "scripts", "install-check.mjs"), "#!/usr/bin/env node\n");
  await writeJson(join(root, "package.json"), {
    bin: { "agent-team-mcp": "./dist/index.js" }
  });
  await writeJson(join(root, ".codex-plugin", "plugin.json"), {
    mcpServers: "./.mcp.json"
  });
  await writeJson(join(root, ".mcp.json"), {
    mcpServers: {
      "agent-team": {
        command: "node",
        args: ["./dist/index.js"]
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
      command: "node",
      args: [join(fixtureRoot, "dist", "index.js")]
    });
    expect(report.checks.map((check) => check.id)).toEqual([
      "package-json",
      "plugin-manifest",
      "local-mcp-config",
      "runtime-entrypoint",
      "install-check-script",
      "running-mcp-processes"
    ]);
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
    expect(report.nextSteps).toContain(
      "Add mcpConfig.mcpServers.agent-team to the Codex MCP client configuration."
    );
    expect(JSON.stringify(report)).not.toMatch(
      /prompt|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
    );
  });

  it("returns blocked with per-check evidence when the built runtime is missing", async () => {
    const { buildInstallPreflightReport } = await loadPreflight();
    const fixtureRoot = await createInstallFixture({ runtime: false });

    const report = await buildInstallPreflightReport({
      packageRoot: fixtureRoot,
      serverName: "agent-team"
    });

    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        id: "runtime-entrypoint",
        status: "fail",
        path: join(fixtureRoot, "dist", "index.js")
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
      command: "node",
      args: [join(fixtureRoot, "dist", "index.js")]
    });
  });

  it("exits non-zero with a blocked CLI report when install checks fail", async () => {
    const fixtureRoot = await createInstallFixture({ runtime: false });

    const result = spawnSync(
      "node",
      ["scripts/install-check.mjs", "--package-root", fixtureRoot],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as InstallPreflightReport;
    expect(report.status).toBe("blocked");
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: "runtime-entrypoint", status: "fail" })
    );
  });
});
