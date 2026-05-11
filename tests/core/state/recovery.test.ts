import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../../src/core/errors.js";
import { recoverStateCorruption } from "../../../src/core/state/recovery.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-recovery-"));
});

afterEach(async () => {
  await import("node:fs/promises").then((fs) =>
    fs.rm(workspace, { recursive: true, force: true })
  );
});

describe("state corruption recovery", () => {
  it("archives corrupt state files with metadata and returns intervention details", async () => {
    const corruptPath = join(workspace, ".agent-team", "runs", "run_corrupt.json");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{ nope", "utf8");

    const result = await recoverStateCorruption({
      workspaceRoot: workspace,
      runId: "run_corrupt",
      operation: "agent_team_status",
      now: () => new Date("2026-05-11T00:00:00.000Z"),
      error: new StateCorruptionError("Invalid JSON", {
        path: corruptPath,
        kind: "json"
      })
    });

    expect(result).toMatchObject({
      status: "state_corrupt",
      runId: "run_corrupt",
      operation: "agent_team_status",
      kind: "json",
      originalPath: corruptPath,
      recovery: "archived",
      interventionRequired: true
    });
    expect(result.archivePath).toContain(".agent-team/archive/");
    await expect(readFile(result.archivePath!, "utf8")).resolves.toBe("{ nope");
    const reason = JSON.parse(await readFile(result.reasonPath!, "utf8")) as unknown;
    expect(reason).toMatchObject({
      originalPath: corruptPath,
      archivePath: result.archivePath,
      kind: "json",
      archivedAt: "2026-05-11T00:00:00.000Z"
    });
  });

  it("returns an unarchived recovery result when corruption metadata is missing", async () => {
    const result = await recoverStateCorruption({
      workspaceRoot: workspace,
      operation: "agent_team_status",
      error: new StateCorruptionError("Unknown corrupt state")
    });

    expect(result).toEqual({
      status: "state_corrupt",
      operation: "agent_team_status",
      recovery: "unarchived",
      interventionRequired: true,
      message: "State corruption detected during agent_team_status. User intervention is required. No archive was possible because corruption metadata was incomplete."
    });
  });
});
