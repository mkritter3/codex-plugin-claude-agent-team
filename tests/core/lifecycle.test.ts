import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    supportsStdin: true,
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
      return true;
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
      sessionId?: string;
      permissionMode?: string;
    }> = [];
    const manager = new AgentLifecycleManager({
      createRunId: () => "run_reply_child",
      now: () => new Date("2026-05-11T00:02:00.000Z"),
      startSession: (input) => {
        starts.push({
          prompt: input.prompt,
          cwd: input.cwd,
          runId: input.runId,
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          ...(input.permissionMode === undefined
            ? {}
            : { permissionMode: input.permissionMode })
        });
        return handle;
      }
    });

    const result = await manager.replyRun({
      runId: "run_parent_reply",
      cwd: workspace,
      message: "Re-check this with the new evidence.",
      correlationId: "reply_1"
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
      sessionId: "session_parent_reply"
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
});
