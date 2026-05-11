import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidRunTransitionError,
  isTerminalRunStatus,
  readRunSidecar,
  transitionRunSidecar,
  writeRunSidecar
} from "../../../src/core/state/run-store.js";
import type { RunSidecar } from "../../../src/core/types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-run-store-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("run-store", () => {
  it("writes and reads a run sidecar atomically", async () => {
    const sidecar: RunSidecar = {
      runId: "run_123",
      role: "code-reviewer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: [".agent-team/logs/run_123.log"],
      cleanup: "complete"
    };

    await writeRunSidecar(workspace, sidecar);

    await expect(readRunSidecar(workspace, "run_123")).resolves.toEqual(sidecar);
  });

  it("identifies terminal run statuses", () => {
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("expired")).toBe(true);
    expect(isTerminalRunStatus("queued")).toBe(false);
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("winding-down")).toBe(false);
  });

  it("writes legal non-terminal to terminal transitions", async () => {
    const base: RunSidecar = {
      runId: "run_transition",
      role: "planner",
      provider: "claude-code-cli",
      status: "queued",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    };
    await writeRunSidecar(workspace, base);

    const running = await transitionRunSidecar(workspace, "run_transition", (current) => ({
      ...current,
      status: "running",
      updatedAt: "2026-05-11T00:00:01.000Z"
    }));
    const completed = await transitionRunSidecar(workspace, "run_transition", (current) => ({
      ...current,
      status: "completed",
      updatedAt: "2026-05-11T00:00:02.000Z",
      cleanup: "complete"
    }));

    expect(running.status).toBe("running");
    expect(completed.status).toBe("completed");
    await expect(readRunSidecar(workspace, "run_transition")).resolves.toMatchObject({
      status: "completed",
      cleanup: "complete"
    });
  });

  it("rejects stale transitions after a terminal state", async () => {
    const terminal: RunSidecar = {
      runId: "run_cancelled",
      role: "debugger",
      provider: "claude-code-cli",
      status: "cancelled",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: [],
      cleanup: "partial"
    };
    await writeRunSidecar(workspace, terminal);

    await expect(
      transitionRunSidecar(workspace, "run_cancelled", (current) => ({
        ...current,
        status: "running",
        updatedAt: "2026-05-11T00:00:02.000Z"
      }))
    ).rejects.toThrow(InvalidRunTransitionError);

    await expect(readRunSidecar(workspace, "run_cancelled")).resolves.toEqual(terminal);
  });

  it("allows idempotent terminal rewrites for the same status", async () => {
    const completed: RunSidecar = {
      runId: "run_completed",
      role: "code-reviewer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: [],
      cleanup: "partial"
    };
    await writeRunSidecar(workspace, completed);

    const updated = await transitionRunSidecar(workspace, "run_completed", (current) => ({
      ...current,
      status: "completed",
      updatedAt: "2026-05-11T00:00:02.000Z",
      cleanup: "complete"
    }));

    expect(updated.cleanup).toBe("complete");
    await expect(readRunSidecar(workspace, "run_completed")).resolves.toEqual(updated);
  });

  it("rejects stale non-terminal regressions", async () => {
    const windingDown: RunSidecar = {
      runId: "run_winding_down",
      role: "planner",
      provider: "claude-code-cli",
      status: "winding-down",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    };
    await writeRunSidecar(workspace, windingDown);

    await expect(
      transitionRunSidecar(workspace, "run_winding_down", (current) => ({
        ...current,
        status: "running",
        updatedAt: "2026-05-11T00:00:02.000Z"
      }))
    ).rejects.toThrow(InvalidRunTransitionError);

    const cancelling: RunSidecar = {
      ...windingDown,
      runId: "run_cancelling",
      status: "cancelling"
    };
    await writeRunSidecar(workspace, cancelling);

    await expect(
      transitionRunSidecar(workspace, "run_cancelling", (current) => ({
        ...current,
        status: "running",
        updatedAt: "2026-05-11T00:00:02.000Z"
      }))
    ).rejects.toThrow(InvalidRunTransitionError);
  });

  it("serializes concurrent sidecar transitions for the same run", async () => {
    const base: RunSidecar = {
      runId: "run_concurrent",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    };
    await writeRunSidecar(workspace, base);

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        transitionRunSidecar(workspace, "run_concurrent", (current) => ({
          ...current,
          status: "running",
          updatedAt: `2026-05-11T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
          warnings: [...(current.warnings ?? []), `warning_${index}`]
        }))
      )
    );

    const sidecar = await readRunSidecar(workspace, "run_concurrent");
    expect(sidecar.status).toBe("running");
    expect(new Set(sidecar.warnings)).toEqual(
      new Set(Array.from({ length: 20 }, (_, index) => `warning_${index}`))
    );
  });
});
