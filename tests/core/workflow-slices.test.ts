import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workflowRecordPath } from "../../src/core/state/paths.js";
import {
  readWorkflowRecord,
  writeWorkflowRecord
} from "../../src/core/state/workflow-store.js";
import type {
  AgentMessageResult,
  AgentStartResult,
  MailboxRecord
} from "../../src/core/types.js";
import {
  startWorkflowSlices,
  unblockWorkflowSlice
} from "../../src/core/workflow-slices.js";
import type { WorkflowRecord, WorkflowSlice } from "../../src/core/workflow-types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-workflow-slices-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function slice(overrides: Partial<WorkflowSlice> = {}): WorkflowSlice {
  return {
    sliceId: "slice_core",
    title: "Core slice",
    state: "ready",
    ownerRole: "backend-engineer",
    dependencies: [],
    writeScope: ["src/core/workflow-slices.ts"],
    readScope: ["src/core"],
    acceptanceTests: ["workflow slice test"],
    expectedEvidence: ["focused tests"],
    riskLevel: "medium",
    requiredReviewers: ["code-reviewer"],
    ...overrides
  };
}

function workflowRecord(
  overrides: Partial<WorkflowRecord> = {}
): WorkflowRecord {
  const workflowId = overrides.workflowId ?? "workflow_slices";
  const createdAt = overrides.createdAt ?? "2026-05-13T10:00:00.000Z";
  return {
    workflowId,
    name: "Workflow Slices",
    createdAt,
    updatedAt: createdAt,
    planningStatus: "approved",
    goal: {
      title: "Ship slice orchestration",
      successCriteria: ["slices start safely"],
      constraints: ["bounded concurrency"],
      nonGoals: ["auto merge"]
    },
    seniorReview: {
      opusPlanning: { mode: "required-when-available" },
      opusImplementation: { mode: "required-when-available" }
    },
    slices: [
      slice({ sliceId: "slice_core", title: "Core", ownerRole: "backend-engineer" }),
      slice({
        sliceId: "slice_docs",
        title: "Docs",
        ownerRole: "docs-dx-writer",
        writeScope: ["docs/runbook.md"],
        state: "ready"
      }),
      slice({
        sliceId: "slice_blocked",
        title: "Blocked",
        ownerRole: "slice-implementer",
        dependencies: ["slice_core"],
        state: "blocked",
        blockedMode: "deferred-start"
      })
    ],
    consensusRounds: [],
    userEscalations: [],
    opusReviewEvidence: [],
    integrationQueue: [],
    codexRationale: [],
    evidencePath: workflowRecordPath(workspace, workflowId),
    ...overrides
  };
}

async function seed(record: WorkflowRecord = workflowRecord()): Promise<void> {
  await writeWorkflowRecord(workspace, record);
}

function startResult(runId: string, role: AgentStartResult["role"]): AgentStartResult {
  return {
    runId,
    status: "running",
    provider: "claude-code-cli",
    role,
    sidecarPath: `${workspace}/.agent-team/runs/${runId}.json`,
    logPath: `${workspace}/.agent-team/logs/${runId}.log`,
    executionCwd: `${workspace}/.worktrees/${runId}`,
    transcriptPath: `${workspace}/.agent-team/logs/${runId}.jsonl`,
    mailboxPaths: {
      inbox: `${workspace}/.agent-team/mailboxes/${runId}/inbox.jsonl`,
      outbox: `${workspace}/.agent-team/mailboxes/${runId}/outbox.jsonl`,
      control: `${workspace}/.agent-team/mailboxes/${runId}/control.jsonl`,
      events: `${workspace}/.agent-team/mailboxes/${runId}/events.jsonl`
    }
  };
}

function mailboxRecord(runId: string, sequence: number): MailboxRecord {
  return {
    sequence,
    runId,
    role: "slice-implementer",
    provider: "claude-code-cli",
    createdAt: "2026-05-13T11:00:00.000Z",
    messageType: "workflow_slice_unblocked",
    correlationId: `corr_${sequence}`,
    contentHash: `hash_${sequence}`,
    payload: { message: `unblock ${runId}` }
  };
}

