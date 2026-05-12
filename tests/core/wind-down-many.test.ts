import { describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../src/core/errors.js";
import { windDownAgentRuns } from "../../src/core/wind-down-many.js";
import type { AgentControlResult } from "../../src/core/types.js";

function controlResult(runId: string, status: AgentControlResult["status"]): AgentControlResult {
  return {
    runId,
    status,
    sidecarPath: `/repo/.agent-team/runs/${runId}.json`,
    message: `Wind-down result for ${runId}.`
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

describe("windDownAgentRuns", () => {
  it("winds down runs with bounded concurrency and preserves input order", async () => {
    const gates = Array.from({ length: 4 }, () => deferred<AgentControlResult>());
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const resultPromise = windDownAgentRuns(
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
        async windDownRun(_cwd, _runId) {
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
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(maxActive).toBe(2);

    gates[1]!.resolve(controlResult("run_1", "completed"));
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[2]!.resolve(controlResult("run_2", "winding-down"));
    gates[0]!.resolve(controlResult("run_0", "winding-down"));
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[3]!.resolve(controlResult("run_3", "failed"));

    await expect(resultPromise).resolves.toMatchObject({
      status: "ok",
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_0",
          cwd: "/repo",
          correlationId: "zero",
          result: { status: "winding-down" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_1",
          cwd: "/repo",
          correlationId: "one",
          result: { status: "completed" }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_2",
          cwd: "/other",
          correlationId: "two",
          result: { status: "winding-down" }
        },
        {
          status: "ok",
          index: 3,
          runId: "run_3",
          cwd: "/other",
          correlationId: "three",
          result: { status: "failed" }
        }
      ]
    });
    expect(maxActive).toBe(2);
  });

  it("records per-run failures and continues queued wind-downs", async () => {
    const attempted: string[] = [];

    const result = await windDownAgentRuns(
      {
        concurrency: 1,
        runs: [
          { runId: "run_ok_1", cwd: "/repo" },
          { runId: "run_bad", cwd: "/repo", correlationId: "bad" },
          { runId: "run_ok_2", cwd: "/repo" }
        ]
      },
      {
        async windDownRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_bad") {
            throw new Error("wind down boom");
          }
          return controlResult(runId, "winding-down");
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
          error: "wind down boom"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("converts one StateCorruptionError into a recovered item without aborting the batch", async () => {
    const result = await windDownAgentRuns(
      {
        concurrency: 2,
        runs: [
          { runId: "run_corrupt", cwd: "/repo", correlationId: "corrupt" },
          { runId: "run_ok", cwd: "/repo" }
        ]
      },
      {
        async windDownRun(_cwd, runId) {
          if (runId === "run_corrupt") {
            throw new StateCorruptionError("Invalid JSON", {
              path: "/repo/.agent-team/runs/run_corrupt.json",
              kind: "json"
            });
          }
          return controlResult(runId, "winding-down");
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
            operation: "agent_team_wind_down_many",
            recovery: "archived",
            interventionRequired: true
          }
        },
        { status: "ok", index: 1, runId: "run_ok", cwd: "/repo" }
      ]
    });
  });

  it("records recovery failures as per-run failures and continues queued wind-downs", async () => {
    const attempted: string[] = [];

    const result = await windDownAgentRuns(
      {
        concurrency: 1,
        runs: [
          { runId: "run_recovery_fails", cwd: "/repo", correlationId: "recover" },
          { runId: "run_after_recovery_failure", cwd: "/repo" }
        ]
      },
      {
        async windDownRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_recovery_fails") {
            throw new StateCorruptionError("Invalid JSON", {
              path: "/repo/.agent-team/runs/run_recovery_fails.json",
              kind: "json"
            });
          }
          return controlResult(runId, "winding-down");
        },
        async recoverStateCorruption() {
          throw new Error("archive failed");
        }
      }
    );

    expect(attempted).toEqual(["run_recovery_fails", "run_after_recovery_failure"]);
    expect(result).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "failed",
          index: 0,
          runId: "run_recovery_fails",
          cwd: "/repo",
          correlationId: "recover",
          error: "state recovery failed: archive failed"
        },
        {
          status: "ok",
          index: 1,
          runId: "run_after_recovery_failure",
          cwd: "/repo"
        }
      ]
    });
  });
});
