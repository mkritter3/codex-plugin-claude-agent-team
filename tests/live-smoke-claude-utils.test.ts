import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function loadUtils(): Promise<{
  buildLiveSmokeReportStatus: (rows: Array<{ status?: string | undefined }>) => string;
  buildToolRequestOptions: (timeoutMs: number) => {
    timeout: number;
    maxTotalTimeout: number;
    resetTimeoutOnProgress: true;
  };
  compactStatusRows: (statusResult: unknown) => Array<{ runId?: string; status?: string }>;
  hasAllCompletedRuns: (statusResult: unknown) => boolean;
  isClaudeLiveSmokeSuccessfulStatus: (status?: string) => boolean;
  isTerminalRunStatus: (status?: string) => boolean;
  nonTerminalRunRefs: (
    statusResult: unknown,
    fallbackRefs: Array<{ runId: string; cwd?: string; correlationId?: string }>
  ) => Array<{ runId: string; cwd?: string; correlationId?: string }>;
}> {
  return import(pathToFileURL(join(repoRoot, "scripts/live-smoke-claude-utils.mjs")).href);
}

describe("Claude live smoke utilities", () => {
  it("treats only real terminal lifecycle states as terminal", async () => {
    const { isTerminalRunStatus } = await loadUtils();

    for (const status of ["completed", "failed", "expired", "cancelled"]) {
      expect(isTerminalRunStatus(status), status).toBe(true);
    }
    for (const status of [
      "running",
      "pending",
      "awaiting-input",
      "winding-down",
      "detached",
      "unknown",
      undefined
    ]) {
      expect(isTerminalRunStatus(status), String(status)).toBe(false);
    }
  });

  it("treats completed as the only successful Claude live-smoke terminal state", async () => {
    const { isClaudeLiveSmokeSuccessfulStatus } = await loadUtils();

    expect(isClaudeLiveSmokeSuccessfulStatus("completed")).toBe(true);
    for (const status of ["failed", "expired", "cancelled", "winding-down", "running"]) {
      expect(isClaudeLiveSmokeSuccessfulStatus(status), status).toBe(false);
    }
  });

  it("requires all tracked runs to complete before reporting success", async () => {
    const { buildLiveSmokeReportStatus, hasAllCompletedRuns } = await loadUtils();

    expect(buildLiveSmokeReportStatus([{ status: "completed" }, { status: "completed" }])).toBe(
      "completed"
    );
    for (const rows of [
      [],
      [{ status: "completed" }, { status: "winding-down" }],
      [{ status: "completed" }, { status: "failed" }],
      [{ status: "running" }],
      [{ status: undefined }]
    ]) {
      expect(buildLiveSmokeReportStatus(rows), JSON.stringify(rows)).toBe("failed");
    }

    expect(
      hasAllCompletedRuns({
        runs: [{ run: { status: "completed" } }, { status: "completed" }]
      })
    ).toBe(true);
    expect(
      hasAllCompletedRuns({
        runs: [{ run: { status: "completed" } }, { run: { status: "winding-down" } }]
      })
    ).toBe(false);
  });

  it("compacts public status rows without exposing provider internals", async () => {
    const { compactStatusRows } = await loadUtils();

    expect(
      compactStatusRows({
        runs: [
          {
            runId: "run-1",
            correlationId: "c-1",
            run: {
              role: "planner",
              status: "completed",
              verdict: { verdict: "SHIP" },
              sidecarPath: "/tmp/sidecar.json",
              logPath: "/tmp/run.log",
              transcriptPath: "/tmp/transcript.jsonl",
              evidencePaths: ["/tmp/evidence.json"],
              cleanup: { status: "not_required" },
              workspaceCleanup: { status: "retained" },
              providerSessionId: "must-not-leak"
            }
          }
        ]
      })
    ).toEqual([
      {
        runId: "run-1",
        role: "planner",
        correlationId: "c-1",
        status: "completed",
        verdict: "SHIP",
        sidecarPath: "/tmp/sidecar.json",
        logPath: "/tmp/run.log",
        transcriptPath: "/tmp/transcript.jsonl",
        evidencePaths: ["/tmp/evidence.json"],
        cleanup: { status: "not_required" },
        workspaceCleanup: { status: "retained" }
      }
    ]);
  });

  it("builds MCP request options that outlive provider execution timeouts", async () => {
    const { buildToolRequestOptions } = await loadUtils();

    expect(buildToolRequestOptions(120_000)).toEqual({
      timeout: 135_000,
      maxTotalTimeout: 135_000,
      resetTimeoutOnProgress: true
    });
  });

  it("returns only currently nonterminal refs for cleanup cancellation", async () => {
    const { nonTerminalRunRefs } = await loadUtils();
    const fallbackRefs = [
      { runId: "run-1", cwd: "/tmp/workspace", correlationId: "a" },
      { runId: "run-2", cwd: "/tmp/workspace", correlationId: "b" },
      { runId: "run-3", cwd: "/tmp/workspace", correlationId: "c" }
    ];

    expect(
      nonTerminalRunRefs(
        {
          runs: [
            { runId: "run-1", run: { status: "completed" } },
            { runId: "run-2", run: { status: "winding-down" } },
            { runId: "run-3", status: "failed" }
          ]
        },
        fallbackRefs
      )
    ).toEqual([{ runId: "run-2", cwd: "/tmp/workspace", correlationId: "b" }]);
  });
});
