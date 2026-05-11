import { describe, expect, it } from "vitest";
import { startAgentTeamInParallel } from "../../src/core/parallel-start.js";
import type { AgentStartResult } from "../../src/core/types.js";

function startResult(runId: string, role: AgentStartResult["role"]): AgentStartResult {
  return {
    runId,
    status: "running",
    provider: "claude-code-cli",
    role,
    sidecarPath: `/repo/.agent-team/runs/${runId}.json`,
    logPath: `/repo/.agent-team/logs/${runId}.log`,
    mailboxPaths: {
      inbox: `/repo/.agent-team/mailboxes/${runId}/inbox.jsonl`,
      outbox: `/repo/.agent-team/mailboxes/${runId}/outbox.jsonl`,
      control: `/repo/.agent-team/mailboxes/${runId}/control.jsonl`,
      events: `/repo/.agent-team/mailboxes/${runId}/events.jsonl`
    }
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

describe("startAgentTeamInParallel", () => {
  it("starts runs with bounded concurrency and preserves input order", async () => {
    const gates = Array.from({ length: 5 }, () => deferred<AgentStartResult>());
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const resultPromise = startAgentTeamInParallel(
      {
        batchId: "batch_parallel",
        concurrency: 2,
        runs: [
          { role: "planner", task: "Plan", cwd: "/repo", correlationId: "plan" },
          { role: "code-reviewer", task: "Review", cwd: "/repo", correlationId: "review" },
          { role: "debugger", task: "Debug", cwd: "/repo", correlationId: "debug" },
          { role: "test-designer", task: "Test", cwd: "/repo", correlationId: "test" },
          { role: "architect", task: "Architect", cwd: "/repo", correlationId: "arch" }
        ]
      },
      {
        async startRun(request) {
          const index = started.length;
          started.push(index);
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            return await gates[index]!.promise;
          } finally {
            active -= 1;
          }
        }
      }
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(maxActive).toBe(2);

    gates[1]!.resolve(startResult("run_1", "code-reviewer"));
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[2]!.resolve(startResult("run_2", "debugger"));
    gates[0]!.resolve(startResult("run_0", "planner"));
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    gates[4]!.resolve(startResult("run_4", "architect"));
    gates[3]!.resolve(startResult("run_3", "test-designer"));

    await expect(resultPromise).resolves.toMatchObject({
      status: "started",
      batchId: "batch_parallel",
      concurrency: 2,
      runs: [
        { status: "started", index: 0, correlationId: "plan", run: { runId: "run_0" } },
        { status: "started", index: 1, correlationId: "review", run: { runId: "run_1" } },
        { status: "started", index: 2, correlationId: "debug", run: { runId: "run_2" } },
        { status: "started", index: 3, correlationId: "test", run: { runId: "run_3" } },
        { status: "started", index: 4, correlationId: "arch", run: { runId: "run_4" } }
      ]
    });
    expect(maxActive).toBe(2);
  });

  it("records child failures and continues starting queued runs", async () => {
    const attempted: string[] = [];

    const result = await startAgentTeamInParallel(
      {
        batchId: "batch_partial",
        concurrency: 1,
        runs: [
          { role: "planner", task: "Plan", cwd: "/repo", correlationId: "plan" },
          { role: "debugger", task: "Debug", cwd: "/repo", correlationId: "debug" },
          { role: "test-designer", task: "Test", cwd: "/repo", correlationId: "test" }
        ]
      },
      {
        async startRun(request) {
          attempted.push(request.role);
          if (request.role === "debugger") {
            throw new Error("provider failed to start");
          }
          return startResult(`run_${request.role}`, request.role);
        }
      }
    );

    expect(attempted).toEqual(["planner", "debugger", "test-designer"]);
    expect(result).toMatchObject({
      status: "partial_failure",
      batchId: "batch_partial",
      concurrency: 1,
      runs: [
        { status: "started", index: 0, correlationId: "plan", run: { runId: "run_planner" } },
        {
          status: "failed",
          index: 1,
          correlationId: "debug",
          role: "debugger",
          task: "Debug",
          error: "provider failed to start"
        },
        {
          status: "started",
          index: 2,
          correlationId: "test",
          run: { runId: "run_test-designer" }
        }
      ]
    });
  });
});
