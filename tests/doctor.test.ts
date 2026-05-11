import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor, type DoctorInput } from "../src/doctor.js";

function cliFound(): Pick<DoctorInput, "findExecutable" | "getVersion"> {
  return {
    findExecutable: async () => "/usr/local/bin/claude",
    getVersion: async () => "1.0.0"
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
        auth: { allowApiKeyFallback: false }
      }
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
