import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRunSidecar, writeRunSidecar } from "../../../src/core/state/run-store.js";
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
});
