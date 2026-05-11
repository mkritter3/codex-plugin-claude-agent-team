import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archiveCorruptStateFile } from "../../../src/core/state/archive.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-archive-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("state archive", () => {
  it("moves corrupt state files and writes a reason record", async () => {
    const corruptPath = join(workspace, ".agent-team", "runs", "run_bad.json");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{ nope", "utf8");

    const archived = await archiveCorruptStateFile({
      workspaceRoot: workspace,
      path: corruptPath,
      reason: "Invalid JSON at run_bad.json",
      kind: "json",
      now: () => new Date("2026-05-11T00:00:00.000Z")
    });

    expect(await exists(corruptPath)).toBe(false);
    await expect(readFile(archived.archivePath, "utf8")).resolves.toBe("{ nope");
    const reason = JSON.parse(await readFile(archived.reasonPath, "utf8")) as unknown;
    expect(reason).toMatchObject({
      originalPath: corruptPath,
      archivePath: archived.archivePath,
      reason: "Invalid JSON at run_bad.json",
      kind: "json",
      archivedAt: "2026-05-11T00:00:00.000Z"
    });
  });

  it("does not overwrite earlier archives for the same original path", async () => {
    const firstPath = join(workspace, ".agent-team", "mailboxes", "run_1", "outbox.jsonl");
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_1"), {
      recursive: true
    });
    await writeFile(firstPath, "first", "utf8");
    const first = await archiveCorruptStateFile({
      workspaceRoot: workspace,
      path: firstPath,
      reason: "first failure",
      kind: "jsonl",
      now: () => new Date("2026-05-11T00:00:00.000Z")
    });
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_1"), {
      recursive: true
    });
    await writeFile(firstPath, "second", "utf8");

    const second = await archiveCorruptStateFile({
      workspaceRoot: workspace,
      path: firstPath,
      reason: "second failure",
      kind: "jsonl",
      now: () => new Date("2026-05-11T00:00:00.000Z")
    });

    expect(second.archivePath).not.toBe(first.archivePath);
    await expect(readFile(first.archivePath, "utf8")).resolves.toBe("first");
    await expect(readFile(second.archivePath, "utf8")).resolves.toBe("second");
  });
});
