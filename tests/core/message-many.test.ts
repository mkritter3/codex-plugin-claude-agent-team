import { describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../src/core/errors.js";
import { sendAgentMessages } from "../../src/core/message-many.js";
import type { AgentMessageResult } from "../../src/core/types.js";

function messageResult(runId: string, status: AgentMessageResult["status"]): AgentMessageResult {
  return {
    runId,
    status,
    record: {
      sequence: 1,
      runId,
      role: "planner",
      provider: "claude-code-cli",
      messageType: "user_message",
      createdAt: "2026-05-11T00:00:00.000Z",
      correlationId: `corr_${runId}`,
      contentHash: `hash_${runId}`,
      payload: { message: `message:${runId}` }
    },
    message:
      status === "delivered_live"
        ? "Message delivered live."
        : "Message recorded for resume."
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

describe("sendAgentMessages", () => {
  it("sends messages with bounded concurrency and preserves input order", async () => {
    const gates = Array.from({ length: 4 }, () => deferred<AgentMessageResult>());
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const resultPromise = sendAgentMessages(
      {
        concurrency: 2,
        messages: [
          { runId: "run_0", cwd: "/repo", message: "zero", correlationId: "zero" },
          { runId: "run_1", cwd: "/repo", message: "one", correlationId: "one" },
          {
            runId: "run_2",
            cwd: "/other",
            message: "two",
            messageType: "evidence",
            correlationId: "two"
          },
          { runId: "run_3", cwd: "/other", message: "three", correlationId: "three" }
        ]
      },
      {
        async messageRun(_request) {
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

    gates[1]!.resolve(messageResult("run_1", "recorded_for_resume"));
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[2]!.resolve(messageResult("run_2", "delivered_live"));
    gates[0]!.resolve(messageResult("run_0", "delivered_live"));
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[3]!.resolve(messageResult("run_3", "recorded_for_resume"));

    await expect(resultPromise).resolves.toMatchObject({
      status: "ok",
      messages: [
        {
          status: "ok",
          index: 0,
          runId: "run_0",
          cwd: "/repo",
          correlationId: "zero",
          result: { runId: "run_0", status: "delivered_live" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_1",
          cwd: "/repo",
          correlationId: "one",
          result: { runId: "run_1", status: "recorded_for_resume" }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_2",
          cwd: "/other",
          correlationId: "two",
          result: { runId: "run_2", status: "delivered_live" }
        },
        {
          status: "ok",
          index: 3,
          runId: "run_3",
          cwd: "/other",
          correlationId: "three",
          result: { runId: "run_3", status: "recorded_for_resume" }
        }
      ]
    });
    expect(maxActive).toBe(2);
  });

  it("records per-message failures and continues queued messages", async () => {
    const attempted: string[] = [];

    const result = await sendAgentMessages(
      {
        concurrency: 1,
        messages: [
          { runId: "run_ok_1", cwd: "/repo", message: "first" },
          { runId: "run_bad", cwd: "/repo", message: "bad", correlationId: "bad" },
          { runId: "run_ok_2", cwd: "/repo", message: "third" }
        ]
      },
      {
        async messageRun(request) {
          attempted.push(request.runId);
          if (request.runId === "run_bad") {
            throw new Error("message boom");
          }
          return messageResult(request.runId, "recorded_for_resume");
        },
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result).toMatchObject({
      status: "partial_failure",
      messages: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        {
          status: "failed",
          index: 1,
          runId: "run_bad",
          cwd: "/repo",
          correlationId: "bad",
          error: "message boom"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("converts one StateCorruptionError into a recovered item without aborting the batch", async () => {
    const result = await sendAgentMessages(
      {
        concurrency: 2,
        messages: [
          { runId: "run_corrupt", cwd: "/repo", message: "bad", correlationId: "corrupt" },
          { runId: "run_ok", cwd: "/repo", message: "ok" }
        ]
      },
      {
        async messageRun(request) {
          if (request.runId === "run_corrupt") {
            throw new StateCorruptionError("Invalid JSONL", {
              path: "/repo/.agent-team/mailboxes/run_corrupt/inbox.jsonl",
              kind: "jsonl"
            });
          }
          return messageResult(request.runId, "delivered_live");
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
      messages: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt",
          cwd: "/repo",
          correlationId: "corrupt",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt",
            operation: "agent_team_message_many",
            recovery: "archived",
            interventionRequired: true
          }
        },
        { status: "ok", index: 1, runId: "run_ok", cwd: "/repo" }
      ]
    });
  });

  it("records recovery failures as per-message failures and continues queued messages", async () => {
    const attempted: string[] = [];

    const result = await sendAgentMessages(
      {
        concurrency: 1,
        messages: [
          {
            runId: "run_recovery_fails",
            cwd: "/repo",
            message: "bad",
            correlationId: "recover"
          },
          { runId: "run_after_recovery_failure", cwd: "/repo", message: "after" }
        ]
      },
      {
        async messageRun(request) {
          attempted.push(request.runId);
          if (request.runId === "run_recovery_fails") {
            throw new StateCorruptionError("Invalid JSONL", {
              path: "/repo/.agent-team/mailboxes/run_recovery_fails/inbox.jsonl",
              kind: "jsonl"
            });
          }
          return messageResult(request.runId, "recorded_for_resume");
        },
        async recoverStateCorruption() {
          throw new Error("archive failed");
        }
      }
    );

    expect(attempted).toEqual(["run_recovery_fails", "run_after_recovery_failure"]);
    expect(result).toMatchObject({
      status: "partial_failure",
      messages: [
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
