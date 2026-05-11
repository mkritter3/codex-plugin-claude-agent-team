import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRunSidecar } from "../../src/core/state/run-store.js";
import { createToolHandlers, handleToolCall, listToolNames } from "../../src/mcp/tools.js";

describe("MCP tool handlers", () => {
  it("lists roles with capability requirements", async () => {
    const result = await handleToolCall("agent_team_list_roles", {});

    expect(result.structuredContent?.roles?.[0]?.id).toBe("architect");
    expect(result.structuredContent?.roles).toHaveLength(7);
  });

  it("lists configured providers", async () => {
    const result = await handleToolCall("agent_team_list_providers", {});

    expect(result.structuredContent?.providers?.[0]?.id).toBe("claude-code-cli");
    expect(result.structuredContent?.providers?.[0]?.capabilities).not.toContain("edits");
  });

  it("lists write capabilities when isolated write mode is configured", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      config: {
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false }
      }
    });

    const result = await handlers.handleToolCall("agent_team_list_providers", {});

    expect(result.structuredContent?.providers?.[0]?.capabilities).toContain("edits");
    expect(result.structuredContent?.providers?.[0]?.capabilities).toContain(
      "workspaceIsolation"
    );
  });

  it("loads workspace config for default lifecycle starts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        writeMode: { enabled: true, requireIsolatedWorktree: true }
      }),
      "utf8"
    );
    const configs: boolean[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: (config) => {
        configs.push(config.writeMode.enabled);
        return {
          async startRun(request) {
            return {
              runId: "run_configured_slice",
              status: "running",
              provider: "claude-code-cli",
              role: request.role,
              sidecarPath: join(workspace, ".agent-team", "runs", "run_configured_slice.json"),
              logPath: join(workspace, ".agent-team", "logs", "run_configured_slice.log"),
              executionCwd: `${workspace}-worktree`,
              mailboxPaths: {
                inbox: join(workspace, ".agent-team", "mailboxes", "run_configured_slice", "inbox.jsonl"),
                outbox: join(workspace, ".agent-team", "mailboxes", "run_configured_slice", "outbox.jsonl"),
                control: join(workspace, ".agent-team", "mailboxes", "run_configured_slice", "control.jsonl"),
                events: join(workspace, ".agent-team", "mailboxes", "run_configured_slice", "events.jsonl")
              }
            };
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun() {
            throw new Error("should not message");
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun() {
            throw new Error("should not cancel");
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_start", {
      role: "slice-implementer",
      task: "Implement the bounded slice."
    });

    expect(configs).toEqual([true]);
    expect(result.structuredContent).toMatchObject({
      runId: "run_configured_slice",
      executionCwd: `${workspace}-worktree`
    });
  });

  it("loads default write-disabled config for lifecycle starts when config is missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-config-"));
    const configs: boolean[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: (config) => {
        configs.push(config.writeMode.enabled);
        return {
          async startRun() {
            throw new Error("write mode is disabled");
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun() {
            throw new Error("should not message");
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun() {
            throw new Error("should not cancel");
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_start", {
        role: "slice-implementer",
        task: "Implement the bounded slice."
      })
    ).rejects.toThrow("write mode is disabled");
    expect(configs).toEqual([false]);
  });

  it("dispatches through injected read-only dispatcher", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      dispatch: async (request) => ({
        runId: "run_mcp",
        status: "completed",
        provider: "claude-code-cli",
        role: request.role,
        verdict: {
          status: "SHIP",
          summary: "ok",
          requiredChanges: [],
          evidence: [],
          risks: [],
          warnings: [],
          raw: ""
        },
        sidecarPath: "/repo/.agent-team/runs/run_mcp.json",
        logPath: "/repo/.agent-team/logs/run_mcp.log"
      })
    });

    const result = await handlers.handleToolCall("agent_team_dispatch", {
      role: "planner",
      task: "Review plan"
    });

    expect(result.structuredContent?.runId).toBe("run_mcp");
    expect(result.structuredContent?.role).toBe("planner");
  });

  it("validates dispatch args before invoking dispatcher", async () => {
    let called = false;
    const handlers = createToolHandlers({
      dispatch: async () => {
        called = true;
        throw new Error("should not dispatch");
      }
    });

    const result = await handlers.handleToolCall("agent_team_dispatch", {
      role: "planner"
    });

    expect(called).toBe(false);
    expect(result.structuredContent?.status).toBe("validation_error");
  });

  it("reads persisted status by run id", async () => {
    const workspace = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp("/tmp/agent-team-status-")
    );
    await writeRunSidecar(workspace, {
      runId: "run_status",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_status"
    });

    expect(result.structuredContent?.run?.status).toBe("completed");
  });

  it("uses default lifecycle status reconciliation for running sidecars", async () => {
    const workspace = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp("/tmp/agent-team-status-")
    );
    await writeRunSidecar(workspace, {
      runId: "run_running_status",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_running_status"
    });

    expect(result.structuredContent?.run).toMatchObject({
      status: "running",
      detached: true
    });
  });

  it("returns implementation handoff fields from persisted status sidecars", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-status-"));
    await writeRunSidecar(workspace, {
      runId: "run_impl_status",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: [
        "structuredOutput",
        "tools",
        "edits",
        "sessionResume",
        "cancellation",
        "workspaceIsolation"
      ],
      evidencePaths: [join(workspace, ".agent-team", "logs", "run_impl_status.diff.patch")],
      executionCwd: "/tmp/.agent-team-worktrees/repo/run_impl_status",
      changedFiles: ["src/core/config.ts"],
      workspaceStatus: ["M src/core/config.ts"],
      workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_impl_status.diff.patch"),
      workspaceCleanup: "retained"
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_impl_status"
    });

    expect(result.structuredContent?.run).toMatchObject({
      role: "slice-implementer",
      status: "completed",
      executionCwd: "/tmp/.agent-team-worktrees/repo/run_impl_status",
      changedFiles: ["src/core/config.ts"],
      workspaceStatus: ["M src/core/config.ts"],
      workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_impl_status.diff.patch"),
      workspaceCleanup: "retained"
    });
  });

  it("delegates start, status, message, reply, cancel, and wind-down to injected lifecycle", async () => {
    const calls: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun(request) {
          calls.push(`start:${request.role}:${request.task}:${request.cwd}`);
          return {
            runId: "run_lifecycle",
            status: "running",
            provider: "claude-code-cli",
            role: request.role,
            sidecarPath: "/repo/.agent-team/runs/run_lifecycle.json",
            logPath: "/repo/.agent-team/logs/run_lifecycle.log",
            mailboxPaths: {
              inbox: "/repo/.agent-team/mailboxes/run_lifecycle/inbox.jsonl",
              outbox: "/repo/.agent-team/mailboxes/run_lifecycle/outbox.jsonl",
              control: "/repo/.agent-team/mailboxes/run_lifecycle/control.jsonl",
              events: "/repo/.agent-team/mailboxes/run_lifecycle/events.jsonl"
            }
          };
        },
        async messageRun(request) {
          calls.push(`message:${request.cwd}:${request.runId}:${request.message}`);
          return {
            runId: request.runId,
            status: "recorded_for_resume",
            record: {
              sequence: 1,
              runId: request.runId,
              role: "planner",
              provider: "claude-code-cli",
              messageType: "user_message",
              createdAt: "2026-05-11T00:00:00.000Z",
              correlationId: request.correlationId ?? "msg",
              contentHash: "hash",
              payload: { message: request.message }
            },
            message: "Message recorded for resume."
          };
        },
        async replyRun(request) {
          calls.push(`reply:${request.cwd}:${request.runId}:${request.message}`);
          return {
            runId: "run_reply_child",
            status: "running",
            provider: "claude-code-cli",
            role: "planner",
            sidecarPath: "/repo/.agent-team/runs/run_reply_child.json",
            logPath: "/repo/.agent-team/logs/run_reply_child.log",
            mailboxPaths: {
              inbox: "/repo/.agent-team/mailboxes/run_reply_child/inbox.jsonl",
              outbox: "/repo/.agent-team/mailboxes/run_reply_child/outbox.jsonl",
              control: "/repo/.agent-team/mailboxes/run_reply_child/control.jsonl",
              events: "/repo/.agent-team/mailboxes/run_reply_child/events.jsonl"
            },
            parentRunId: request.runId,
            resumedFromRunId: request.runId,
            providerSessionId: "session_parent"
          };
        },
        async getStatus(cwd, runId) {
          calls.push(`status:${cwd}:${runId}`);
          return {
            runId,
            role: "planner",
            provider: "claude-code-cli",
            status: "running",
            createdAt: "2026-05-11T00:00:00.000Z",
            updatedAt: "2026-05-11T00:00:00.000Z",
            capabilitiesUsed: ["structuredOutput"],
            evidencePaths: []
          };
        },
        async cancelRun(cwd, runId) {
          calls.push(`cancel:${cwd}:${runId}`);
          return {
            runId,
            status: "cancelled",
            sidecarPath: `${cwd}/.agent-team/runs/${runId}.json`,
            message: "Run cancelled."
          };
        },
        async windDownRun(cwd, runId) {
          calls.push(`wind:${cwd}:${runId}`);
          return {
            runId,
            status: "winding-down",
            sidecarPath: `${cwd}/.agent-team/runs/${runId}.json`,
            message: "Wind-down requested."
          };
        }
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_start", {
        role: "planner",
        task: "Review plan"
      })
    ).resolves.toMatchObject({ structuredContent: { runId: "run_lifecycle" } });
    await expect(
      handlers.handleToolCall("agent_team_status", { runId: "run_lifecycle" })
    ).resolves.toMatchObject({ structuredContent: { run: { status: "running" } } });
    await expect(
      handlers.handleToolCall("agent_team_message", {
        runId: "run_lifecycle",
        message: "Please keep going."
      })
    ).resolves.toMatchObject({
      structuredContent: { status: "recorded_for_resume", runId: "run_lifecycle" }
    });
    await expect(
      handlers.handleToolCall("agent_team_reply", {
        runId: "run_lifecycle",
        message: "Please reply now."
      })
    ).resolves.toMatchObject({
      structuredContent: {
        runId: "run_reply_child",
        parentRunId: "run_lifecycle",
        providerSessionId: "session_parent"
      }
    });
    await expect(
      handlers.handleToolCall("agent_team_cancel", { runId: "run_lifecycle" })
    ).resolves.toMatchObject({ structuredContent: { status: "cancelled" } });
    await expect(
      handlers.handleToolCall("agent_team_wind_down", { runId: "run_lifecycle" })
    ).resolves.toMatchObject({ structuredContent: { status: "winding-down" } });

    expect(calls).toEqual([
      "start:planner:Review plan:/repo",
      "status:/repo:run_lifecycle",
      "message:/repo:run_lifecycle:Please keep going.",
      "reply:/repo:run_lifecycle:Please reply now.",
      "cancel:/repo:run_lifecycle",
      "wind:/repo:run_lifecycle"
    ]);
  });

  it("passes optional cwd to agent_team_doctor", async () => {
    const workspaces: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/default",
      doctor: async (input = {}) => {
        const { workspaceRoot } = input;
        workspaces.push(workspaceRoot ?? "");
        return {
          ok: true,
          checks: [
            {
              id: "config",
              status: "pass",
              message: "ok"
            }
          ],
          warnings: []
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_doctor", {
      cwd: "/repo"
    });

    expect(workspaces).toEqual(["/repo"]);
    expect(result.structuredContent?.ok).toBe(true);
  });

  it("validates doctor cwd before invoking doctor", async () => {
    let called = false;
    const handlers = createToolHandlers({
      doctor: async () => {
        called = true;
        throw new Error("should not call doctor");
      }
    });

    const result = await handlers.handleToolCall("agent_team_doctor", {
      cwd: 42
    });

    expect(called).toBe(false);
    expect(result.structuredContent?.status).toBe("validation_error");
  });

  it("returns execution cwd from implementation starts", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun(request) {
          return {
            runId: "run_slice",
            status: "running",
            provider: "claude-code-cli",
            role: request.role,
            sidecarPath: "/repo/.agent-team/runs/run_slice.json",
            logPath: "/repo/.agent-team/logs/run_slice.log",
            executionCwd: "/tmp/.agent-team-worktrees/repo/run_slice",
            mailboxPaths: {
              inbox: "/repo/.agent-team/mailboxes/run_slice/inbox.jsonl",
              outbox: "/repo/.agent-team/mailboxes/run_slice/outbox.jsonl",
              control: "/repo/.agent-team/mailboxes/run_slice/control.jsonl",
              events: "/repo/.agent-team/mailboxes/run_slice/events.jsonl"
            }
          };
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_start", {
        role: "slice-implementer",
        task: "Implement config loading"
      })
    ).resolves.toMatchObject({
      structuredContent: {
        runId: "run_slice",
        executionCwd: "/tmp/.agent-team-worktrees/repo/run_slice"
      }
    });
  });

  it("includes a guarded implementation handoff prompt in plugin metadata", async () => {
    const plugin = JSON.parse(
      await readFile(new URL("../../.codex-plugin/plugin.json", import.meta.url), "utf8")
    ) as { interface?: { defaultPrompt?: readonly string[] } };

    expect(plugin.interface?.defaultPrompt).toContain(
      "Start an isolated slice-implementer run for this bounded task."
    );
  });

  it("runs build in CI after tests", async () => {
    const workflow = await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8"
    );

    expect(workflow).toContain("- run: npm test");
    expect(workflow).toContain("- run: npm run build");
    expect(workflow.indexOf("- run: npm run build")).toBeGreaterThan(
      workflow.indexOf("- run: npm test")
    );
  });

  it("validates lifecycle control run ids before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      lifecycle: {
        async startRun() {
          called = true;
          throw new Error("should not start");
        },
        async getStatus() {
          called = true;
          throw new Error("should not status");
        },
        async messageRun() {
          called = true;
          throw new Error("should not message");
        },
        async replyRun() {
          called = true;
          throw new Error("should not reply");
        },
        async cancelRun() {
          called = true;
          throw new Error("should not cancel");
        },
        async windDownRun() {
          called = true;
          throw new Error("should not wind down");
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_cancel", { runId: "" });

    expect(called).toBe(false);
    expect(result.structuredContent?.status).toBe("validation_error");
  });

  it("validates message and reply payloads before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      lifecycle: {
        async startRun() {
          called = true;
          throw new Error("should not start");
        },
        async getStatus() {
          called = true;
          throw new Error("should not status");
        },
        async messageRun() {
          called = true;
          throw new Error("should not message");
        },
        async replyRun() {
          called = true;
          throw new Error("should not reply");
        },
        async cancelRun() {
          called = true;
          throw new Error("should not cancel");
        },
        async windDownRun() {
          called = true;
          throw new Error("should not wind down");
        }
      }
    });

    const messageResult = await handlers.handleToolCall("agent_team_message", {
      runId: "run_1"
    });
    const replyResult = await handlers.handleToolCall("agent_team_reply", {
      runId: ""
    });

    expect(called).toBe(false);
    expect(messageResult.structuredContent?.status).toBe("validation_error");
    expect(replyResult.structuredContent?.status).toBe("validation_error");
  });

  it("registers the expected tool names", () => {
    expect(listToolNames()).toEqual([
      "agent_team_dispatch",
      "agent_team_start",
      "agent_team_reply",
      "agent_team_message",
      "agent_team_status",
      "agent_team_cancel",
      "agent_team_wind_down",
      "agent_team_doctor",
      "agent_team_list_roles",
      "agent_team_list_providers"
    ]);
  });
});
