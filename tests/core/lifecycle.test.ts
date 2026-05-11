import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLifecycleManager } from "../../src/core/lifecycle.js";
import { readMailboxRecords } from "../../src/core/state/mailbox-store.js";
import { readRunSidecar, writeRunSidecar } from "../../src/core/state/run-store.js";
import type { RunSidecar } from "../../src/core/types.js";
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

function fakeHandle(done: Promise<ProviderSessionDoneStatus>): ProviderSessionHandle & {
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
    lastStderr: [],
    transcriptPath: "/tmp/transcript.jsonl",
    logPath: "/tmp/run.log"
  };
  const handle = {
    killed: false,
    forceKilled: false,
    stdin: [] as string[],
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
      detached: true
    });
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
      message: expect.stringContaining("No active process")
    });
    await expect(readMailboxRecords(workspace, "run_detached", "control")).resolves.toHaveLength(1);
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
});
