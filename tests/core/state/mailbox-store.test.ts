import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../../src/core/errors.js";
import {
  appendMailboxRecord,
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
});
