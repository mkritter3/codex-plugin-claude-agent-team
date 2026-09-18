import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function createLauncherFixture(input: {
  readonly nodeVersion: string;
  readonly packageRuntime?: boolean;
}): Promise<{
  readonly fakeBin: string;
  readonly invocationPath: string;
  readonly root: string;
  readonly scriptPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "agent-team-start-mcp-"));
  const fakeBin = join(root, "fake-bin");
  const scriptDir = join(root, "scripts");
  const invocationPath = join(root, "node-invocation.txt");
  await mkdir(fakeBin, { recursive: true });
  await mkdir(scriptDir, { recursive: true });
  await cp(join(process.cwd(), "scripts", "start-mcp.sh"), join(scriptDir, "start-mcp.sh"));

  await writeFile(
    join(fakeBin, "dirname"),
    [
      "#!/bin/sh",
      "case \"$1\" in",
      "  */*) printf '%s\\n' \"${1%/*}\" ;;",
      "  *) printf '.\\n' ;;",
      "esac"
    ].join("\n"),
    "utf8"
  );
  await chmod(join(fakeBin, "dirname"), 0o755);

  await writeFile(
    join(fakeBin, "node"),
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"-v\" ]; then",
      `  printf '%s\\n' '${input.nodeVersion}'`,
      "  exit 0",
      "fi",
      "printf '%s\\n' \"$@\" > \"$AGENT_TEAM_NODE_INVOCATION\"",
      "exit 0"
    ].join("\n"),
    "utf8"
  );
  await chmod(join(fakeBin, "node"), 0o755);

  if (input.packageRuntime !== false) {
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "index.js"), "export {};\n", "utf8");
  }

  return {
    fakeBin,
    invocationPath,
    root,
    scriptPath: join(scriptDir, "start-mcp.sh")
  };
}

describe("start-mcp launcher", () => {
  it("starts a packaged runtime without requiring npm", async () => {
    const fixture = await createLauncherFixture({ nodeVersion: "v22.15.3" });

    const result = spawnSync("/bin/sh", [fixture.scriptPath, "--probe"], {
      encoding: "utf8",
      env: {
        AGENT_TEAM_MCP_PATH_PREFIX: fixture.fakeBin,
        AGENT_TEAM_NODE_INVOCATION: fixture.invocationPath,
        PATH: ""
      }
    });

    expect(result.status).toBe(0);
    await expect(readFile(fixture.invocationPath, "utf8")).resolves.toContain(
      join(fixture.root, "dist", "index.js")
    );
    await expect(readFile(fixture.invocationPath, "utf8")).resolves.toContain("--probe");
  });

  it("fails clearly before launch when Node is older than the package engine", async () => {
    const fixture = await createLauncherFixture({ nodeVersion: "v20.11.1" });

    const result = spawnSync("/bin/sh", [fixture.scriptPath], {
      encoding: "utf8",
      env: {
        AGENT_TEAM_MCP_PATH_PREFIX: fixture.fakeBin,
        AGENT_TEAM_NODE_INVOCATION: fixture.invocationPath,
        PATH: ""
      }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Node.js 22+");
    await expect(readFile(fixture.invocationPath, "utf8")).rejects.toThrow();
  });
});
