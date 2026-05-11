import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeCliRuntime } from "../../../src/providers/claude-code-cli/runtime.js";

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-team-runtime-health-"));
}

describe("Claude Code CLI runtime health", () => {
  it("checks Claude CLI auth status through the injected command runner", async () => {
    const root = await workspace();
    const calls: Array<{ path: string; args: readonly string[] }> = [];

    const checks = await claudeCodeCliRuntime.healthCheck({
      workspaceRoot: root,
      env: {},
      findExecutable: async () => "/usr/local/bin/claude",
      getVersion: async () => "1.0.0",
      runCommand: async (path, args) => {
        calls.push({ path, args });
        return { ok: true, stdout: "authenticated", stderr: "", exitCode: 0 };
      }
    });

    expect(calls).toEqual([
      { path: "/usr/local/bin/claude", args: ["auth", "status"] }
    ]);
    expect(checks.find((check) => check.id === "claude-auth")).toMatchObject({
      status: "pass",
      details: { command: "claude auth status" }
    });
    expect(checks.find((check) => check.id === "claude-agent-definitions")).toMatchObject({
      status: "pass",
      details: { count: 7 }
    });
  });

  it("generates workspace-local Claude agent definition artifacts during health checks", async () => {
    const root = await workspace();

    const checks = await claudeCodeCliRuntime.healthCheck({
      workspaceRoot: root,
      env: {},
      findExecutable: async () => "/usr/local/bin/claude",
      getVersion: async () => "1.0.0",
      runCommand: async () => ({
        ok: true,
        stdout: "authenticated",
        stderr: "",
        exitCode: 0
      })
    });

    expect(checks.find((check) => check.id === "claude-agent-definition-artifacts")).toMatchObject({
      status: "pass",
      details: {
        agentsPath: ".agent-team/providers/claude/agents.json",
        manifestPath: ".agent-team/providers/claude/manifest.json",
        definitionCount: 7
      }
    });
    expect(
      checks.find((check) => check.id === "claude-agent-definition-artifacts")?.details
    ).toMatchObject({
      definitionsHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    await expect(
      readFile(join(root, ".agent-team", "providers", "claude", "agents.json"), "utf8")
    ).resolves.toContain("\"code-reviewer\"");
    await expect(
      readFile(join(root, ".agent-team", "providers", "claude", "manifest.json"), "utf8")
    ).resolves.toContain("\"definitionsHash\"");
  });

  it("fails closed when Claude CLI auth status fails", async () => {
    const root = await workspace();

    const checks = await claudeCodeCliRuntime.healthCheck({
      workspaceRoot: root,
      env: {},
      findExecutable: async () => "/usr/local/bin/claude",
      getVersion: async () => "1.0.0",
      runCommand: async () => ({
        ok: false,
        stdout: "",
        stderr: "not logged in",
        exitCode: 1
      })
    });

    expect(checks.find((check) => check.id === "claude-auth")).toMatchObject({
      status: "fail",
      details: {
        command: "claude auth status",
        exitCode: 1,
        stderr: "not logged in",
        fix: "Run claude auth login or open Claude Code and complete the subscription OAuth login flow."
      }
    });
  });

  it("does not run auth status when Claude CLI is missing", async () => {
    const root = await workspace();
    let called = false;

    const checks = await claudeCodeCliRuntime.healthCheck({
      workspaceRoot: root,
      env: {},
      findExecutable: async () => undefined,
      getVersion: async () => undefined,
      runCommand: async () => {
        called = true;
        return { ok: true, stdout: "", stderr: "", exitCode: 0 };
      }
    });

    expect(called).toBe(false);
    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude-agent-definition-artifacts",
          status: "pass"
        }),
        expect.objectContaining({
          id: "claude-cli",
          status: "fail",
          details: {
            fix: "Install Claude Code CLI and ensure claude is available on PATH."
          }
        })
      ])
    );
    expect(checks.find((check) => check.id === "claude-auth")).toBeUndefined();
  });
});
