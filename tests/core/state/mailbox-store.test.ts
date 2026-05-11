import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../../src/core/errors.js";
import {
  appendControlRecord,
  appendEventRecord,
  appendInboxRecord,
  appendMailboxRecord,
  appendOutboxRecord,
  readMailboxRecords
} from "../../../src/core/state/mailbox-store.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-mailbox-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("mailbox-store", () => {
  it("appends monotonic records to a mailbox", async () => {
    const first = await appendMailboxRecord(workspace, "run_1", "inbox", {
      role: "planner",
      provider: "claude-code-cli",
      messageType: "clarification",
      correlationId: "corr_1",
      payload: { text: "Use read-only mode" }
    });
    const second = await appendMailboxRecord(workspace, "run_1", "inbox", {
      role: "planner",
      provider: "claude-code-cli",
      messageType: "evidence",
      correlationId: "corr_2",
      payload: { path: "logs/run_1.log" }
    });

    const records = await readMailboxRecords(workspace, "run_1", "inbox");

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(records[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("throws a typed error for corrupt JSONL", async () => {
    await appendMailboxRecord(workspace, "run_2", "outbox", {
      role: "debugger",
      provider: "claude-code-cli",
      messageType: "question",
      correlationId: "corr_3",
      payload: { text: "Need logs" }
    });
    await appendFile(
      join(workspace, ".agent-team", "mailboxes", "run_2", "outbox.jsonl"),
      "not-json\n",
      "utf8"
    );

    await expect(readMailboxRecords(workspace, "run_2", "outbox")).rejects.toThrow(
      StateCorruptionError
    );
  });

  it("appends typed control and event records to the correct mailbox", async () => {
    const control = await appendControlRecord(workspace, "run_3", {
      role: "planner",
      provider: "claude-code-cli",
      messageType: "cancel_requested",
      correlationId: "ctrl_1",
      payload: { reason: "user requested cancellation" }
    });
    const event = await appendEventRecord(workspace, "run_3", {
      role: "planner",
      provider: "claude-code-cli",
      messageType: "started",
      correlationId: "evt_1",
      payload: { status: "running" }
    });

    await expect(readMailboxRecords(workspace, "run_3", "control")).resolves.toEqual([
      control
    ]);
    await expect(readMailboxRecords(workspace, "run_3", "events")).resolves.toEqual([
      event
    ]);
  });

  it("serializes concurrent appends so sequences remain unique and monotonic", async () => {
    const records = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        appendMailboxRecord(workspace, "run_4", "events", {
          role: "debugger",
          provider: "claude-code-cli",
          messageType: "progress",
          correlationId: `evt_${index}`,
          payload: { index }
        })
      )
    );

    const stored = await readMailboxRecords(workspace, "run_4", "events");

    expect(new Set(records.map((record) => record.sequence)).size).toBe(20);
    expect(stored.map((record) => record.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1)
    );
  });

  it("appends typed inbox records for durable messages", async () => {
    const record = await appendInboxRecord(workspace, "run_5", {
      role: "planner",
      provider: "claude-code-cli",
      messageType: "user_message",
      correlationId: "msg_1",
      payload: { message: "Here is more evidence." }
    });

    const records = await readMailboxRecords(workspace, "run_5", "inbox");

    expect(record).toMatchObject({
      sequence: 1,
      runId: "run_5",
      messageType: "user_message",
      correlationId: "msg_1",
      payload: { message: "Here is more evidence." }
    });
    expect(records).toEqual([record]);
  });

  it("appends typed outbox records for agent requests", async () => {
    const record = await appendOutboxRecord(workspace, "run_6", {
      role: "debugger",
      provider: "claude-code-cli",
      messageType: "clarification_request",
      correlationId: "ask_1",
      payload: { question: "Which failing test should I prioritize?" }
    });

    const records = await readMailboxRecords(workspace, "run_6", "outbox");

    expect(record).toMatchObject({
      sequence: 1,
      runId: "run_6",
      role: "debugger",
      provider: "claude-code-cli",
      messageType: "clarification_request",
      correlationId: "ask_1",
      payload: { question: "Which failing test should I prioritize?" }
    });
    expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(records).toEqual([record]);
  });
});
