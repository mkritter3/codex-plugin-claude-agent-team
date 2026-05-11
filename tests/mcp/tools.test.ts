import { describe, expect, it } from "vitest";
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

  it("delegates start, status, cancel, and wind-down to injected lifecycle", async () => {
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
      handlers.handleToolCall("agent_team_cancel", { runId: "run_lifecycle" })
    ).resolves.toMatchObject({ structuredContent: { status: "cancelled" } });
    await expect(
      handlers.handleToolCall("agent_team_wind_down", { runId: "run_lifecycle" })
    ).resolves.toMatchObject({ structuredContent: { status: "winding-down" } });

    expect(calls).toEqual([
      "start:planner:Review plan:/repo",
      "status:/repo:run_lifecycle",
      "cancel:/repo:run_lifecycle",
      "wind:/repo:run_lifecycle"
    ]);
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

  it("keeps live message tools deferred", async () => {
    const result = await handleToolCall("agent_team_message", { runId: "run_1" });

    expect(result.structuredContent).toMatchObject({
      status: "not_implemented",
      tool: "agent_team_message"
    });
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
