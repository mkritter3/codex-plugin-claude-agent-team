import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../../src/core/errors.js";
import {
  appendAuditRecord,
  readAuditRecords
} from "../../../src/core/state/audit-store.js";
import { auditEventsPath } from "../../../src/core/state/paths.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-audit-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("audit-store", () => {
  it("appends monotonic audit records to the shared audit log", async () => {
    const first = await appendAuditRecord(workspace, {
      eventType: "policy_allowed",
      operation: "dispatch",
      role: "planner",
      provider: "claude-code-cli",
      decision: "allowed",
      reason: "policy_allowed",
      details: { executionPolicy: "read-only" },
      createdAt: "2026-05-12T10:00:00.000Z"
    });
    const second = await appendAuditRecord(workspace, {
      eventType: "provider_selected",
      operation: "start",
      role: "code-reviewer",
      provider: "claude-code-cli",
      decision: "reported",
      reason: "provider_selected",
      details: { selector: "claude-code-cli" },
      createdAt: "2026-05-12T10:01:00.000Z"
    });

    await expect(readAuditRecords(workspace)).resolves.toEqual([first, second]);
    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(auditEventsPath(workspace)).toBe(
      join(workspace, ".agent-team", "audit", "events.jsonl")
    );
  });

  it("rejects audit details that could leak prompts, sessions, commands, or secrets", async () => {
    const forbiddenDetails = [
      { prompt: "hidden prompt" },
      { promptHash: "abc" },
      { providerSessionId: "session_1" },
      { commandArgs: ["claude", "-p"] },
      { payload: { text: "raw mailbox" } },
      { processId: 123 },
      { secret: "value" },
      { apiKey: "sk-test" }
    ];

    for (const details of forbiddenDetails) {
      await expect(
        appendAuditRecord(workspace, {
          eventType: "policy_blocked",
          operation: "start",
          role: "planner",
          provider: "claude-code-cli",
          decision: "blocked",
          reason: "policy_blocked",
          details
        })
      ).rejects.toThrow(/forbidden audit detail/i);
    }
  });

  it("reports corrupt audit JSONL as state corruption", async () => {
    await appendAuditRecord(workspace, {
      eventType: "policy_allowed",
      operation: "dispatch",
      role: "planner",
      provider: "claude-code-cli",
      decision: "allowed",
      reason: "policy_allowed",
      details: {}
    });
    await appendFile(auditEventsPath(workspace), "not-json\n", "utf8");

    await expect(readAuditRecords(workspace)).rejects.toThrow(StateCorruptionError);
    await expect(readAuditRecords(workspace)).rejects.toMatchObject({
      path: auditEventsPath(workspace),
      kind: "jsonl"
    } satisfies Partial<StateCorruptionError>);
  });
});
