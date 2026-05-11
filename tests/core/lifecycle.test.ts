import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLifecycleManager } from "../../src/core/lifecycle.js";
import { readMailboxRecords } from "../../src/core/state/mailbox-store.js";
import { readRunSidecar, writeRunSidecar } from "../../src/core/state/run-store.js";
import type { RunSidecar } from "../../src/core/types.js";
import type { AgentProviderRuntime } from "../../src/providers/index.js";
import type {
  ProviderSessionDoneStatus,
  ProviderSessionHandle,
  ProviderSessionSnapshot
} from "../../src/providers/types.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function fakeHandle(
  done: Promise<ProviderSessionDoneStatus>,
  options: {
    readonly supportsStdin?: boolean;
    readonly writeSucceeds?: boolean;
  } = {}
): ProviderSessionHandle & {
  killed: boolean;
  forceKilled: boolean;
  stdin: string[];
  snapshotValue: ProviderSessionSnapshot;
} {
  const snapshotValue: ProviderSessionSnapshot = {
    providerSessionId: "session_123",
    text: [
      "Finished",
      "<<<VERDICT>>>",
      "status: SHIP",
      "summary: ready",
      "required_changes:",
      "- none",
      "evidence:",
      "- test",
      "risks:",
      "- none",
      "<<<END_VERDICT>>>"
    ].join("\n"),
    warnings: [],
    recentActivities: [{ type: "text", summary: "Finished", timestamp: 1 }],
    currentActivity: { type: "text", summary: "Finished", timestamp: 1 },
    pendingOutboxRequests: [],
    lastStderr: [],
    transcriptPath: "/tmp/transcript.jsonl",
    logPath: "/tmp/run.log"
  };
  const handle = {
    killed: false,
    forceKilled: false,
    stdin: [] as string[],
    supportsStdin: options.supportsStdin ?? true,
    snapshotValue,
    done,
    get providerSessionId() {
      return handle.snapshotValue.providerSessionId;
    },
    get recentActivities() {
      return handle.snapshotValue.recentActivities;
    },
    get currentActivity() {
      return handle.snapshotValue.currentActivity;
    },
    get lastStderr() {
      return handle.snapshotValue.lastStderr;
    },
    get transcriptPath() {
      return handle.snapshotValue.transcriptPath;
    },
    get logPath() {
      return handle.snapshotValue.logPath;
    },
    kill() {
      handle.killed = true;
    },
    forceKill() {
      handle.forceKilled = true;
    },
    writeStdin(data: string) {
      handle.stdin.push(data);
      return options.writeSucceeds ?? true;
    },
    snapshot() {
      return handle.snapshotValue;
    }
  };
  return handle;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

async function waitForSidecar(
  runId: string,
  predicate: (sidecar: RunSidecar) => boolean
): Promise<RunSidecar> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sidecar = await readRunSidecar(workspace, runId);
    if (predicate(sidecar)) {
      return sidecar;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  return readRunSidecar(workspace, runId);
}

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-lifecycle-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("AgentLifecycleManager", () => {
  it("starts a background run through the selected provider runtime", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const starts: string[] = [];
    const runtime: AgentProviderRuntime = {
      id: "fake-runtime",
      descriptor: () => ({
        id: "fake-runtime",
        displayName: "Fake Runtime",
        authMode: "subscription-oauth",
        capabilities: ["structuredOutput", "tools", "sessionResume", "cancellation"],
        available: true
      }),
      inspectEnvironment: () => ({ warnings: [] }),
      async runPrint() {
        throw new Error("should not run print");
      },
      startSession(input) {
        starts.push(
          `${input.runId}:${input.cwd}:${input.roleId}:${input.executionPolicy}:${input.timeoutMs}`
        );
        return handle;
      },
      async healthCheck() {
        return [];
      }
    };
    const manager = new AgentLifecycleManager({
      providers: [runtime.descriptor()],
      runtimes: [runtime],
      createRunId: () => "run_runtime_start"
    });

    const result = await manager.startRun({
      role: "planner",
      task: "Review this plan",
      cwd: workspace,
      provider: "fake-runtime",
      timeoutMs: 1234
    });

    expect(result).toMatchObject({
      runId: "run_runtime_start",
      provider: "fake-runtime",
      status: "running"
    });
    expect(starts).toEqual([`run_runtime_start:${workspace}:planner:read-only:1234`]);
  });

  it("starts a background run and records running status", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_life_1",
      now: () => new Date("2026-05-11T00:00:00.000Z"),
      startSession: () => handle
    });

    const result = await manager.startRun({
      role: "planner",
      task: "Review this plan",
      cwd: workspace
    });

    expect(result).toMatchObject({
      runId: "run_life_1",
      status: "running",
      provider: "claude-code-cli",
      role: "planner"
    });
    await expect(readRunSidecar(workspace, "run_life_1")).resolves.toMatchObject({
      status: "running",
      promptHash: expect.any(String)
    });
    await expect(readMailboxRecords(workspace, "run_life_1", "events")).resolves.toHaveLength(1);
  });

  it("writes failed sidecar and event when provider start throws", async () => {
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_start_failure",
      now: () => new Date("2026-05-11T00:00:00.000Z"),
      startSession: () => {
        throw new Error("spawn failed");
      }
    });

    await expect(
      manager.startRun({ role: "planner", task: "Review", cwd: workspace })
    ).rejects.toThrow("spawn failed");

    await expect(readRunSidecar(workspace, "run_start_failure")).resolves.toMatchObject({
      status: "failed",
      cleanup: "partial",
      verdict: { status: "BLOCKED", summary: expect.stringContaining("spawn failed") }
    });
    await expect(readMailboxRecords(workspace, "run_start_failure", "events")).resolves.toMatchObject([
      { messageType: "running" },
      { messageType: "failed" }
    ]);
  });

  it("transitions to completed when the provider handle completes", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_life_2",
      now: () => new Date("2026-05-11T00:00:00.000Z"),
      startSession: () => handle
    });

    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    done.resolve("completed");

    const completed = await waitForSidecar(
      "run_life_2",
      (sidecar) => sidecar.status === "completed"
    );
    expect(completed).toMatchObject({
      status: "completed",
      providerSessionId: "session_123",
      verdict: { status: "SHIP", summary: "ready" },
      cleanup: "complete"
    });
  });

  it("transitions to expired when the provider handle times out", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_life_expired",
      now: () => new Date("2026-05-11T00:00:00.000Z"),
      startSession: () => handle
    });

    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    done.resolve("expired");

    const expired = await waitForSidecar(
      "run_life_expired",
      (sidecar) => sidecar.status === "expired"
    );
    expect(expired).toMatchObject({
      status: "expired",
      providerSessionId: "session_123",
      outputSummary: "Provider session expired after timeout.",
      cleanup: "partial",
      verdict: {
        status: "BLOCKED",
        summary: "Provider session expired after timeout."
      }
    });
    expect(expired.evidencePaths).toEqual(
      expect.arrayContaining(["/tmp/run.log", "/tmp/transcript.jsonl"])
    );
    await expect(readMailboxRecords(workspace, "run_life_expired", "events")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "expired",
          payload: { status: "expired" }
        })
      ])
    );
  });

  it("enriches status from active handles and flags detached running sidecars", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_life_3",
      startSession: () => handle
    });

    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    await expect(manager.getStatus(workspace, "run_life_3")).resolves.toMatchObject({
      status: "running",
      recentActivities: [{ summary: "Finished" }]
    });

    const restartedManager = new AgentLifecycleManager();
    await expect(restartedManager.getStatus(workspace, "run_life_3")).resolves.toMatchObject({
      status: "running",
      detached: true,
      detachedAt: expect.any(String)
    });
    await expect(readRunSidecar(workspace, "run_life_3")).resolves.toMatchObject({
      status: "running",
      detached: true,
      detachedAt: expect.any(String),
      warnings: [
        "Run run_life_3 is running, but no active process handle is attached."
      ]
    });
    await restartedManager.getStatus(workspace, "run_life_3");
    await expect(readMailboxRecords(workspace, "run_life_3", "events")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "detached_handle_missing" })
      ])
    );
    const events = await readMailboxRecords(workspace, "run_life_3", "events");
    expect(
      events.filter((record) => record.messageType === "detached_handle_missing")
    ).toHaveLength(1);
    const persisted = await readRunSidecar(workspace, "run_life_3");
    expect(
      persisted.warnings?.filter((warning) => warning.includes("no active process handle"))
    ).toHaveLength(1);
  });

  it("does not mark terminal sidecars as detached", async () => {
    const terminal: RunSidecar = {
      runId: "run_terminal_not_detached",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: [],
      outputSummary: "Done"
    };
    await writeRunSidecar(workspace, terminal);

    await expect(
      new AgentLifecycleManager().getStatus(workspace, "run_terminal_not_detached")
    ).resolves.not.toHaveProperty("detached");
    await expect(
      readMailboxRecords(workspace, "run_terminal_not_detached", "events")
    ).resolves.toEqual([]);
  });

  it("cancels active runs without allowing late completion to overwrite cancelled", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_life_4",
      startSession: () => handle,
      cancelGraceMs: 0
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });

    const result = await manager.cancelRun(workspace, "run_life_4");
    done.resolve("completed");
    await flushMicrotasks();

    expect(handle.killed).toBe(true);
    expect(handle.forceKilled).toBe(true);
    expect(result.status).toBe("cancelled");
    await expect(readRunSidecar(workspace, "run_life_4")).resolves.toMatchObject({
      status: "cancelled",
      cleanup: "partial"
    });
    await expect(readMailboxRecords(workspace, "run_life_4", "control")).resolves.toMatchObject([
      { messageType: "cancel_requested" }
    ]);
  });

  it("records cancel intent for detached active-looking sidecars", async () => {
    const sidecar: RunSidecar = {
      runId: "run_detached",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    };
    await writeRunSidecar(workspace, sidecar);

    const result = await new AgentLifecycleManager().cancelRun(workspace, "run_detached");

    expect(result).toMatchObject({
      status: "running",
      detached: true,
      detachedAt: expect.any(String),
      message: expect.stringContaining("No active process")
    });
    await expect(readRunSidecar(workspace, "run_detached")).resolves.toMatchObject({
      status: "running",
      detached: true,
      detachedAt: expect.any(String)
    });
    await expect(readMailboxRecords(workspace, "run_detached", "control")).resolves.toHaveLength(1);
    await expect(readMailboxRecords(workspace, "run_detached", "events")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "detached_handle_missing" })
      ])
    );
  });

  it("closes input and records wind-down intent for detached active-looking sidecars", async () => {
    const sidecar: RunSidecar = {
      runId: "run_detached_wind",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    };
    await writeRunSidecar(workspace, sidecar);

    const result = await new AgentLifecycleManager({
      now: () => new Date("2026-05-11T00:02:00.000Z")
    }).windDownRun(workspace, "run_detached_wind");

    expect(result).toMatchObject({
      status: "winding-down",
      detached: true,
      message: expect.stringContaining("no active process")
    });
    await expect(readRunSidecar(workspace, "run_detached_wind")).resolves.toMatchObject({
      status: "winding-down",
      inputClosed: true,
      detached: true,
      detachedAt: "2026-05-11T00:02:00.000Z",
      windDownRequestedAt: "2026-05-11T00:02:00.000Z"
    });
    await expect(readMailboxRecords(workspace, "run_detached_wind", "control")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "wind_down_requested" })
      ])
    );
    const events = await readMailboxRecords(workspace, "run_detached_wind", "events");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "detached_handle_missing" })
      ])
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "wind_down_grace_elapsed" })
      ])
    );
  });

  it("records wind-down intent and writes stdin when supported", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_life_5",
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });

    const result = await manager.windDownRun(workspace, "run_life_5");

    expect(result.status).toBe("winding-down");
    expect(handle.stdin[0]).toContain("wind_down_requested");
    await expect(readMailboxRecords(workspace, "run_life_5", "control")).resolves.toMatchObject([
      { messageType: "wind_down_requested" }
    ]);
  });

  it("closes normal input and requests final summary during wind-down", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_wind_close",
      now: () => new Date("2026-05-11T00:01:30.000Z"),
      windDownGraceMs: 0,
      sleep: async () => undefined,
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });

    const result = await manager.windDownRun(workspace, "run_wind_close");

    expect(result.status).toBe("winding-down");
    const sidecar = await readRunSidecar(workspace, "run_wind_close");
    expect(sidecar).toMatchObject({
      status: "winding-down",
      inputClosed: true,
      windDownRequestedAt: "2026-05-11T00:01:30.000Z"
    });
    expect(JSON.parse(handle.stdin.at(-1)!)).toMatchObject({
      type: "agent_team_wind_down",
      runId: "run_wind_close",
      instruction: expect.stringContaining("final verdict")
    });
  });

  it("rejects normal messages after wind-down closes input", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_wind_reject",
      windDownGraceMs: 0,
      sleep: async () => undefined,
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    await manager.windDownRun(workspace, "run_wind_reject");

    await expect(
      manager.messageRun({
        runId: "run_wind_reject",
        cwd: workspace,
        message: "One more thing."
      })
    ).rejects.toThrow("not accepting new messages");
    await expect(readMailboxRecords(workspace, "run_wind_reject", "inbox")).resolves.toEqual([]);
  });

  it("returns completed when the provider settles inside the wind-down grace window", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_wind_completed",
      windDownGraceMs: 50,
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });

    const windDown = manager.windDownRun(workspace, "run_wind_completed");
    done.resolve("completed");

    await expect(windDown).resolves.toMatchObject({ status: "completed" });
  });

  it("leaves runs winding down after grace expires without killing the provider", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_wind_elapsed",
      windDownGraceMs: 1,
      sleep: async () => undefined,
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });

    const result = await manager.windDownRun(workspace, "run_wind_elapsed");

    expect(result.status).toBe("winding-down");
    expect(handle.killed).toBe(false);
    expect(handle.forceKilled).toBe(false);
    await expect(readMailboxRecords(workspace, "run_wind_elapsed", "events")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "wind_down_grace_elapsed" })
      ])
    );
  });

  it("records messages durably without mutating the parent run status", async () => {
    const sidecar: RunSidecar = {
      runId: "run_parent_message",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      capabilitiesUsed: ["structuredOutput", "sessionResume"],
      evidencePaths: [],
      providerSessionId: "session_parent"
    };
    await writeRunSidecar(workspace, sidecar);

    const result = await new AgentLifecycleManager({
      now: () => new Date("2026-05-11T00:01:00.000Z")
    }).messageRun({
      runId: "run_parent_message",
      cwd: workspace,
      message: "Please account for the new constraint.",
      correlationId: "msg_1"
    });

    expect(result).toMatchObject({
      runId: "run_parent_message",
      status: "recorded_for_resume",
      message: expect.stringContaining("recorded")
    });
    await expect(readMailboxRecords(workspace, "run_parent_message", "inbox")).resolves.toMatchObject([
      {
        sequence: 1,
        messageType: "user_message",
        correlationId: "msg_1",
        payload: { message: "Please account for the new constraint." }
      }
    ]);
    await expect(readRunSidecar(workspace, "run_parent_message")).resolves.toMatchObject({
      status: "completed",
      providerSessionId: "session_parent"
    });
  });

  it("delivers messages to active stdin-capable runs after inbox append", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_live_message",
      now: () => new Date("2026-05-11T00:01:00.000Z"),
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });

    const result = await manager.messageRun({
      runId: "run_live_message",
      cwd: workspace,
      message: "Please incorporate the new evidence.",
      messageType: "new_evidence",
      correlationId: "msg_live"
    });

    expect(result).toMatchObject({
      runId: "run_live_message",
      status: "delivered_live",
      message: expect.stringContaining("delivered")
    });
    const inbox = await readMailboxRecords(workspace, "run_live_message", "inbox");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      sequence: 1,
      messageType: "new_evidence",
      correlationId: "msg_live",
      payload: { message: "Please incorporate the new evidence." }
    });
    expect(handle.stdin).toHaveLength(1);
    expect(JSON.parse(handle.stdin[0]!)).toMatchObject({
      type: "agent_team_message",
      runId: "run_live_message",
      record: {
        sequence: 1,
        messageType: "new_evidence",
        payload: { message: "Please incorporate the new evidence." }
      }
    });
    await expect(readMailboxRecords(workspace, "run_live_message", "events")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "message_delivered_live" })
      ])
    );
  });

  it("records active messages for resume when live stdin is unsupported", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise, {
      supportsStdin: false,
      writeSucceeds: false
    });
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_recorded_message",
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });

    const result = await manager.messageRun({
      runId: "run_recorded_message",
      cwd: workspace,
      message: "Save for resume."
    });

    expect(result).toMatchObject({
      status: "recorded_for_resume",
      message: expect.stringContaining("recorded")
    });
    expect(handle.stdin).toEqual([]);
    await expect(readMailboxRecords(workspace, "run_recorded_message", "inbox")).resolves.toHaveLength(1);
    await expect(readMailboxRecords(workspace, "run_recorded_message", "events")).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "message_delivered_live" })
      ])
    );
  });

  it("persists provider outbox requests and transitions active runs to awaiting input", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_awaiting_input",
      now: () => new Date("2026-05-11T00:02:00.000Z"),
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    handle.snapshotValue = {
      ...handle.snapshotValue,
      pendingOutboxRequests: [
        {
          id: "ask_1",
          messageType: "clarification_request",
          correlationId: "corr_ask_1",
          createdAt: "2026-05-11T00:01:59.000Z",
          payload: { question: "Which failing test should I inspect first?" }
        }
      ]
    };

    const firstStatus = await manager.getStatus(workspace, "run_awaiting_input");
    const secondStatus = await manager.getStatus(workspace, "run_awaiting_input");
    const outbox = await readMailboxRecords(workspace, "run_awaiting_input", "outbox");

    expect(firstStatus).toMatchObject({
      status: "awaiting-input",
      awaitingInputSince: "2026-05-11T00:02:00.000Z",
      pendingOutboxRequest: {
        id: "ask_1",
        sequence: 1,
        messageType: "clarification_request",
        correlationId: "corr_ask_1",
        payload: { question: "Which failing test should I inspect first?" }
      }
    });
    expect(secondStatus.status).toBe("awaiting-input");
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      sequence: 1,
      messageType: "clarification_request",
      correlationId: "corr_ask_1",
      payload: { question: "Which failing test should I inspect first?" }
    });
  });

  it("deduplicates concurrent outbox reconciliation for the same provider request", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_outbox_race",
      now: () => new Date("2026-05-11T00:02:00.000Z"),
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    handle.snapshotValue = {
      ...handle.snapshotValue,
      pendingOutboxRequests: [
        {
          id: "ask_race_1",
          messageType: "clarification_request",
          correlationId: "corr_race_1",
          payload: { question: "Which race should be resolved?" }
        }
      ]
    };

    const statuses = await Promise.all(
      Array.from({ length: 12 }, () => manager.getStatus(workspace, "run_outbox_race"))
    );
    const outbox = await readMailboxRecords(workspace, "run_outbox_race", "outbox");
    const sidecar = await readRunSidecar(workspace, "run_outbox_race");

    expect(new Set(statuses.map((status) => status.status))).toEqual(
      new Set(["awaiting-input"])
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      sequence: 1,
      messageType: "clarification_request",
      correlationId: "corr_race_1"
    });
    expect(sidecar.outboxRequestIds).toEqual(["ask_race_1"]);
  });

  it("records replies to awaiting-input runs and resumes running status", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_awaiting_reply",
      now: () => new Date("2026-05-11T00:02:30.000Z"),
      startSession: () => handle
    });
    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    handle.snapshotValue = {
      ...handle.snapshotValue,
      pendingOutboxRequests: [
        {
          id: "ask_reply_1",
          messageType: "approval_request",
          correlationId: "corr_reply_1",
          payload: { question: "May I inspect CI logs?" }
        }
      ]
    };
    await manager.getStatus(workspace, "run_awaiting_reply");

    const result = await manager.messageRun({
      runId: "run_awaiting_reply",
      cwd: workspace,
      message: "Yes, inspect the failing CI logs.",
      correlationId: "msg_reply_1"
    });
    const sidecar = await readRunSidecar(workspace, "run_awaiting_reply");

    expect(result.status).toBe("delivered_live");
    expect(sidecar).toMatchObject({
      status: "running",
      outboxRequestIds: ["ask_reply_1"]
    });
    expect(sidecar.pendingOutboxRequest).toBeUndefined();
    expect(sidecar.awaitingInputSince).toBeUndefined();
    await expect(readMailboxRecords(workspace, "run_awaiting_reply", "inbox")).resolves.toMatchObject([
      {
        sequence: 1,
        messageType: "user_message",
        correlationId: "msg_reply_1",
        payload: { message: "Yes, inspect the failing CI logs." }
      }
    ]);
    await expect(readMailboxRecords(workspace, "run_awaiting_reply", "events")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ messageType: "awaiting_input_replied" })
      ])
    );
  });

  it("starts a child reply run by resuming the parent provider session", async () => {
    const parent: RunSidecar = {
      runId: "run_parent_reply",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      capabilitiesUsed: ["structuredOutput", "sessionResume"],
      evidencePaths: [],
      providerSessionId: "session_parent_reply"
    };
    await writeRunSidecar(workspace, parent);
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const starts: Array<{
      prompt: string;
      cwd?: string;
      runId: string;
      roleId?: string;
      executionPolicy?: string;
      sessionId?: string;
      permissionMode?: string;
      timeoutMs?: number;
    }> = [];
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_reply_child",
      now: () => new Date("2026-05-11T00:02:00.000Z"),
      startSession: (input) => {
        starts.push({
          prompt: input.prompt,
          cwd: input.cwd,
          runId: input.runId,
          ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
          ...(input.executionPolicy === undefined
            ? {}
            : { executionPolicy: input.executionPolicy }),
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          ...(input.permissionMode === undefined
            ? {}
            : { permissionMode: input.permissionMode }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
        });
        return handle;
      }
    });

    const result = await manager.replyRun({
      runId: "run_parent_reply",
      cwd: workspace,
      message: "Re-check this with the new evidence.",
      correlationId: "reply_1",
      timeoutMs: 4321
    });

    expect(result).toMatchObject({
      runId: "run_reply_child",
      parentRunId: "run_parent_reply",
      resumedFromRunId: "run_parent_reply",
      providerSessionId: "session_parent_reply",
      status: "running"
    });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      runId: "run_reply_child",
      roleId: "planner",
      executionPolicy: "read-only",
      sessionId: "session_parent_reply",
      timeoutMs: 4321
    });
    expect(starts[0]?.prompt).toContain("resumed continuation");
    expect(starts[0]?.prompt).toContain("Re-check this with the new evidence.");
    await expect(readRunSidecar(workspace, "run_reply_child")).resolves.toMatchObject({
      runId: "run_reply_child",
      parentRunId: "run_parent_reply",
      resumedFromRunId: "run_parent_reply",
      resumeSequence: 1,
      providerSessionId: "session_parent_reply",
      status: "running"
    });
    await expect(readMailboxRecords(workspace, "run_parent_reply", "inbox")).resolves.toMatchObject([
      { sequence: 1, messageType: "user_message", correlationId: "reply_1" }
    ]);
    await expect(readRunSidecar(workspace, "run_parent_reply")).resolves.toMatchObject({
      status: "completed"
    });
  });

  it("rejects reply runs when no provider session id is available", async () => {
    const parent: RunSidecar = {
      runId: "run_no_session",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    };
    await writeRunSidecar(workspace, parent);

    await expect(
      new AgentLifecycleManager().replyRun({
        runId: "run_no_session",
        cwd: workspace,
        message: "Continue"
      })
    ).rejects.toThrow("provider session id");
  });

  it("rejects slice implementer runs when write mode is disabled", async () => {
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_slice_blocked",
      startSession: () => {
        throw new Error("should not start provider");
      }
    });

    await expect(
      manager.startRun({
        role: "slice-implementer",
        task: "Implement a bounded change.",
        cwd: workspace
      })
    ).rejects.toThrow("write mode is disabled");
  });

  it("starts slice implementer runs inside a retained isolated worktree", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const starts: Array<{
      prompt: string;
      cwd: string;
      workspaceRoot: string;
      roleId?: string;
      executionPolicy?: string;
      permissionMode?: string;
    }> = [];
    const manager = new AgentLifecycleManager({
      config: {
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false }
      },
      createRunId: () => "run_slice_1",
      now: () => new Date("2026-05-11T00:03:00.000Z"),
      allocateWorkspace: async () => ({
        sourceCwd: workspace,
        executionCwd: `${workspace}-worktree`,
        branchName: "agent-team/run_slice_1",
        baseRef: "HEAD",
        isolation: "git-worktree",
        retention: "retain-until-integrated",
        cleanup: "retained"
      }),
      startSession: (input) => {
        starts.push({
          prompt: input.prompt,
          cwd: input.cwd,
          workspaceRoot: input.workspaceRoot,
          ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
          ...(input.executionPolicy === undefined
            ? {}
            : { executionPolicy: input.executionPolicy }),
          ...(input.permissionMode === undefined
            ? {}
            : { permissionMode: input.permissionMode })
        });
        return handle;
      }
    });

    const result = await manager.startRun({
      role: "slice-implementer",
      task: "Implement a bounded change.",
      cwd: workspace
    });

    expect(result).toMatchObject({
      runId: "run_slice_1",
      status: "running",
      role: "slice-implementer",
      executionCwd: `${workspace}-worktree`
    });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      cwd: `${workspace}-worktree`,
      workspaceRoot: workspace,
      roleId: "slice-implementer",
      executionPolicy: "isolated-edit",
      permissionMode: "acceptEdits"
    });
    expect(starts[0]?.prompt).toContain("Execution workspace");
    expect(starts[0]?.prompt).toContain("Only modify files inside the execution workspace.");
    await expect(readRunSidecar(workspace, "run_slice_1")).resolves.toMatchObject({
      status: "running",
      sourceCwd: workspace,
      executionCwd: `${workspace}-worktree`,
      workspaceIsolation: "git-worktree",
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "retained"
    });
  });

  it("preserves isolated worktree metadata when slice provider start fails", async () => {
    const manager = new AgentLifecycleManager({
      config: {
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false }
      },
      createRunId: () => "run_slice_failed",
      now: () => new Date("2026-05-11T00:04:00.000Z"),
      allocateWorkspace: async () => ({
        sourceCwd: workspace,
        executionCwd: `${workspace}-failed-worktree`,
        branchName: "agent-team/run_slice_failed",
        baseRef: "HEAD",
        isolation: "git-worktree",
        retention: "retain-until-integrated",
        cleanup: "retained"
      }),
      startSession: () => {
        throw new Error("spawn failed");
      }
    });

    await expect(
      manager.startRun({
        role: "slice-implementer",
        task: "Implement a bounded change.",
        cwd: workspace
      })
    ).rejects.toThrow("spawn failed");

    await expect(readRunSidecar(workspace, "run_slice_failed")).resolves.toMatchObject({
      status: "failed",
      executionCwd: `${workspace}-failed-worktree`,
      workspaceCleanup: "retained",
      cleanup: "partial"
    });
  });

  it("harvests changed files and diff evidence when implementation runs complete", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const inspected: string[] = [];
    const manager = new AgentLifecycleManager({
      config: {
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false }
      },
      createRunId: () => "run_slice_completed",
      now: () => new Date("2026-05-11T00:05:00.000Z"),
      allocateWorkspace: async () => ({
        sourceCwd: workspace,
        executionCwd: `${workspace}-completed-worktree`,
        branchName: "agent-team/run_slice_completed",
        baseRef: "HEAD",
        isolation: "git-worktree",
        retention: "retain-until-integrated",
        cleanup: "retained"
      }),
      inspectWorkspace: async ({ executionCwd }) => {
        inspected.push(executionCwd);
        return {
          changedFiles: ["src/core/config.ts"],
          statusSummary: [" M src/core/config.ts"],
          diffText: "diff --git a/src/core/config.ts b/src/core/config.ts\n"
        };
      },
      startSession: () => handle
    });

    await manager.startRun({
      role: "slice-implementer",
      task: "Implement a bounded change.",
      cwd: workspace
    });
    done.resolve("completed");

    const completed = await waitForSidecar(
      "run_slice_completed",
      (sidecar) => sidecar.status === "completed"
    );

    expect(inspected).toEqual([`${workspace}-completed-worktree`]);
    expect(completed).toMatchObject({
      changedFiles: ["src/core/config.ts"],
      workspaceStatus: [" M src/core/config.ts"],
      workspaceDiffPath: join(
        workspace,
        ".agent-team",
        "logs",
        "run_slice_completed.diff.patch"
      ),
      workspaceCleanup: "retained"
    });
    expect(completed.evidencePaths).toContain(
      join(workspace, ".agent-team", "logs", "run_slice_completed.diff.patch")
    );
    await expect(
      readFile(join(workspace, ".agent-team", "logs", "run_slice_completed.diff.patch"), "utf8")
    ).resolves.toContain("diff --git");
  });

  it("records empty implementation evidence without writing a diff path", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      config: {
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false }
      },
      createRunId: () => "run_slice_clean",
      allocateWorkspace: async () => ({
        sourceCwd: workspace,
        executionCwd: `${workspace}-clean-worktree`,
        branchName: "agent-team/run_slice_clean",
        baseRef: "HEAD",
        isolation: "git-worktree",
        retention: "retain-until-integrated",
        cleanup: "retained"
      }),
      inspectWorkspace: async () => ({
        changedFiles: [],
        statusSummary: []
      }),
      startSession: () => handle
    });

    await manager.startRun({
      role: "slice-implementer",
      task: "Implement a bounded change.",
      cwd: workspace
    });
    done.resolve("completed");

    const completed = await waitForSidecar(
      "run_slice_clean",
      (sidecar) => sidecar.status === "completed"
    );

    expect(completed.changedFiles).toEqual([]);
    expect(completed.workspaceStatus).toEqual([]);
    expect(completed.workspaceDiffPath).toBeUndefined();
  });

  it("does not inspect workspaces for read-only completions", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    let inspected = false;
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_readonly_no_inspect",
      inspectWorkspace: async () => {
        inspected = true;
        return { changedFiles: [], statusSummary: [] };
      },
      startSession: () => handle
    });

    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    done.resolve("completed");

    await waitForSidecar(
      "run_readonly_no_inspect",
      (sidecar) => sidecar.status === "completed"
    );
    expect(inspected).toBe(false);
  });

  it("harvests implementation evidence when provider sessions fail", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      config: {
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false }
      },
      createRunId: () => "run_slice_provider_failed",
      allocateWorkspace: async () => ({
        sourceCwd: workspace,
        executionCwd: `${workspace}-provider-failed-worktree`,
        branchName: "agent-team/run_slice_provider_failed",
        baseRef: "HEAD",
        isolation: "git-worktree",
        retention: "retain-until-integrated",
        cleanup: "retained"
      }),
      inspectWorkspace: async () => ({
        changedFiles: ["src/core/failure.ts"],
        statusSummary: [" M src/core/failure.ts"],
        diffText: "diff --git a/src/core/failure.ts b/src/core/failure.ts\n"
      }),
      startSession: () => handle
    });

    await manager.startRun({
      role: "slice-implementer",
      task: "Implement a bounded change.",
      cwd: workspace
    });
    done.resolve("failed");

    const failed = await waitForSidecar(
      "run_slice_provider_failed",
      (sidecar) => sidecar.status === "failed"
    );

    expect(failed).toMatchObject({
      status: "failed",
      cleanup: "partial",
      changedFiles: ["src/core/failure.ts"],
      workspaceStatus: [" M src/core/failure.ts"],
      workspaceCleanup: "retained",
      workspaceDiffPath: join(
        workspace,
        ".agent-team",
        "logs",
        "run_slice_provider_failed.diff.patch"
      )
    });
  });

  it("harvests implementation evidence when runs are cancelled", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      config: {
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false }
      },
      createRunId: () => "run_slice_cancelled",
      cancelGraceMs: 0,
      allocateWorkspace: async () => ({
        sourceCwd: workspace,
        executionCwd: `${workspace}-cancelled-worktree`,
        branchName: "agent-team/run_slice_cancelled",
        baseRef: "HEAD",
        isolation: "git-worktree",
        retention: "retain-until-integrated",
        cleanup: "retained"
      }),
      inspectWorkspace: async () => ({
        changedFiles: ["src/core/cancelled.ts"],
        statusSummary: [" M src/core/cancelled.ts"],
        diffText: "diff --git a/src/core/cancelled.ts b/src/core/cancelled.ts\n"
      }),
      startSession: () => handle
    });

    await manager.startRun({
      role: "slice-implementer",
      task: "Implement a bounded change.",
      cwd: workspace
    });
    const result = await manager.cancelRun(workspace, "run_slice_cancelled");

    expect(result.status).toBe("cancelled");
    await expect(readRunSidecar(workspace, "run_slice_cancelled")).resolves.toMatchObject({
      status: "cancelled",
      cleanup: "partial",
      changedFiles: ["src/core/cancelled.ts"],
      workspaceStatus: [" M src/core/cancelled.ts"],
      workspaceCleanup: "retained"
    });
  });

  it("does not block cancellation when implementation inspection fails", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    const manager = new AgentLifecycleManager({
      config: {
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false }
      },
      createRunId: () => "run_slice_cancel_inspect_failed",
      cancelGraceMs: 0,
      allocateWorkspace: async () => ({
        sourceCwd: workspace,
        executionCwd: `${workspace}-cancel-inspect-failed-worktree`,
        branchName: "agent-team/run_slice_cancel_inspect_failed",
        baseRef: "HEAD",
        isolation: "git-worktree",
        retention: "retain-until-integrated",
        cleanup: "retained"
      }),
      inspectWorkspace: async () => {
        throw new Error("status failed");
      },
      startSession: () => handle
    });

    await manager.startRun({
      role: "slice-implementer",
      task: "Implement a bounded change.",
      cwd: workspace
    });
    await manager.cancelRun(workspace, "run_slice_cancel_inspect_failed");

    await expect(readRunSidecar(workspace, "run_slice_cancel_inspect_failed")).resolves.toMatchObject({
      status: "cancelled",
      cleanup: "partial",
      warnings: [expect.stringContaining("status failed")]
    });
  });

  it("does not inspect workspaces for read-only cancellation", async () => {
    const done = deferred<ProviderSessionDoneStatus>();
    const handle = fakeHandle(done.promise);
    let inspected = false;
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_readonly_cancel_no_inspect",
      cancelGraceMs: 0,
      inspectWorkspace: async () => {
        inspected = true;
        return { changedFiles: [], statusSummary: [] };
      },
      startSession: () => handle
    });

    await manager.startRun({ role: "planner", task: "Review", cwd: workspace });
    await manager.cancelRun(workspace, "run_readonly_cancel_no_inspect");

    expect(inspected).toBe(false);
  });

  it("removes retained implementation worktrees only after explicit force cleanup", async () => {
    const sidecar: RunSidecar = {
      runId: "run_cleanup_success",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:10:00.000Z",
      capabilitiesUsed: ["structuredOutput", "edits", "workspaceIsolation"],
      evidencePaths: [join(workspace, ".agent-team", "logs", "run_cleanup_success.log")],
      sourceCwd: workspace,
      executionCwd: `${workspace}-cleanup-worktree`,
      workspaceIsolation: "git-worktree",
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "retained",
      workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_cleanup_success.diff.patch"),
      verdict: {
        status: "SHIP",
        summary: "ready",
        requiredChanges: [],
        evidence: ["tests"],
        risks: [],
        warnings: [],
        raw: "status: SHIP"
      }
    };
    await writeRunSidecar(workspace, sidecar);
    const removed: Array<{ executionCwd: string; force: boolean | undefined }> = [];
    const manager = new AgentLifecycleManager({
      now: () => new Date("2026-05-11T00:11:00.000Z"),
      cleanupWorkspace: async ({ lease, force }) => {
        removed.push({ executionCwd: lease.executionCwd, force });
        return { ...lease, cleanup: "removed" };
      }
    });

    const result = await manager.cleanupRunWorkspace({
      runId: "run_cleanup_success",
      cwd: workspace,
      force: true
    });

    expect(result).toMatchObject({
      runId: "run_cleanup_success",
      status: "removed",
      workspaceCleanup: "removed",
      message: expect.stringContaining("removed")
    });
    expect(removed).toEqual([
      { executionCwd: `${workspace}-cleanup-worktree`, force: true }
    ]);
    const updated = await readRunSidecar(workspace, "run_cleanup_success");
    expect(updated).toMatchObject({
      status: "completed",
      workspaceCleanup: "removed",
      workspaceDiffPath: sidecar.workspaceDiffPath,
      verdict: { status: "SHIP", summary: "ready" }
    });
    expect(updated.evidencePaths).toEqual(sidecar.evidencePaths);
    await expect(readMailboxRecords(workspace, "run_cleanup_success", "control")).resolves.toMatchObject([
      {
        messageType: "cleanup_requested",
        payload: { force: true }
      }
    ]);
    await expect(readMailboxRecords(workspace, "run_cleanup_success", "events")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "workspace_cleanup_removed",
          payload: {
            executionCwd: `${workspace}-cleanup-worktree`
          }
        })
      ])
    );
  });

  it("refuses cleanup without explicit force and preserves the retained worktree", async () => {
    await writeRunSidecar(workspace, {
      runId: "run_cleanup_unforced",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:10:00.000Z",
      capabilitiesUsed: ["structuredOutput", "edits", "workspaceIsolation"],
      evidencePaths: [],
      sourceCwd: workspace,
      executionCwd: `${workspace}-unforced-worktree`,
      workspaceIsolation: "git-worktree",
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "retained"
    });
    let cleanupCalled = false;
    const manager = new AgentLifecycleManager({
      cleanupWorkspace: async () => {
        cleanupCalled = true;
        throw new Error("should not cleanup");
      }
    });

    const result = await manager.cleanupRunWorkspace({
      runId: "run_cleanup_unforced",
      cwd: workspace,
      force: false
    });

    expect(result).toMatchObject({
      status: "blocked",
      workspaceCleanup: "retained",
      message: expect.stringContaining("force")
    });
    expect(cleanupCalled).toBe(false);
    await expect(readRunSidecar(workspace, "run_cleanup_unforced")).resolves.toMatchObject({
      workspaceCleanup: "retained"
    });
    await expect(readMailboxRecords(workspace, "run_cleanup_unforced", "control")).resolves.toMatchObject([
      { messageType: "cleanup_requested", payload: { force: false } }
    ]);
  });

  it("refuses cleanup for non-terminal implementation runs", async () => {
    await writeRunSidecar(workspace, {
      runId: "run_cleanup_running",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:10:00.000Z",
      capabilitiesUsed: ["structuredOutput", "edits", "workspaceIsolation"],
      evidencePaths: [],
      sourceCwd: workspace,
      executionCwd: `${workspace}-running-worktree`,
      workspaceIsolation: "git-worktree",
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "retained"
    });
    let cleanupCalled = false;
    const manager = new AgentLifecycleManager({
      cleanupWorkspace: async () => {
        cleanupCalled = true;
        throw new Error("should not cleanup");
      }
    });

    const result = await manager.cleanupRunWorkspace({
      runId: "run_cleanup_running",
      cwd: workspace,
      force: true
    });

    expect(result).toMatchObject({
      status: "blocked",
      workspaceCleanup: "retained",
      message: expect.stringContaining("terminal")
    });
    expect(cleanupCalled).toBe(false);
  });

  it("refuses cleanup for read-only runs without implementation workspace metadata", async () => {
    await writeRunSidecar(workspace, {
      runId: "run_cleanup_readonly",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:10:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });

    const result = await new AgentLifecycleManager().cleanupRunWorkspace({
      runId: "run_cleanup_readonly",
      cwd: workspace,
      force: true
    });

    expect(result).toMatchObject({
      status: "blocked",
      message: expect.stringContaining("implementation worktree")
    });
  });

  it("refuses cleanup for worktrees already marked removed", async () => {
    await writeRunSidecar(workspace, {
      runId: "run_cleanup_already_removed",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:10:00.000Z",
      capabilitiesUsed: ["structuredOutput", "edits", "workspaceIsolation"],
      evidencePaths: [],
      sourceCwd: workspace,
      executionCwd: `${workspace}-already-removed-worktree`,
      workspaceIsolation: "git-worktree",
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "removed"
    });
    let cleanupCalled = false;
    const manager = new AgentLifecycleManager({
      cleanupWorkspace: async () => {
        cleanupCalled = true;
        throw new Error("should not cleanup");
      }
    });

    const result = await manager.cleanupRunWorkspace({
      runId: "run_cleanup_already_removed",
      cwd: workspace,
      force: true
    });

    expect(result).toMatchObject({
      status: "blocked",
      workspaceCleanup: "removed",
      message: expect.stringContaining("already removed")
    });
    expect(cleanupCalled).toBe(false);
  });

  it("keeps retained cleanup state and records a warning when worktree removal fails", async () => {
    await writeRunSidecar(workspace, {
      runId: "run_cleanup_failed",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:10:00.000Z",
      capabilitiesUsed: ["structuredOutput", "edits", "workspaceIsolation"],
      evidencePaths: [],
      sourceCwd: workspace,
      executionCwd: `${workspace}-failed-cleanup-worktree`,
      workspaceIsolation: "git-worktree",
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "retained"
    });
    const manager = new AgentLifecycleManager({
      cleanupWorkspace: async () => {
        throw new Error("git worktree remove failed");
      }
    });

    const result = await manager.cleanupRunWorkspace({
      runId: "run_cleanup_failed",
      cwd: workspace,
      force: true
    });

    expect(result).toMatchObject({
      status: "failed",
      workspaceCleanup: "retained",
      message: expect.stringContaining("git worktree remove failed")
    });
    await expect(readRunSidecar(workspace, "run_cleanup_failed")).resolves.toMatchObject({
      workspaceCleanup: "retained",
      warnings: [expect.stringContaining("git worktree remove failed")]
    });
  });
});
