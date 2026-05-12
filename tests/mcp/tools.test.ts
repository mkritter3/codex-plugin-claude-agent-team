import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateCorruptionError } from "../../src/core/errors.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import {
  appendMailboxRecord,
  readMailboxRecords
} from "../../src/core/state/mailbox-store.js";
import { mailboxPath, runSidecarPath } from "../../src/core/state/paths.js";
import { writeRunSidecar } from "../../src/core/state/run-store.js";
import { TOOL_METADATA_BY_NAME } from "../../src/mcp/schemas.js";
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
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        providers: DEFAULT_AGENT_TEAM_CONFIG.providers
      }
    });

    const result = await handlers.handleToolCall("agent_team_list_providers", {});

    expect(result.structuredContent?.providers?.[0]?.capabilities).toContain("edits");
    expect(result.structuredContent?.providers?.[0]?.capabilities).toContain(
      "workspaceIsolation"
    );
  });

  it("describes provider inputs as neutral selector strings without provider-specific fields", () => {
    expect(TOOL_METADATA_BY_NAME.agent_team_dispatch.inputSchema.provider?.description).toBe(
      "Preferred provider selector."
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_start.inputSchema.provider?.description).toBe(
      "Preferred provider selector."
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_start_parallel.inputSchema).not.toHaveProperty(
      "providerPolicy"
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_dispatch.inputSchema).not.toHaveProperty("grok");
    expect(TOOL_METADATA_BY_NAME.agent_team_dispatch.inputSchema).not.toHaveProperty("gemini");
    expect(TOOL_METADATA_BY_NAME.agent_team_dispatch.inputSchema).not.toHaveProperty(
      "ollamaCloud"
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

  it("keeps default lifecycle managers live across repeated tool calls for a workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-live-"));
    const createdManagers: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        const managerId = `manager_${createdManagers.length + 1}`;
        const activeRuns = new Set<string>();
        createdManagers.push(managerId);
        return {
          async startRun(request) {
            activeRuns.add("run_live");
            return {
              runId: "run_live",
              status: "running",
              provider: "claude-code-cli",
              role: request.role,
              sidecarPath: join(workspace, ".agent-team", "runs", "run_live.json"),
              logPath: join(workspace, ".agent-team", "logs", "run_live.log"),
              mailboxPaths: {
                inbox: join(workspace, ".agent-team", "mailboxes", "run_live", "inbox.jsonl"),
                outbox: join(workspace, ".agent-team", "mailboxes", "run_live", "outbox.jsonl"),
                control: join(workspace, ".agent-team", "mailboxes", "run_live", "control.jsonl"),
                events: join(workspace, ".agent-team", "mailboxes", "run_live", "events.jsonl")
              }
            };
          },
          async messageRun(request) {
            if (!activeRuns.has(request.runId)) {
              throw new Error(`lost active handle in ${managerId}`);
            }
            return {
              runId: request.runId,
              status: "delivered_live",
              record: {
                sequence: 1,
                runId: request.runId,
                role: "planner",
                provider: "claude-code-cli",
                messageType: "user_message",
                createdAt: "2026-05-11T00:00:00.000Z",
                correlationId: "msg",
                contentHash: "hash",
                payload: { message: request.message }
              },
              message: "Message delivered live."
            };
          },
          async getStatus(cwd, runId) {
            if (!activeRuns.has(runId)) {
              throw new Error(`lost active handle in ${managerId}`);
            }
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
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun(cwd, runId) {
            if (!activeRuns.has(runId)) {
              throw new Error(`lost active handle in ${managerId}`);
            }
            return {
              runId,
              status: "cancelled",
              sidecarPath: join(cwd, ".agent-team", "runs", `${runId}.json`),
              message: "Run cancelled."
            };
          },
          async windDownRun(cwd, runId) {
            if (!activeRuns.has(runId)) {
              throw new Error(`lost active handle in ${managerId}`);
            }
            return {
              runId,
              status: "winding-down",
              sidecarPath: join(cwd, ".agent-team", "runs", `${runId}.json`),
              message: "Wind-down requested."
            };
          }
        };
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_start", {
        role: "planner",
        task: "Review plan"
      })
    ).resolves.toMatchObject({ structuredContent: { runId: "run_live" } });
    await expect(
      handlers.handleToolCall("agent_team_status", { runId: "run_live" })
    ).resolves.toMatchObject({ structuredContent: { run: { status: "running" } } });
    await expect(
      handlers.handleToolCall("agent_team_message", {
        runId: "run_live",
        message: "Please keep going."
      })
    ).resolves.toMatchObject({
      structuredContent: { status: "delivered_live", runId: "run_live" }
    });
    await expect(
      handlers.handleToolCall("agent_team_cancel", { runId: "run_live" })
    ).resolves.toMatchObject({ structuredContent: { status: "cancelled" } });
    await expect(
      handlers.handleToolCall("agent_team_wind_down", { runId: "run_live" })
    ).resolves.toMatchObject({ structuredContent: { status: "winding-down" } });
    expect(createdManagers).toEqual(["manager_1"]);
  });

  it("starts parallel agent runs through the shared lifecycle registry with defaults", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-parallel-"));
    const createdManagers: string[] = [];
    const requests: Array<{
      readonly managerId: string;
      readonly role: string;
      readonly task: string;
      readonly cwd: string;
      readonly provider: string | undefined;
      readonly timeoutMs: number | undefined;
    }> = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        const managerId = `manager_${createdManagers.length + 1}`;
        createdManagers.push(managerId);
        return {
          async startRun(request) {
            requests.push({
              managerId,
              role: request.role,
              task: request.task,
              cwd: request.cwd,
              provider: request.provider,
              timeoutMs: request.timeoutMs
            });
            return {
              runId: `run_${request.role}`,
              status: "running",
              provider: request.provider ?? "claude-code-cli",
              role: request.role,
              sidecarPath: join(request.cwd, ".agent-team", "runs", `run_${request.role}.json`),
              logPath: join(request.cwd, ".agent-team", "logs", `run_${request.role}.log`),
              mailboxPaths: {
                inbox: join(request.cwd, ".agent-team", "mailboxes", `run_${request.role}`, "inbox.jsonl"),
                outbox: join(request.cwd, ".agent-team", "mailboxes", `run_${request.role}`, "outbox.jsonl"),
                control: join(request.cwd, ".agent-team", "mailboxes", `run_${request.role}`, "control.jsonl"),
                events: join(request.cwd, ".agent-team", "mailboxes", `run_${request.role}`, "events.jsonl")
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

    const result = await handlers.handleToolCall("agent_team_start_parallel", {
      cwd: workspace,
      provider: "claude-code-cli",
      timeoutMs: 1234,
      concurrency: 2,
      runs: [
        { role: "planner", task: "Plan", correlationId: "plan" },
        { role: "debugger", task: "Debug", provider: "claude-code-cli", timeoutMs: 5678 }
      ]
    });

    expect(createdManagers).toEqual(["manager_1"]);
    expect(requests).toEqual(
      expect.arrayContaining([
        {
          managerId: "manager_1",
          role: "planner",
          task: "Plan",
          cwd: workspace,
          provider: "claude-code-cli",
          timeoutMs: 1234
        },
        {
          managerId: "manager_1",
          role: "debugger",
          task: "Debug",
          cwd: workspace,
          provider: "claude-code-cli",
          timeoutMs: 5678
        }
      ])
    );
    expect(requests).toHaveLength(2);
    expect(result.structuredContent).toMatchObject({
      status: "started",
      concurrency: 2,
      runs: [
        {
          status: "started",
          index: 0,
          correlationId: "plan",
          run: { runId: "run_planner" }
        },
        {
          status: "started",
          index: 1,
          run: { runId: "run_debugger" }
        }
      ]
    });
    expect(String(result.structuredContent?.batchId)).toMatch(/^batch_/);
  });

  it("returns partial failure for parallel starts without dropping later runs", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-parallel-"));
    const attempted: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => ({
        async startRun(request) {
          attempted.push(request.role);
          if (request.role === "debugger") {
            throw new Error("provider failed");
          }
          return {
            runId: `run_${request.role}`,
            status: "running",
            provider: "claude-code-cli",
            role: request.role,
            sidecarPath: join(workspace, ".agent-team", "runs", `run_${request.role}.json`),
            logPath: join(workspace, ".agent-team", "logs", `run_${request.role}.log`),
            mailboxPaths: {
              inbox: join(workspace, ".agent-team", "mailboxes", `run_${request.role}`, "inbox.jsonl"),
              outbox: join(workspace, ".agent-team", "mailboxes", `run_${request.role}`, "outbox.jsonl"),
              control: join(workspace, ".agent-team", "mailboxes", `run_${request.role}`, "control.jsonl"),
              events: join(workspace, ".agent-team", "mailboxes", `run_${request.role}`, "events.jsonl")
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
      })
    });

    const result = await handlers.handleToolCall("agent_team_start_parallel", {
      runs: [
        { role: "planner", task: "Plan" },
        { role: "debugger", task: "Debug", correlationId: "debug" },
        { role: "test-designer", task: "Test" }
      ],
      concurrency: 1
    });

    expect(attempted).toEqual(["planner", "debugger", "test-designer"]);
    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "started", index: 0, run: { runId: "run_planner" } },
        {
          status: "failed",
          index: 1,
          correlationId: "debug",
          role: "debugger",
          task: "Debug",
          error: "provider failed"
        },
        { status: "started", index: 2, run: { runId: "run_test-designer" } }
      ]
    });
  });

  it("validates parallel start args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      lifecycleFactory: () => ({
        async startRun() {
          called = true;
          throw new Error("should not start");
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
      })
    });

    const cases: Array<Record<string, unknown>> = [
      {},
      { runs: [] },
      { runs: [{ role: "nope", task: "Plan" }] },
      { runs: [{ role: "planner", task: "" }] },
      { runs: [{ role: "planner", task: "Plan", cwd: 1 }] },
      { runs: [{ role: "planner", task: "Plan", provider: 1 }] },
      { runs: [{ role: "planner", task: "Plan", timeoutMs: -1 }] },
      { runs: [{ role: "planner", task: "Plan", correlationId: 1 }] },
      { runs: [{ role: "planner", task: "Plan" }], concurrency: 0 },
      { runs: [{ role: "planner", task: "Plan" }], concurrency: 9 },
      { runs: [{ role: "planner", task: "Plan" }], concurrency: 1.5 }
    ];

    for (const input of cases) {
      const result = await handlers.handleToolCall("agent_team_start_parallel", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
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

  it("archives corrupt sidecars and returns a recovery result from status", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-corrupt-status-"));
    const corruptPath = runSidecarPath(workspace, "run_corrupt_status");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{ nope", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_corrupt_status"
    });

    expect(result.structuredContent).toMatchObject({
      status: "state_corrupt",
      runId: "run_corrupt_status",
      operation: "agent_team_status",
      kind: "json",
      originalPath: corruptPath,
      recovery: "archived",
      interventionRequired: true
    });
    const archivePath = result.structuredContent?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{ nope");
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

  it("validates status_many args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          called = true;
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

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: 1 }] },
      { cwd: 1, runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }], concurrency: 0 },
      { runs: [{ runId: "run_1" }], concurrency: 9 },
      { runs: [{ runId: "run_1" }], concurrency: 1.5 }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_status_many", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("reads many statuses through the lifecycle registry with default and per-run cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-status-many-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-status-many-other-"));
    const managerByCwd = new Map<string, string>();
    const calls: string[] = [];
    let managerCount = 0;
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        managerCount += 1;
        const managerId = `manager_${managerCount}`;
        return {
          async startRun() {
            throw new Error("should not start");
          },
          async getStatus(cwd, runId) {
            managerByCwd.set(cwd, managerId);
            calls.push(`${managerId}:${cwd}:${runId}`);
            return {
              runId,
              role: "planner",
              provider: "claude-code-cli",
              status: "completed",
              createdAt: "2026-05-11T00:00:00.000Z",
              updatedAt: "2026-05-11T00:00:01.000Z",
              capabilitiesUsed: ["structuredOutput"],
              evidencePaths: []
            };
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

    const result = await handlers.handleToolCall("agent_team_status_many", {
      cwd: workspace,
      concurrency: 2,
      runs: [
        { runId: "run_a", correlationId: "a" },
        { runId: "run_b", cwd: otherWorkspace, correlationId: "b" },
        { runId: "run_c" }
      ]
    });

    expect(managerByCwd.get(workspace)).toBeDefined();
    expect(managerByCwd.get(otherWorkspace)).toBeDefined();
    expect(managerByCwd.get(workspace)).not.toBe(managerByCwd.get(otherWorkspace));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${managerByCwd.get(workspace)}:${workspace}:run_a`,
        `${managerByCwd.get(workspace)}:${workspace}:run_c`,
        `${managerByCwd.get(otherWorkspace)}:${otherWorkspace}:run_b`
      ])
    );
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_a",
          cwd: workspace,
          correlationId: "a",
          run: { runId: "run_a", status: "completed" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_b",
          cwd: otherWorkspace,
          correlationId: "b",
          run: { runId: "run_b", status: "completed" }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_c",
          cwd: workspace,
          run: { runId: "run_c", status: "completed" }
        }
      ]
    });
  });

  it("recovers one corrupt status_many sidecar and still returns later statuses", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-status-many-corrupt-"));
    const corruptPath = runSidecarPath(workspace, "run_corrupt_many");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{ nope", "utf8");
    await writeRunSidecar(workspace, {
      runId: "run_ok_many",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status_many", {
      runs: [
        { runId: "run_corrupt_many", correlationId: "bad" },
        { runId: "run_ok_many" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_many",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_many",
            operation: "agent_team_status_many",
            kind: "json",
            originalPath: corruptPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_many",
          cwd: workspace,
          run: { status: "completed" }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.runs as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{ nope");
  });

  it("uses lifecycle reconciliation for status_many running sidecars without duplicate detach events", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-status-many-detached-"));
    for (const runId of ["run_detached_a", "run_detached_b"]) {
      await writeRunSidecar(workspace, {
        runId,
        role: "planner",
        provider: "claude-code-cli",
        status: "running",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:01.000Z",
        capabilitiesUsed: ["structuredOutput"],
        evidencePaths: []
      });
    }
    const handlers = createToolHandlers({ cwd: () => workspace });

    await handlers.handleToolCall("agent_team_status_many", {
      concurrency: 2,
      runs: [{ runId: "run_detached_a" }, { runId: "run_detached_b" }]
    });
    const result = await handlers.handleToolCall("agent_team_status_many", {
      concurrency: 2,
      runs: [{ runId: "run_detached_a" }, { runId: "run_detached_b" }]
    });

    expect(result.structuredContent).toMatchObject({
      status: "ok",
      runs: [
        { status: "ok", run: { runId: "run_detached_a", detached: true } },
        { status: "ok", run: { runId: "run_detached_b", detached: true } }
      ]
    });
    const eventsA = await readMailboxRecords(workspace, "run_detached_a", "events");
    const eventsB = await readMailboxRecords(workspace, "run_detached_b", "events");
    expect(
      eventsA.filter((record) => record.messageType === "detached_handle_missing")
    ).toHaveLength(1);
    expect(
      eventsB.filter((record) => record.messageType === "detached_handle_missing")
    ).toHaveLength(1);
  });

  it("validates summary args before durable-state reads", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-summary-invalid-"));
    const handlers = createToolHandlers({ cwd: () => workspace });

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: "" }] },
      { cwd: "", runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }], concurrency: 0 },
      { runs: [{ runId: "run_1" }], concurrency: 9 },
      { runs: [{ runId: "run_1" }], concurrency: 1.5 },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1" }]
      },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1", cwd: `${workspace}/.` }]
      }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_summary", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
  });

  it("returns a read-only team summary from persisted sidecars and mailboxes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-summary-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-summary-other-"));
    await writeRunSidecar(workspace, {
      runId: "run_active_summary",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:01:00.000Z",
      capabilitiesUsed: ["structuredOutput", "workspaceIsolation"],
      evidencePaths: [join(workspace, ".agent-team", "logs", "run_active_summary.diff.patch")],
      detached: true,
      executionCwd: join(workspace, ".worktrees", "run_active_summary"),
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "retained",
      workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_active_summary.diff.patch"),
      changedFiles: ["src/core/team-summary.ts"],
      verdict: {
        status: "SHIP",
        summary: "ready",
        requiredChanges: [],
        evidence: ["tests"],
        risks: [],
        warnings: [],
        raw: "status: SHIP"
      }
    });
    await writeRunSidecar(otherWorkspace, {
      runId: "run_waiting_summary",
      role: "planner",
      provider: "claude-code-cli",
      status: "awaiting-input",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:02:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: [],
      pendingOutboxRequest: {
        id: "ask_1",
        sequence: 1,
        messageType: "clarification_request",
        correlationId: "ask",
        createdAt: "2026-05-11T00:02:00.000Z",
        payload: { question: "Which file?" }
      }
    });
    await appendMailboxRecord(workspace, "run_active_summary", "events", {
      role: "slice-implementer",
      provider: "claude-code-cli",
      messageType: "detached_handle_missing",
      correlationId: "event_1",
      payload: { message: "detached" },
      createdAt: "2026-05-11T00:01:00.000Z"
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_summary", {
      cwd: workspace,
      concurrency: 2,
      runs: [
        { runId: "run_active_summary", correlationId: "active" },
        { runId: "run_waiting_summary", cwd: otherWorkspace, correlationId: "waiting" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "ok",
      groups: {
        running: ["run_active_summary"],
        awaitingInput: ["run_waiting_summary"],
        detached: ["run_active_summary"],
        retainedWorktree: ["run_active_summary"]
      },
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_active_summary",
          cwd: workspace,
          correlationId: "active",
          run: {
            role: "slice-implementer",
            status: "running",
            operationalState: "running",
            detached: true,
            retainedWorktree: true
          },
          evidence: {
            sidecarPath: runSidecarPath(workspace, "run_active_summary"),
            workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_active_summary.diff.patch"),
            changedFiles: ["src/core/team-summary.ts"],
            verdict: { status: "SHIP" },
            mailboxes: {
              events: {
                path: mailboxPath(workspace, "run_active_summary", "events"),
                count: 1,
                lastSequence: 1
              }
            }
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_waiting_summary",
          cwd: otherWorkspace,
          correlationId: "waiting",
          run: {
            status: "awaiting-input",
            operationalState: "awaitingInput",
            pendingOutboxRequest: { id: "ask_1" }
          }
        }
      ]
    });
  });

  it("recovers one corrupt summary mailbox and still returns later summaries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-summary-corrupt-"));
    for (const runId of ["run_corrupt_summary", "run_ok_summary"]) {
      await writeRunSidecar(workspace, {
        runId,
        role: "planner",
        provider: "claude-code-cli",
        status: "completed",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:01:00.000Z",
        capabilitiesUsed: ["structuredOutput"],
        evidencePaths: []
      });
    }
    const eventsPath = mailboxPath(workspace, "run_corrupt_summary", "events");
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_corrupt_summary"), {
      recursive: true
    });
    await writeFile(eventsPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_summary", {
      runs: [
        { runId: "run_corrupt_summary", correlationId: "bad" },
        { runId: "run_ok_summary" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      groups: { terminal: ["run_ok_summary"] },
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_summary",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_summary",
            operation: "agent_team_summary",
            kind: "jsonl",
            originalPath: eventsPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_summary",
          cwd: workspace,
          run: { operationalState: "terminal" }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.runs as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
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

  it("returns pending outbox evidence from lifecycle status", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async getStatus(cwd, runId) {
          return {
            runId,
            role: "planner",
            provider: "claude-code-cli",
            status: "awaiting-input",
            createdAt: "2026-05-11T00:00:00.000Z",
            updatedAt: "2026-05-11T00:01:00.000Z",
            awaitingInputSince: "2026-05-11T00:01:00.000Z",
            capabilitiesUsed: ["structuredOutput"],
            evidencePaths: [],
            outboxRequestIds: ["ask_1"],
            pendingOutboxRequest: {
              id: "ask_1",
              sequence: 1,
              messageType: "clarification_request",
              correlationId: "corr_ask_1",
              createdAt: "2026-05-11T00:01:00.000Z",
              payload: { question: "Which test should I inspect first?" }
            }
          };
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_waiting"
    });

    expect(result.structuredContent?.run).toMatchObject({
      runId: "run_waiting",
      status: "awaiting-input",
      pendingOutboxRequest: {
        id: "ask_1",
        sequence: 1,
        messageType: "clarification_request",
        payload: { question: "Which test should I inspect first?" }
      }
    });
  });

  it("returns lifecycle message results for awaiting-input replies", async () => {
    const calls: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun(request) {
          calls.push(`message:${request.runId}:${request.message}`);
          return {
            runId: request.runId,
            status: "delivered_live",
            record: {
              sequence: 1,
              runId: request.runId,
              role: "planner",
              provider: "claude-code-cli",
              messageType: "user_message",
              createdAt: "2026-05-11T00:02:00.000Z",
              correlationId: request.correlationId ?? "msg_awaiting",
              contentHash: "hash",
              payload: { message: request.message }
            },
            message: "Message delivered live."
          };
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

    const result = await handlers.handleToolCall("agent_team_message", {
      runId: "run_waiting",
      message: "Use the CI logs first.",
      correlationId: "msg_awaiting"
    });

    expect(calls).toEqual(["message:run_waiting:Use the CI logs first."]);
    expect(result.structuredContent).toMatchObject({
      runId: "run_waiting",
      status: "delivered_live",
      record: {
        correlationId: "msg_awaiting",
        payload: { message: "Use the CI logs first." }
      }
    });
  });

  it("validates message_many args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          called = true;
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

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { messages: [] },
      { messages: [1] },
      { messages: [{}] },
      { messages: [{ runId: "", message: "hi" }] },
      { messages: [{ runId: "run_1" }] },
      { messages: [{ runId: "run_1", message: "" }] },
      { messages: [{ runId: "run_1", message: "hi", cwd: 1 }] },
      { messages: [{ runId: "run_1", message: "hi", messageType: "" }] },
      { messages: [{ runId: "run_1", message: "hi", correlationId: 1 }] },
      { cwd: "", messages: [{ runId: "run_1", message: "hi" }] },
      { messages: [{ runId: "run_1", message: "hi" }], concurrency: 0 },
      { messages: [{ runId: "run_1", message: "hi" }], concurrency: 9 },
      { messages: [{ runId: "run_1", message: "hi" }], concurrency: 1.5 },
      {
        messages: [
          { runId: "run_1", message: "first" },
          { runId: "run_1", message: "second" }
        ]
      },
      {
        messages: [
          { runId: "run_1", message: "first" },
          { runId: "run_1", cwd: "/repo/.", message: "same normalized target" }
        ]
      }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_message_many", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("sends many messages through the lifecycle registry with default and per-message cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-message-many-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-message-many-other-"));
    const managerByCwd = new Map<string, string>();
    const calls: string[] = [];
    let managerCount = 0;
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        managerCount += 1;
        const managerId = `manager_${managerCount}`;
        return {
          async startRun() {
            throw new Error("should not start");
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun(request) {
            managerByCwd.set(request.cwd, managerId);
            calls.push(`${managerId}:${request.cwd}:${request.runId}:${request.message}`);
            return {
              runId: request.runId,
              status:
                request.runId === "run_b" ? "delivered_live" : "recorded_for_resume",
              record: {
                sequence: 1,
                runId: request.runId,
                role: "planner",
                provider: "claude-code-cli",
                messageType: request.messageType ?? "user_message",
                createdAt: "2026-05-11T00:02:00.000Z",
                correlationId: request.correlationId ?? request.runId,
                contentHash: "hash",
                payload: { message: request.message }
              },
              message:
                request.runId === "run_b"
                  ? "Message delivered live."
                  : "Message recorded for resume."
            };
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

    const result = await handlers.handleToolCall("agent_team_message_many", {
      cwd: workspace,
      concurrency: 2,
      messages: [
        { runId: "run_a", message: "first", correlationId: "a" },
        {
          runId: "run_b",
          cwd: otherWorkspace,
          message: "second",
          messageType: "evidence",
          correlationId: "b"
        },
        { runId: "run_c", message: "third" }
      ]
    });

    expect(managerByCwd.get(workspace)).toBeDefined();
    expect(managerByCwd.get(otherWorkspace)).toBeDefined();
    expect(managerByCwd.get(workspace)).not.toBe(managerByCwd.get(otherWorkspace));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${managerByCwd.get(workspace)}:${workspace}:run_a:first`,
        `${managerByCwd.get(workspace)}:${workspace}:run_c:third`,
        `${managerByCwd.get(otherWorkspace)}:${otherWorkspace}:run_b:second`
      ])
    );
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      messages: [
        {
          status: "ok",
          index: 0,
          runId: "run_a",
          cwd: workspace,
          correlationId: "a",
          result: { runId: "run_a", status: "recorded_for_resume" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_b",
          cwd: otherWorkspace,
          correlationId: "b",
          result: {
            runId: "run_b",
            status: "delivered_live",
            record: { messageType: "evidence" }
          }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_c",
          cwd: workspace,
          result: { runId: "run_c", status: "recorded_for_resume" }
        }
      ]
    });
  });

  it("returns partial failures from message_many without dropping later messages", async () => {
    const attempted: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun(request) {
          attempted.push(request.runId);
          if (request.runId === "run_bad") {
            throw new Error("message failed");
          }
          return {
            runId: request.runId,
            status: "recorded_for_resume",
            record: {
              sequence: 1,
              runId: request.runId,
              role: "planner",
              provider: "claude-code-cli",
              messageType: "user_message",
              createdAt: "2026-05-11T00:02:00.000Z",
              correlationId: request.correlationId ?? request.runId,
              contentHash: "hash",
              payload: { message: request.message }
            },
            message: "Message recorded for resume."
          };
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

    const result = await handlers.handleToolCall("agent_team_message_many", {
      concurrency: 1,
      messages: [
        { runId: "run_ok_1", message: "first" },
        { runId: "run_bad", message: "bad", correlationId: "bad" },
        { runId: "run_ok_2", message: "third" }
      ]
    });

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      messages: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        {
          status: "failed",
          index: 1,
          runId: "run_bad",
          cwd: "/repo",
          correlationId: "bad",
          error: "message failed"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("recovers one corrupt message_many mailbox and still returns later message results", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-message-many-corrupt-"));
    for (const runId of ["run_corrupt_many_message", "run_ok_many_message"]) {
      await writeRunSidecar(workspace, {
        runId,
        role: "planner",
        provider: "claude-code-cli",
        status: "running",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:01.000Z",
        capabilitiesUsed: ["structuredOutput"],
        evidencePaths: []
      });
    }
    const inboxPath = mailboxPath(workspace, "run_corrupt_many_message", "inbox");
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_corrupt_many_message"), {
      recursive: true
    });
    await writeFile(inboxPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_message_many", {
      messages: [
        {
          runId: "run_corrupt_many_message",
          message: "bad",
          correlationId: "bad"
        },
        { runId: "run_ok_many_message", message: "ok" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      messages: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_many_message",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_many_message",
            operation: "agent_team_message_many",
            kind: "jsonl",
            originalPath: inboxPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_many_message",
          cwd: workspace,
          result: { status: "recorded_for_resume" }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.messages as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("validates cancel_many args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
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
          called = true;
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: "" }] },
      { cwd: "", runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }], concurrency: 0 },
      { runs: [{ runId: "run_1" }], concurrency: 9 },
      { runs: [{ runId: "run_1" }], concurrency: 1.5 },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1" }]
      },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1", cwd: "/repo/." }]
      }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_cancel_many", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("cancels many runs through the lifecycle registry with default and per-run cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-cancel-many-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-cancel-many-other-"));
    const managerByCwd = new Map<string, string>();
    const calls: string[] = [];
    let managerCount = 0;
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        managerCount += 1;
        const managerId = `manager_${managerCount}`;
        return {
          async startRun() {
            throw new Error("should not start");
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
          async cancelRun(cwd, runId) {
            managerByCwd.set(cwd, managerId);
            calls.push(`${managerId}:${cwd}:${runId}`);
            return {
              runId,
              status: runId === "run_b" ? "cancelling" : "cancelled",
              sidecarPath: `${cwd}/.agent-team/runs/${runId}.json`,
              message:
                runId === "run_b"
                  ? "Cancellation intent recorded."
                  : "Run cancelled."
            };
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_cancel_many", {
      cwd: workspace,
      concurrency: 2,
      runs: [
        { runId: "run_a", correlationId: "a" },
        { runId: "run_b", cwd: otherWorkspace, correlationId: "b" },
        { runId: "run_c" }
      ]
    });

    expect(managerByCwd.get(workspace)).toBeDefined();
    expect(managerByCwd.get(otherWorkspace)).toBeDefined();
    expect(managerByCwd.get(workspace)).not.toBe(managerByCwd.get(otherWorkspace));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${managerByCwd.get(workspace)}:${workspace}:run_a`,
        `${managerByCwd.get(workspace)}:${workspace}:run_c`,
        `${managerByCwd.get(otherWorkspace)}:${otherWorkspace}:run_b`
      ])
    );
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_a",
          cwd: workspace,
          correlationId: "a",
          result: { runId: "run_a", status: "cancelled" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_b",
          cwd: otherWorkspace,
          correlationId: "b",
          result: { runId: "run_b", status: "cancelling" }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_c",
          cwd: workspace,
          result: { runId: "run_c", status: "cancelled" }
        }
      ]
    });
  });

  it("returns partial failures from cancel_many without dropping later runs", async () => {
    const attempted: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
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
        async cancelRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_bad") {
            throw new Error("cancel failed");
          }
          return {
            runId,
            status: "cancelled",
            sidecarPath: `/repo/.agent-team/runs/${runId}.json`,
            message: "Run cancelled."
          };
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_cancel_many", {
      concurrency: 1,
      runs: [
        { runId: "run_ok_1" },
        { runId: "run_bad", correlationId: "bad" },
        { runId: "run_ok_2" }
      ]
    });

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        {
          status: "failed",
          index: 1,
          runId: "run_bad",
          cwd: "/repo",
          correlationId: "bad",
          error: "cancel failed"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("recovers one corrupt cancel_many sidecar and still returns later cancellation results", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-cancel-many-corrupt-"));
    await writeRunSidecar(workspace, {
      runId: "run_ok_many_cancel",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput", "cancellation"],
      evidencePaths: []
    });
    const corruptPath = runSidecarPath(workspace, "run_corrupt_many_cancel");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_cancel_many", {
      runs: [
        { runId: "run_corrupt_many_cancel", correlationId: "bad" },
        { runId: "run_ok_many_cancel" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_many_cancel",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_many_cancel",
            operation: "agent_team_cancel_many",
            kind: "json",
            originalPath: corruptPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_many_cancel",
          cwd: workspace,
          result: {
            status: "running",
            detached: true,
            message: expect.stringContaining("No active process")
          }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.runs as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("validates wind_down_many args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
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
          called = true;
          throw new Error("should not wind down");
        }
      }
    });

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: "" }] },
      { cwd: "", runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }], concurrency: 0 },
      { runs: [{ runId: "run_1" }], concurrency: 9 },
      { runs: [{ runId: "run_1" }], concurrency: 1.5 },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1" }]
      },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1", cwd: "/repo/." }]
      }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_wind_down_many", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("winds down many runs through the lifecycle registry with default and per-run cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-wind-many-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-wind-many-other-"));
    const managerByCwd = new Map<string, string>();
    const calls: string[] = [];
    let managerCount = 0;
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        managerCount += 1;
        const managerId = `manager_${managerCount}`;
        return {
          async startRun() {
            throw new Error("should not start");
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
          async windDownRun(cwd, runId) {
            managerByCwd.set(cwd, managerId);
            calls.push(`${managerId}:${cwd}:${runId}`);
            return {
              runId,
              status: runId === "run_b" ? "completed" : "winding-down",
              sidecarPath: `${cwd}/.agent-team/runs/${runId}.json`,
              message:
                runId === "run_b"
                  ? "Run completed during wind-down."
                  : "Wind-down requested."
            };
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_wind_down_many", {
      cwd: workspace,
      concurrency: 2,
      runs: [
        { runId: "run_a", correlationId: "a" },
        { runId: "run_b", cwd: otherWorkspace, correlationId: "b" },
        { runId: "run_c" }
      ]
    });

    expect(managerByCwd.get(workspace)).toBeDefined();
    expect(managerByCwd.get(otherWorkspace)).toBeDefined();
    expect(managerByCwd.get(workspace)).not.toBe(managerByCwd.get(otherWorkspace));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${managerByCwd.get(workspace)}:${workspace}:run_a`,
        `${managerByCwd.get(workspace)}:${workspace}:run_c`,
        `${managerByCwd.get(otherWorkspace)}:${otherWorkspace}:run_b`
      ])
    );
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_a",
          cwd: workspace,
          correlationId: "a",
          result: { runId: "run_a", status: "winding-down" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_b",
          cwd: otherWorkspace,
          correlationId: "b",
          result: { runId: "run_b", status: "completed" }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_c",
          cwd: workspace,
          result: { runId: "run_c", status: "winding-down" }
        }
      ]
    });
  });

  it("returns partial failures from wind_down_many without dropping later runs", async () => {
    const attempted: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
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
        async windDownRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_bad") {
            throw new Error("wind failed");
          }
          return {
            runId,
            status: "winding-down",
            sidecarPath: `/repo/.agent-team/runs/${runId}.json`,
            message: "Wind-down requested."
          };
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_wind_down_many", {
      concurrency: 1,
      runs: [
        { runId: "run_ok_1" },
        { runId: "run_bad", correlationId: "bad" },
        { runId: "run_ok_2" }
      ]
    });

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        {
          status: "failed",
          index: 1,
          runId: "run_bad",
          cwd: "/repo",
          correlationId: "bad",
          error: "wind failed"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("recovers one corrupt wind_down_many sidecar and still returns later wind-down results", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-wind-many-corrupt-"));
    await writeRunSidecar(workspace, {
      runId: "run_ok_many_wind",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const corruptPath = runSidecarPath(workspace, "run_corrupt_many_wind");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_wind_down_many", {
      runs: [
        { runId: "run_corrupt_many_wind", correlationId: "bad" },
        { runId: "run_ok_many_wind" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_many_wind",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_many_wind",
            operation: "agent_team_wind_down_many",
            kind: "json",
            originalPath: corruptPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_many_wind",
          cwd: workspace,
          result: { status: "winding-down" }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.runs as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("archives corrupt mailboxes and returns a recovery result from reply", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-corrupt-reply-"));
    await writeRunSidecar(workspace, {
      runId: "run_corrupt_reply",
      role: "planner",
      provider: "claude-code-cli",
      status: "awaiting-input",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:01:00.000Z",
      capabilitiesUsed: ["structuredOutput", "sessionResume"],
      evidencePaths: [],
      providerSessionId: "session_parent"
    });
    const inboxPath = mailboxPath(workspace, "run_corrupt_reply", "inbox");
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_corrupt_reply"), {
      recursive: true
    });
    await writeFile(inboxPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_reply", {
      runId: "run_corrupt_reply"
    });

    expect(result.structuredContent).toMatchObject({
      status: "state_corrupt",
      runId: "run_corrupt_reply",
      operation: "agent_team_reply",
      kind: "jsonl",
      originalPath: inboxPath,
      recovery: "archived",
      interventionRequired: true
    });
    const archivePath = result.structuredContent?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("lets non-state-corruption lifecycle errors propagate", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("boom");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new StateCorruptionError("Synthetic corruption without metadata.");
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
      handlers.handleToolCall("agent_team_status", { runId: "run_boom" })
    ).rejects.toThrow("boom");
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
            status: "delivered_live",
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
            message: "Message delivered live."
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
      structuredContent: { status: "delivered_live", runId: "run_lifecycle" }
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

  it("delegates cleanup through the lifecycle selected for the workspace", async () => {
    const workspaces: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/default",
      lifecycleFactory: () => ({
        async startRun() {
          throw new Error("should not start");
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
        },
        async cleanupRunWorkspace(request) {
          workspaces.push(`${request.cwd}:${request.runId}:${request.force}`);
          return {
            runId: request.runId,
            status: "removed",
            sidecarPath: `${request.cwd}/.agent-team/runs/${request.runId}.json`,
            workspaceCleanup: "removed",
            message: "Implementation worktree removed."
          };
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "run_cleanup_tool",
      cwd: "/repo",
      force: true
    });

    expect(workspaces).toEqual(["/repo:run_cleanup_tool:true"]);
    expect(result.structuredContent).toMatchObject({
      runId: "run_cleanup_tool",
      status: "removed",
      workspaceCleanup: "removed"
    });
  });

  it("validates cleanup args before invoking lifecycle", async () => {
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
        },
        async cleanupRunWorkspace() {
          called = true;
          throw new Error("should not cleanup");
        }
      }
    });

    const missingForce = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "run_1"
    });
    const invalidForce = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "run_1",
      force: "yes"
    });
    const invalidCwd = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "run_1",
      cwd: 42,
      force: true
    });
    const invalidRun = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "",
      force: true
    });

    expect(called).toBe(false);
    expect(missingForce.structuredContent?.status).toBe("validation_error");
    expect(invalidForce.structuredContent?.status).toBe("validation_error");
    expect(invalidCwd.structuredContent?.status).toBe("validation_error");
    expect(invalidRun.structuredContent?.status).toBe("validation_error");
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

  it("runs the shared CI script in GitHub CI", async () => {
    const workflow = await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8"
    );

    expect(workflow).toContain("- run: npm ci");
    expect(workflow).toContain("- run: npm run ci");
    expect(workflow.indexOf("- run: npm run ci")).toBeGreaterThan(
      workflow.indexOf("- run: npm ci")
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
      "agent_team_start_parallel",
      "agent_team_reply",
      "agent_team_message",
      "agent_team_message_many",
      "agent_team_status",
      "agent_team_status_many",
      "agent_team_summary",
      "agent_team_cancel",
      "agent_team_cancel_many",
      "agent_team_wind_down",
      "agent_team_wind_down_many",
      "agent_team_cleanup",
      "agent_team_doctor",
      "agent_team_list_roles",
      "agent_team_list_providers"
    ]);
  });
});
