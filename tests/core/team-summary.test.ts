import { describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../src/core/errors.js";
import { summarizeAgentTeam } from "../../src/core/team-summary.js";
import type { MailboxKind, MailboxRecord, RunSidecar } from "../../src/core/types.js";

const now = "2026-05-12T10:00:00.000Z";

function sidecar(runId: string, overrides: Partial<RunSidecar> = {}): RunSidecar {
  return {
    runId,
    role: "planner",
    provider: "claude-code-cli",
    status: "running",
    createdAt: now,
    updatedAt: now,
    capabilitiesUsed: ["structuredOutput"],
    evidencePaths: [],
    ...overrides
  };
}

function mailboxRecord(
  runId: string,
  kind: MailboxKind,
  sequence: number
): MailboxRecord {
  return {
    sequence,
    runId,
    role: "planner",
    provider: "claude-code-cli",
    messageType: `${kind}_message`,
    createdAt: now,
    correlationId: `${kind}_${sequence}`,
    contentHash: `${kind}_${sequence}_hash`,
    payload: { message: `${kind} ${sequence}` }
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("summarizeAgentTeam", () => {
  it("summarizes runs with bounded concurrency and preserves input order", async () => {
    const gates = Array.from({ length: 4 }, () => deferred<RunSidecar>());
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const resultPromise = summarizeAgentTeam(
      {
        concurrency: 2,
        runs: [
          { runId: "run_0", cwd: "/repo", correlationId: "zero" },
          { runId: "run_1", cwd: "/repo", correlationId: "one" },
          { runId: "run_2", cwd: "/other", correlationId: "two" },
          { runId: "run_3", cwd: "/other", correlationId: "three" }
        ]
      },
      {
        async readRun(_cwd, _runId) {
          const index = started.length;
          started.push(index);
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            return await gates[index]!.promise;
          } finally {
            active -= 1;
          }
        },
        async readMailbox() {
          return [];
        },
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(maxActive).toBe(2);

    gates[1]!.resolve(sidecar("run_1", { status: "awaiting-input" }));
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[2]!.resolve(sidecar("run_2", { status: "winding-down" }));
    gates[0]!.resolve(sidecar("run_0"));
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[3]!.resolve(sidecar("run_3", { status: "completed" }));

    await expect(resultPromise).resolves.toMatchObject({
      status: "ok",
      groups: {
        running: ["run_0"],
        awaitingInput: ["run_1"],
        windingDown: ["run_2"],
        terminal: ["run_3"]
      },
      runs: [
        { status: "ok", index: 0, runId: "run_0", cwd: "/repo", correlationId: "zero" },
        { status: "ok", index: 1, runId: "run_1", cwd: "/repo", correlationId: "one" },
        { status: "ok", index: 2, runId: "run_2", cwd: "/other", correlationId: "two" },
        { status: "ok", index: 3, runId: "run_3", cwd: "/other", correlationId: "three" }
      ]
    });
    expect(maxActive).toBe(2);
  });

  it("groups operational states and surfaces evidence pointers without synthesis", async () => {
    const result = await summarizeAgentTeam(
      {
        concurrency: 3,
        runs: [
          { runId: "run_active", cwd: "/repo", correlationId: "active" },
          { runId: "run_failed", cwd: "/repo" },
          { runId: "run_waiting", cwd: "/other" }
        ]
      },
      {
        async readRun(workspaceRoot, runId) {
          if (runId === "run_active") {
            return sidecar(runId, {
              detached: true,
              sourceCwd: workspaceRoot,
              executionCwd: "/repo/.worktrees/run_active",
              workspaceRetention: "retain-until-integrated",
              workspaceCleanup: "retained",
              workspaceDiffPath: "/repo/.agent-team/logs/run_active.diff.patch",
              workspaceStatus: ["M src/core/a.ts"],
              changedFiles: ["src/core/a.ts"],
              logPath: "/repo/.agent-team/logs/run_active.jsonl",
              transcriptPath: "/repo/.agent-team/transcripts/run_active.jsonl",
              evidencePaths: ["/repo/.agent-team/logs/run_active.diff.patch"],
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
          }
          if (runId === "run_failed") {
            return sidecar(runId, {
              status: "failed",
              executionCwd: "/repo/.worktrees/run_failed",
              workspaceRetention: "retain-until-integrated",
              workspaceCleanup: "retained"
            });
          }
          return sidecar(runId, {
            status: "awaiting-input",
            pendingOutboxRequest: {
              id: "ask_1",
              sequence: 1,
              messageType: "clarification_request",
              correlationId: "ask",
              createdAt: now,
              payload: { question: "Which file?" }
            }
          });
        },
        async readMailbox(_workspaceRoot, runId, kind) {
          return kind === "events"
            ? [mailboxRecord(runId, kind, 1), mailboxRecord(runId, kind, 2)]
            : [];
        },
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

    expect(result).toMatchObject({
      status: "ok",
      groups: {
        running: ["run_active"],
        awaitingInput: ["run_waiting"],
        terminal: ["run_failed"],
        failed: ["run_failed"],
        detached: ["run_active"],
        cleanupBlocked: ["run_failed"],
        retainedWorktree: ["run_active", "run_failed"]
      },
      runs: [
        {
          status: "ok",
          index: 0,
          correlationId: "active",
          run: {
            runId: "run_active",
            provider: "claude-code-cli",
            operationalState: "running",
            detached: true,
            retainedWorktree: true,
            cleanupBlocked: false
          },
          evidence: {
            sidecarPath: "/repo/.agent-team/runs/run_active.json",
            logPath: "/repo/.agent-team/logs/run_active.jsonl",
            transcriptPath: "/repo/.agent-team/transcripts/run_active.jsonl",
            workspaceDiffPath: "/repo/.agent-team/logs/run_active.diff.patch",
            evidencePaths: ["/repo/.agent-team/logs/run_active.diff.patch"],
            changedFiles: ["src/core/a.ts"],
            verdict: { status: "SHIP", summary: "ready" },
            mailboxes: { events: { count: 2, lastSequence: 2 } }
          }
        },
        {
          status: "ok",
          index: 1,
          run: {
            runId: "run_failed",
            operationalState: "terminal",
            retainedWorktree: true,
            cleanupBlocked: true
          }
        },
        {
          status: "ok",
          index: 2,
          run: {
            runId: "run_waiting",
            operationalState: "awaitingInput",
            pendingOutboxRequest: { id: "ask_1" }
          }
        }
      ]
    });
  });

  it("records per-run failures and continues queued summary reads", async () => {
    const attempted: string[] = [];
    const result = await summarizeAgentTeam(
      {
        concurrency: 1,
        runs: [
          { runId: "run_ok_1", cwd: "/repo" },
          { runId: "run_bad", cwd: "/repo", correlationId: "bad" },
          { runId: "run_ok_2", cwd: "/repo" }
        ]
      },
      {
        async readRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_bad") throw new Error("summary boom");
          return sidecar(runId);
        },
        async readMailbox() {
          return [];
        },
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        {
          status: "failed",
          index: 1,
          runId: "run_bad",
          cwd: "/repo",
          correlationId: "bad",
          error: "summary boom"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("converts one StateCorruptionError into a recovered item without aborting the batch", async () => {
    const result = await summarizeAgentTeam(
      {
        concurrency: 2,
        runs: [
          { runId: "run_corrupt", cwd: "/repo", correlationId: "corrupt" },
          { runId: "run_ok", cwd: "/repo" }
        ]
      },
      {
        async readRun(_cwd, runId) {
          if (runId === "run_corrupt") {
            throw new StateCorruptionError("Invalid JSON", {
              path: "/repo/.agent-team/runs/run_corrupt.json",
              kind: "json"
            });
          }
          return sidecar(runId, { status: "completed" });
        },
        async readMailbox() {
          return [];
        },
        async recoverStateCorruption(input) {
          return {
            status: "state_corrupt",
            runId: input.runId,
            operation: input.operation,
            recovery: "archived",
            interventionRequired: true
          };
        }
      }
    );

    expect(result).toMatchObject({
      status: "partial_failure",
      groups: { terminal: ["run_ok"] },
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt",
          cwd: "/repo",
          correlationId: "corrupt",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt",
            operation: "agent_team_summary",
            recovery: "archived",
            interventionRequired: true
          }
        },
        { status: "ok", index: 1, runId: "run_ok", cwd: "/repo" }
      ]
    });
  });

  it("reports recovery failure as a failed item", async () => {
    const result = await summarizeAgentTeam(
      {
        concurrency: 1,
        runs: [{ runId: "run_corrupt", cwd: "/repo" }]
      },
      {
        async readRun() {
          throw new StateCorruptionError("Invalid JSON", {
            path: "/repo/.agent-team/runs/run_corrupt.json",
            kind: "json"
          });
        },
        async readMailbox() {
          return [];
        },
        async recoverStateCorruption() {
          throw new Error("archive failed");
        }
      }
    );

    expect(result).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "failed",
          index: 0,
          runId: "run_corrupt",
          cwd: "/repo",
          error: "state recovery failed: archive failed"
        }
      ]
    });
  });
});
