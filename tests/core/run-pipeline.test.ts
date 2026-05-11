import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendRunEvent,
  blockedVerdict,
  buildRunSidecar,
  completionEvidencePaths,
  finalizeRunSidecar,
  sidecarWithSnapshot,
  writeProviderPrintLog
} from "../../src/core/run-pipeline.js";
import { readMailboxRecords } from "../../src/core/state/mailbox-store.js";
import { runLogPath } from "../../src/core/state/paths.js";
import { readRunSidecar, writeRunSidecar } from "../../src/core/state/run-store.js";
import type { ParsedVerdict, RunSidecar } from "../../src/core/types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-run-pipeline-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const shipVerdict: ParsedVerdict = {
  status: "SHIP",
  summary: "ready",
  requiredChanges: [],
  evidence: ["test"],
  risks: [],
  warnings: [],
  raw: "raw verdict"
};

const baseSidecar: RunSidecar = {
  runId: "run_pipeline",
  role: "planner",
  provider: "claude-code-cli",
  status: "running",
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:00.000Z",
  capabilitiesUsed: ["structuredOutput", "tools"],
  evidencePaths: ["existing.log"],
  authMode: "subscription-oauth",
  promptHash: "a".repeat(64)
};

describe("run-pipeline", () => {
  it("builds blocked verdicts with optional evidence", () => {
    expect(blockedVerdict("blocked", ["exitCode: 2"])).toEqual({
      status: "BLOCKED",
      summary: "blocked",
      requiredChanges: [],
      evidence: ["exitCode: 2"],
      risks: [],
      warnings: [],
      raw: "blocked"
    });
  });

  it("builds a reusable run sidecar without imposing a start sequence", () => {
    expect(
      buildRunSidecar({
        runId: "run_build",
        role: "planner",
        provider: {
          id: "claude-code-cli",
          displayName: "Claude Code CLI",
          authMode: "subscription-oauth",
          capabilities: ["structuredOutput", "tools"],
          available: true
        },
        status: "queued",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:00.000Z",
        evidencePaths: [],
        promptHash: "b".repeat(64),
        logPath: "/tmp/run_build.log"
      })
    ).toMatchObject({
      runId: "run_build",
      role: "planner",
      provider: "claude-code-cli",
      status: "queued",
      authMode: "subscription-oauth",
      capabilitiesUsed: ["structuredOutput", "tools"],
      evidencePaths: [],
      promptHash: "b".repeat(64),
      logPath: "/tmp/run_build.log"
    });
  });

  it("writes provider print logs to the canonical run log path", async () => {
    const path = await writeProviderPrintLog(workspace, "run_log", {
      text: "verdict text",
      stdout: "json stdout",
      stderr: "warning stderr"
    });

    expect(path).toBe(runLogPath(workspace, "run_log"));
    await expect(readFile(path, "utf8")).resolves.toBe(
      "TEXT:\nverdict text\n\nSTDOUT:\njson stdout\n\nSTDERR:\nwarning stderr"
    );
  });

  it("enriches sidecars from provider snapshots and merges completion evidence once", () => {
    const enriched = sidecarWithSnapshot(baseSidecar, {
      text: "done",
      warnings: [],
      providerSessionId: "session_1",
      recentActivities: [
        { type: "text", summary: "Running tests", timestamp: 1 }
      ],
      currentActivity: null,
      pendingOutboxRequests: [],
      lastStderr: ["warning"],
      transcriptPath: "transcript.jsonl",
      logPath: "provider.log"
    });

    expect(enriched).toMatchObject({
      providerSessionId: "session_1",
      transcriptPath: "transcript.jsonl",
      logPath: "provider.log",
      lastStderr: ["warning"]
    });
    expect(
      completionEvidencePaths(enriched, {
        evidencePaths: ["existing.log", "workspace.diff"],
        logPath: "provider.log",
        transcriptPath: "transcript.jsonl"
      })
    ).toEqual(["existing.log", "provider.log", "transcript.jsonl", "workspace.diff"]);
  });

  it("appends run events with a run-id correlation default", async () => {
    await appendRunEvent({
      workspaceRoot: workspace,
      runId: "run_event",
      role: "planner",
      provider: "claude-code-cli",
      messageType: "running",
      createdAt: "2026-05-11T00:00:01.000Z",
      payload: { provider: "claude-code-cli" }
    });

    await expect(readMailboxRecords(workspace, "run_event", "events")).resolves.toMatchObject([
      {
        runId: "run_event",
        role: "planner",
        provider: "claude-code-cli",
        messageType: "running",
        correlationId: "run_event",
        createdAt: "2026-05-11T00:00:01.000Z",
        payload: { provider: "claude-code-cli" }
      }
    ]);
  });

  it("finalizes completed runs with verdict, cleanup, event, and de-duplicated evidence", async () => {
    await writeRunSidecar(workspace, baseSidecar);

    const completed = await finalizeRunSidecar({
      workspaceRoot: workspace,
      runId: "run_pipeline",
      status: "completed",
      provider: "claude-code-cli",
      updatedAt: "2026-05-11T00:00:05.000Z",
      verdict: shipVerdict,
      cleanup: "complete",
      outputSummary: shipVerdict.summary,
      evidencePaths: ["existing.log", "new.log"],
      logPath: "new.log",
      eventPayload: { verdict: shipVerdict.status }
    });

    expect(completed).toMatchObject({
      status: "completed",
      updatedAt: "2026-05-11T00:00:05.000Z",
      cleanup: "complete",
      outputSummary: "ready",
      verdict: shipVerdict,
      evidencePaths: ["existing.log", "new.log"],
      logPath: "new.log"
    });
    await expect(readRunSidecar(workspace, "run_pipeline")).resolves.toEqual(completed);
    await expect(readMailboxRecords(workspace, "run_pipeline", "events")).resolves.toMatchObject([
      {
        messageType: "completed",
        correlationId: "run_pipeline",
        payload: { verdict: "SHIP" }
      }
    ]);
  });

  it("finalizes failed runs with partial cleanup and provider session metadata", async () => {
    await writeRunSidecar(workspace, { ...baseSidecar, runId: "run_failed" });
    const verdict = blockedVerdict("Provider runtime run failed.", ["exitCode: 2"]);

    const failed = await finalizeRunSidecar({
      workspaceRoot: workspace,
      runId: "run_failed",
      status: "failed",
      provider: "claude-code-cli",
      updatedAt: "2026-05-11T00:00:05.000Z",
      verdict,
      cleanup: "partial",
      outputSummary: verdict.summary,
      providerSessionId: "session_failed",
      eventPayload: { status: "failed" }
    });

    expect(failed).toMatchObject({
      status: "failed",
      cleanup: "partial",
      providerSessionId: "session_failed",
      outputSummary: "Provider runtime run failed."
    });
    await expect(readMailboxRecords(workspace, "run_failed", "events")).resolves.toMatchObject([
      {
        messageType: "failed",
        payload: { status: "failed" }
      }
    ]);
  });
});