describe("workflow slice orchestration", () => {
  it("rejects unapproved workflows and invalid selections before starting runs", async () => {
    await seed({ ...workflowRecord(), planningStatus: "in-consensus" });
    let called = false;

    await expect(
      startWorkflowSlices(
        {
          workspaceRoot: workspace,
          workflowId: "workflow_slices",
          concurrency: 2
        },
        {
          async startRun() {
            called = true;
            throw new Error("should not start");
          }
        }
      )
    ).rejects.toThrow("Workflow workflow_slices must be approved before starting slices");
    expect(called).toBe(false);

    await writeWorkflowRecord(workspace, workflowRecord());
    await expect(
      startWorkflowSlices(
        {
          workspaceRoot: workspace,
          workflowId: "workflow_slices",
          sliceIds: ["slice_missing"],
          concurrency: 1
        },
        {
          async startRun() {
            called = true;
            throw new Error("should not start");
          }
        }
      )
    ).rejects.toThrow("Unknown workflow slice id: slice_missing");
    expect(called).toBe(false);

    await expect(
      startWorkflowSlices(
        {
          workspaceRoot: workspace,
          workflowId: "workflow_slices",
          sliceIds: ["slice_core", "slice_core"],
          concurrency: 1
        },
        {
          async startRun() {
            called = true;
            throw new Error("should not start");
          }
        }
      )
    ).rejects.toThrow("Duplicate workflow slice id: slice_core");
    expect(called).toBe(false);

    await expect(
      startWorkflowSlices(
        {
          workspaceRoot: workspace,
          workflowId: "workflow_slices",
          sliceIds: ["slice_blocked"],
          concurrency: 1
        },
        {
          async startRun() {
            called = true;
            throw new Error("should not start");
          }
        }
      )
    ).rejects.toThrow("Workflow slice slice_blocked is blocked, not ready");
    expect(called).toBe(false);
  });

  it("starts ready slices with bounded concurrency and records per-slice run evidence", async () => {
    await seed();
    const started: string[] = [];

    const result = await startWorkflowSlices(
      {
        workspaceRoot: workspace,
        workflowId: "workflow_slices",
        concurrency: 1,
        provider: "claude-code-cli",
        timeoutMs: 1000,
        now: () => new Date("2026-05-13T11:00:00.000Z")
      },
      {
        async startRun(request) {
          started.push(request.role);
          expect(request.cwd).toBe(workspace);
          expect(request.provider).toBe("claude-code-cli");
          expect(request.timeoutMs).toBe(1000);
          expect(request.task).toContain("Workflow: Ship slice orchestration");
          return startResult(`run_${request.role}`, request.role);
        }
      }
    );

    expect(started).toEqual(["backend-engineer", "docs-dx-writer"]);
    expect(result).toMatchObject({
      status: "started",
      batchId: "workflow_slices_slices",
      concurrency: 1,
      slices: [
        {
          status: "started",
          index: 0,
          sliceId: "slice_core",
          run: { runId: "run_backend-engineer" }
        },
        {
          status: "started",
          index: 1,
          sliceId: "slice_docs",
          run: { runId: "run_docs-dx-writer" }
        }
      ]
    });
    expect(result.workflow.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sliceId: "slice_core",
          state: "running",
          runIds: ["run_backend-engineer"],
          runEvidence: [
            expect.objectContaining({
              runId: "run_backend-engineer",
              startedAt: "2026-05-13T11:00:00.000Z",
              sidecarPath: expect.stringContaining("run_backend-engineer.json"),
              mailboxPaths: {
                inbox: expect.stringContaining("run_backend-engineer/inbox.jsonl"),
                outbox: expect.stringContaining("run_backend-engineer/outbox.jsonl"),
                control: expect.stringContaining("run_backend-engineer/control.jsonl"),
                events: expect.stringContaining("run_backend-engineer/events.jsonl")
              }
            })
          ]
        })
      ])
    );
    expect(JSON.stringify(result.workflow)).not.toMatch(/internalPrompt|rawProvider|providerSession|commandArgs|secret/i);
  });

  it("records failed slice starts without dropping later slices", async () => {
    await seed();

    const result = await startWorkflowSlices(
      {
        workspaceRoot: workspace,
        workflowId: "workflow_slices",
        sliceIds: ["slice_core", "slice_docs"],
        concurrency: 1,
        now: () => new Date("2026-05-13T11:05:00.000Z")
      },
      {
        async startRun(request) {
          if (request.role === "backend-engineer") {
            throw new Error("provider policy rejected write mode");
          }
          return startResult("run_docs", request.role);
        }
      }
    );

    expect(result.status).toBe("partial_failure");
    expect(result.slices).toMatchObject([
      {
        status: "failed",
        index: 0,
        sliceId: "slice_core",
        error: "provider policy rejected write mode"
      },
      {
        status: "started",
        index: 1,
        sliceId: "slice_docs",
        run: { runId: "run_docs" }
      }
    ]);
    const stored = await readWorkflowRecord(workspace, "workflow_slices");
    expect(stored.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sliceId: "slice_core",
          state: "failed",
          startFailureEvidence: [
            expect.objectContaining({
              failedAt: "2026-05-13T11:05:00.000Z",
              error: "provider policy rejected write mode"
            })
          ]
        }),
        expect.objectContaining({
          sliceId: "slice_docs",
          state: "running",
          runIds: ["run_docs"]
        })
      ])
    );
  });

  it("records unblock evidence and moves a slice to ready only when dependencies are satisfied", async () => {
    await seed();

    const stillBlocked = await unblockWorkflowSlice(
      {
        workspaceRoot: workspace,
        workflowId: "workflow_slices",
        sliceId: "slice_blocked",
        dependencyEvidence: [
          {
            dependencySliceId: "slice_core",
            summary: "Core implementation is ready for dependent planning.",
            changedFiles: ["src/core/workflow-slices.ts"],
            evidencePaths: ["/repo/.agent-team/runs/run_core.json"],
            sourceRunId: "run_core"
          }
        ],
        now: () => new Date("2026-05-13T11:10:00.000Z")
      },
      {
        async messageRun() {
          throw new Error("should not notify");
        }
      }
    );
    expect(stillBlocked.status).toBe("ready");
    expect(stillBlocked.workflow.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sliceId: "slice_blocked",
          state: "ready",
          unblockEvidence: [
            expect.objectContaining({
              dependencySliceId: "slice_core",
              summary: "Core implementation is ready for dependent planning.",
              sourceRunId: "run_core"
            })
          ]
        })
      ])
    );
  });

  it("keeps a slice blocked when some dependency evidence is missing", async () => {
    await seed({
      ...workflowRecord(),
      slices: [
        slice({ sliceId: "slice_a", state: "approved" }),
        slice({ sliceId: "slice_b", state: "blocked" }),
        slice({
          sliceId: "slice_c",
          state: "blocked",
          dependencies: ["slice_a", "slice_b"]
        })
      ]
    });

    const result = await unblockWorkflowSlice(
      {
        workspaceRoot: workspace,
        workflowId: "workflow_slices",
        sliceId: "slice_c",
        dependencyEvidence: [
          {
            dependencySliceId: "slice_a",
            summary: "A is approved."
          }
        ],
        now: () => new Date("2026-05-13T11:11:00.000Z")
      },
      {
        async messageRun() {
          throw new Error("should not notify");
        }
      }
    );

    expect(result.status).toBe("blocked");
    expect(result.workflow.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sliceId: "slice_c", state: "blocked" })
      ])
    );
  });

  it("sends ordered unblock notifications with partial failure evidence", async () => {
    await seed();
    const notified: string[] = [];

    const result = await unblockWorkflowSlice(
      {
        workspaceRoot: workspace,
        workflowId: "workflow_slices",
        sliceId: "slice_blocked",
        dependencyEvidence: [
          {
            dependencySliceId: "slice_core",
            summary: "Core is ready."
          }
        ],
        notifyRunIds: ["run_waiting_1", "run_waiting_2"],
        message: "Dependency slice_core is ready. Re-check current source before editing.",
        concurrency: 1,
        correlationId: "unblock-core",
        now: () => new Date("2026-05-13T11:12:00.000Z")
      },
      {
        async messageRun(request): Promise<AgentMessageResult> {
          notified.push(request.runId);
          expect(request.messageType).toBe("workflow_slice_unblocked");
          expect(request.correlationId).toBe("unblock-core");
          if (request.runId === "run_waiting_2") {
            throw new Error("input is closed");
          }
          return {
            runId: request.runId,
            status: "recorded_for_resume",
            record: mailboxRecord(request.runId, notified.length),
            message: "recorded"
          };
        }
      }
    );

    expect(notified).toEqual(["run_waiting_1", "run_waiting_2"]);
    expect(result.status).toBe("partial_failure");
    expect(result.notifications).toMatchObject([
      { status: "ok", index: 0, runId: "run_waiting_1" },
      { status: "failed", index: 1, runId: "run_waiting_2", error: "input is closed" }
    ]);
    expect(result.workflow.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sliceId: "slice_blocked", state: "ready" })
      ])
    );
  });

  it("rejects invalid unblock input before recording evidence or sending messages", async () => {
    await seed();
    let called = false;
    await expect(
      unblockWorkflowSlice(
        {
          workspaceRoot: workspace,
          workflowId: "workflow_slices",
          sliceId: "slice_core",
          dependencyEvidence: [{ dependencySliceId: "slice_blocked", summary: "Nope" }],
          notifyRunIds: ["run_waiting"],
          concurrency: 1
        },
        {
          async messageRun() {
            called = true;
            throw new Error("should not notify");
          }
        }
      )
    ).rejects.toThrow("Workflow slice slice_core is ready, not blocked");
    expect(called).toBe(false);
  });
});
