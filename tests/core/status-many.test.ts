import { describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../src/core/errors.js";
import { readAgentStatuses } from "../../src/core/status-many.js";
import type { RunSidecar } from "../../src/core/types.js";

function sidecar(runId: string): RunSidecar {
  return {
    runId,
    role: "planner",
    provider: "claude-code-cli",
    status: "running",
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:01.000Z",
    capabilitiesUsed: ["structuredOutput"],
    evidencePaths: []
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

describe("readAgentStatuses", () => {
  it("reads statuses with bounded concurrency and preserves input order", async () => {
    const gates = Array.from({ length: 4 }, () => deferred<RunSidecar>());
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const resultPromise = readAgentStatuses(
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
        async getStatus(_cwd, _runId) {
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

    gates[1]!.resolve(sidecar("run_1"));
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[2]!.resolve(sidecar("run_2"));
    gates[0]!.resolve(sidecar("run_0"));
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[3]!.resolve(sidecar("run_3"));

    await expect(resultPromise).resolves.toMatchObject({
      status: "ok",
      runs: [
        { status: "ok", index: 0, runId: "run_0", cwd: "/repo", correlationId: "zero" },
        { status: "ok", index: 1, runId: "run_1", cwd: "/repo", correlationId: "one" },
        { status: "ok", index: 2, runId: "run_2", cwd: "/other", correlationId: "two" },
        { status: "ok", index: 3, runId: "run_3", cwd: "/other", correlationId: "three" }
      ]
    });
    expect(maxActive).toBe(2);
  });

  it("records per-run failures and continues reading queued statuses", async () => {
    const result = await readAgentStatuses(
      {
        concurrency: 1,
        runs: [
          { runId: "run_ok_1", cwd: "/repo" },
          { runId: "run_bad", cwd: "/repo", correlationId: "bad" },
          { runId: "run_ok_2", cwd: "/repo" }
        ]
      },
      {
        async getStatus(_cwd, runId) {
          if (runId === "run_bad") {
            throw new Error("status boom");
          }
          return sidecar(runId);
        },
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

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
          error: "status boom"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("converts one StateCorruptionError into a recovered item without aborting the batch", async () => {
    const result = await readAgentStatuses(
      {
        concurrency: 2,
        runs: [
          { runId: "run_corrupt", cwd: "/repo", correlationId: "corrupt" },
          { runId: "run_ok", cwd: "/repo" }
        ]
      },
      {
        async getStatus(_cwd, runId) {
          if (runId === "run_corrupt") {
            throw new StateCorruptionError("Invalid JSON", {
              path: "/repo/.agent-team/runs/run_corrupt.json",
              kind: "json"
            });
          }
          return sidecar(runId);
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
            operation: "agent_team_status_many",
            recovery: "archived",
            interventionRequired: true
          }
        },
        { status: "ok", index: 1, runId: "run_ok", cwd: "/repo" }
      ]
    });
  });
});
