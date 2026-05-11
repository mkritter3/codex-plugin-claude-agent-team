import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WorkspaceLeaseError,
  allocateIsolatedWorktree,
  cleanupIsolatedWorktree,
  inspectImplementationWorkspace
} from "../../src/core/workspaces.js";
import { workspaceDiffPath } from "../../src/core/state/paths.js";

describe("isolated workspace leases", () => {
  it("allocates a retained git worktree outside the source checkout", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const lease = await allocateIsolatedWorktree({
      sourceCwd: "/tmp/project/src",
      runId: "run_123",
      execFile: async (file, args) => {
        calls.push({ file, args });
        if (args.includes("--show-toplevel")) {
          return { stdout: "/tmp/project\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      }
    });

    expect(lease).toEqual({
      sourceCwd: "/tmp/project",
      executionCwd: join("/tmp", ".agent-team-worktrees", "project", "run_123"),
      branchName: "agent-team/run_123",
      baseRef: "HEAD",
      isolation: "git-worktree",
      retention: "retain-until-integrated",
      cleanup: "retained"
    });
    expect(calls).toEqual([
      {
        file: "git",
        args: ["-C", "/tmp/project/src", "rev-parse", "--show-toplevel"]
      },
      {
        file: "git",
        args: [
          "-C",
          "/tmp/project",
          "worktree",
          "add",
          join("/tmp", ".agent-team-worktrees", "project", "run_123"),
          "-b",
          "agent-team/run_123",
          "HEAD"
        ]
      }
    ]);
  });

  it("fails closed when git cannot resolve the source root", async () => {
    await expect(
      allocateIsolatedWorktree({
        sourceCwd: "/tmp/project",
        runId: "run_no_git",
        execFile: async () => {
          throw new Error("not a git repository");
        }
      })
    ).rejects.toThrow(WorkspaceLeaseError);
  });

  it("refuses cleanup for retained worktrees unless force is explicit", async () => {
    const lease = {
      sourceCwd: "/tmp/project",
      executionCwd: "/tmp/.agent-team-worktrees/project/run_123",
      branchName: "agent-team/run_123",
      baseRef: "HEAD",
      isolation: "git-worktree" as const,
      retention: "retain-until-integrated" as const,
      cleanup: "retained" as const
    };

    await expect(cleanupIsolatedWorktree({ lease })).rejects.toThrow(
      "retained until integrated"
    );
  });

  it("removes a worktree when forced", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const lease = {
      sourceCwd: "/tmp/project",
      executionCwd: "/tmp/.agent-team-worktrees/project/run_123",
      branchName: "agent-team/run_123",
      baseRef: "HEAD",
      isolation: "git-worktree" as const,
      retention: "retain-until-integrated" as const,
      cleanup: "retained" as const
    };

    await expect(
      cleanupIsolatedWorktree({
        lease,
        force: true,
        execFile: async (file, args) => {
          calls.push({ file, args });
          return { stdout: "", stderr: "" };
        }
      })
    ).resolves.toMatchObject({ cleanup: "removed" });

    expect(calls).toEqual([
      {
        file: "git",
        args: [
          "-C",
          "/tmp/project",
          "worktree",
          "remove",
          "--force",
          "/tmp/.agent-team-worktrees/project/run_123"
        ]
      }
    ]);
  });

  it("builds a stable source-workspace diff evidence path", () => {
    expect(workspaceDiffPath("/repo", "run_1")).toBe(
      join("/repo", ".agent-team", "logs", "run_1.diff.patch")
    );
  });

  it("inspects implementation worktree status and binary diff", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const result = await inspectImplementationWorkspace({
      executionCwd: "/tmp/worktree",
      execFile: async (file, args) => {
        calls.push({ file, args });
        if (args.includes("status")) {
          return {
            stdout: [
              " M src/core/config.ts",
              "A  src/core/new.ts",
              " D src/core/old.ts",
              "R  src/a.ts -> src/b.ts",
              "?? docs/new.md"
            ].join("\n"),
            stderr: ""
          };
        }
        return { stdout: "diff --git a/src/core/config.ts b/src/core/config.ts\n", stderr: "" };
      }
    });

    expect(calls).toEqual([
      {
        file: "git",
        args: ["-C", "/tmp/worktree", "status", "--porcelain=v1"]
      },
      {
        file: "git",
        args: ["-C", "/tmp/worktree", "diff", "--binary"]
      }
    ]);
    expect(result).toEqual({
      changedFiles: [
        "src/core/config.ts",
        "src/core/new.ts",
        "src/core/old.ts",
        "src/b.ts",
        "docs/new.md"
      ],
      statusSummary: [
        " M src/core/config.ts",
        "A  src/core/new.ts",
        " D src/core/old.ts",
        "R  src/a.ts -> src/b.ts",
        "?? docs/new.md"
      ],
      diffText: "diff --git a/src/core/config.ts b/src/core/config.ts\n"
    });
  });

  it("returns empty evidence for a clean implementation worktree", async () => {
    await expect(
      inspectImplementationWorkspace({
        executionCwd: "/tmp/worktree",
        execFile: async () => ({ stdout: "", stderr: "" })
      })
    ).resolves.toEqual({
      changedFiles: [],
      statusSummary: []
    });
  });

  it("fails closed when implementation workspace inspection fails", async () => {
    await expect(
      inspectImplementationWorkspace({
        executionCwd: "/tmp/worktree",
        execFile: async () => {
          throw new Error("git failed");
        }
      })
    ).rejects.toThrow(WorkspaceLeaseError);
  });
});
