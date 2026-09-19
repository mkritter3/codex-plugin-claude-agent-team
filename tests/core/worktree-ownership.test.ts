import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWorktreeUnclaimed, claimWorktree, releaseWorktreeClaim } from "../../src/core/worktree-ownership.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("durable worktree ownership", () => {
  it("serializes competing claims through a filesystem record", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-team-ownership-"));
    roots.push(root);
    const base = { sourceCwd: root, executionCwd: join(root, "worktree"), lineageRootRunId: "run_root", host: "test", ownerPid: 1, ownerProcessStartIdentity: "1:0", claimedAt: "2026-09-18T00:00:00.000Z" };
    await claimWorktree({ ...base, activeRunId: "run_one", claimToken: "one" });
    await expect(claimWorktree({ ...base, activeRunId: "run_two", claimToken: "two" })).rejects.toThrow("already claimed");
    await expect(assertWorktreeUnclaimed(root, join(root, "worktree"))).rejects.toThrow("run_one");
    await releaseWorktreeClaim({ sourceCwd: root, executionCwd: join(root, "worktree"), claimToken: "one" });
    await expect(assertWorktreeUnclaimed(root, join(root, "worktree"))).resolves.toBeUndefined();
  });

  it("blocks a competing claim from a separate Node process", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-team-ownership-process-"));
    roots.push(root);
    const executionCwd = join(root, "worktree");
    const modulePath = new URL("../../src/core/worktree-ownership.ts", import.meta.url).pathname;
    const claim = { sourceCwd: root, executionCwd, lineageRootRunId: "run_root", activeRunId: "run_other_process", claimToken: "other", host: "test", ownerPid: 2, ownerProcessStartIdentity: "2:0", claimedAt: "2026-09-18T00:00:00.000Z" };
    const code = `import { claimWorktree } from ${JSON.stringify(modulePath)}; await claimWorktree(${JSON.stringify(claim)}); console.log("claimed"); await new Promise(resolve => setTimeout(resolve, 200));`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], { stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
      child.stderr.once("data", (data) => reject(new Error(String(data))));
    });
    await expect(claimWorktree({ sourceCwd: root, executionCwd, lineageRootRunId: "run_root", activeRunId: "run_local", claimToken: "local", host: "test", ownerPid: 1, ownerProcessStartIdentity: "1:0", claimedAt: "2026-09-18T00:00:00.000Z" })).rejects.toThrow("already claimed");
    await new Promise<void>((resolve) => child.once("close", () => resolve()));
  });

  it("uses real filesystem identities for symlink aliases and releases after removal", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-team-ownership-canonical-"));
    roots.push(root);
    const source = join(root, "source");
    const execution = join(root, "worktree");
    const sourceAlias = join(root, "source-alias");
    const executionAlias = join(root, "worktree-alias");
    await Promise.all([mkdir(source), mkdir(execution)]);
    await Promise.all([symlink(source, sourceAlias), symlink(execution, executionAlias)]);
    const identity = await claimWorktree({
      sourceCwd: sourceAlias,
      executionCwd: executionAlias,
      lineageRootRunId: "run_root",
      activeRunId: "run_alias",
      claimToken: "alias",
      host: "test",
      ownerPid: 1,
      ownerProcessStartIdentity: "1:0",
      claimedAt: "2026-09-18T00:00:00.000Z"
    });
    await expect(claimWorktree({
      sourceCwd: source,
      executionCwd: execution,
      lineageRootRunId: "run_root",
      activeRunId: "run_real",
      claimToken: "real",
      host: "test",
      ownerPid: 2,
      ownerProcessStartIdentity: "2:0",
      claimedAt: "2026-09-18T00:00:00.000Z"
    })).rejects.toThrow("already claimed");
    await rm(execution, { recursive: true, force: true });
    await releaseWorktreeClaim({ ...identity, claimToken: "alias" });
    await expect(assertWorktreeUnclaimed(source, execution)).resolves.toBeUndefined();
  });
});
