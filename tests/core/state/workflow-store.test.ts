import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../../src/core/errors.js";
import {
  listWorkflowRecords,
  readWorkflowRecord,
  writeWorkflowRecord
} from "../../../src/core/state/workflow-store.js";
import { workflowRecordPath } from "../../../src/core/state/paths.js";
import type { WorkflowRecord } from "../../../src/core/workflow-types.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-workflow-store-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function workflowRecord(
  workflowId: string,
  createdAt: string,
  overrides: Partial<WorkflowRecord> = {}
): WorkflowRecord {
  const path = workflowRecordPath(workspace, workflowId);
  return {
    workflowId,
    name: `Workflow ${workflowId}`,
    createdAt,
    updatedAt: createdAt,
    goal: {
      title: "Ship the orchestrator foundation",
      successCriteria: ["state is durable", "review policy is explicit"],
      constraints: ["provider-neutral"],
      nonGoals: ["live provider calls"]
    },
    seniorReview: {
      opusPlanning: { mode: "required-when-available" },
      opusImplementation: { mode: "required-when-available" }
    },
    slices: [
      {
        sliceId: "slice_state_store",
        title: "Workflow state store",
        state: "ready",
        ownerRole: "planner",
        dependencies: [],
        writeScope: ["src/core/state/workflow-store.ts"],
        acceptanceTests: ["workflow store rejects corrupt records"]
      }
    ],
    consensusRounds: [
      {
        round: 1,
        phase: "planning",
        startedAt: createdAt,
        completedAt: createdAt,
        verdicts: [
          {
            reviewerRole: "planner",
            reviewerProvider: "claude-code-cli:opus",
            status: "approve",
            summary: "Plan is appropriately bounded.",
            evidenceRunId: "run_planning_1"
          }
        ],
        consensus: "approved"
      }
    ],
    userEscalations: [
      {
        escalationId: "esc_release_tradeoff",
        createdAt,
        status: "open",
        question: "Should this block release if Opus is unavailable?",
        productImpact: "Release confidence may be lower.",
        options: ["ship degraded", "wait for Opus"]
      }
    ],
    opusReviewEvidence: [
      {
        phase: "planning",
        status: "available",
        requiredMode: "required-when-available",
        checkedAt: createdAt,
        runId: "run_opus_1",
        provider: "claude-code-cli:opus",
        summary: "Opus reviewed the planning slice."
      }
    ],
    integrationQueue: [
      {
        sliceId: "slice_state_store",
        state: "awaiting-review",
        worktreePath: "/repo/.worktrees/slice_state_store",
        branchName: "codex/slice-state-store",
        reviewRunIds: ["run_opus_1"],
        queuePosition: 1,
        conflictRisk: "medium",
        riskReasons: ["write scope overlaps earlier queued slice slice_other: src/core"],
        changedFiles: ["src/core/state/workflow-store.ts"],
        dependencySliceIds: ["slice_other"],
        focusedTests: ["npm test -- tests/core/state/workflow-store.test.ts"],
        queuedAt: createdAt
      }
    ],
    evidencePath: path,
    ...overrides
  };
}

describe("workflow-store", () => {
  it("writes and reads a durable workflow record atomically", async () => {
    const record = workflowRecord("workflow_123", "2026-05-13T10:00:00.000Z");

    await writeWorkflowRecord(workspace, record);

    await expect(readWorkflowRecord(workspace, "workflow_123")).resolves.toEqual(record);
    expect(workflowRecordPath(workspace, "workflow_123")).toBe(
      join(workspace, ".agent-team", "workflows", "workflow_123.json")
    );
  });

  it("strict-parses workflow slice run, failure, and unblock evidence", async () => {
    const record = workflowRecord("workflow_slice_evidence", "2026-05-13T10:00:00.000Z", {
      slices: [
        {
          ...workflowRecord("workflow_slice_evidence", "2026-05-13T10:00:00.000Z").slices[0]!,
          state: "running",
          runIds: ["run_slice_1"],
          runEvidence: [
            {
              runId: "run_slice_1",
              startedAt: "2026-05-13T11:00:00.000Z",
              provider: "claude-code-cli",
              role: "slice-implementer",
              sidecarPath: "/repo/.agent-team/runs/run_slice_1.json",
              logPath: "/repo/.agent-team/logs/run_slice_1.log",
              executionCwd: "/repo/.worktrees/run_slice_1",
              transcriptPath: "/repo/.agent-team/logs/run_slice_1.jsonl",
              mailboxPaths: {
                inbox: "/repo/.agent-team/mailboxes/run_slice_1/inbox.jsonl",
                outbox: "/repo/.agent-team/mailboxes/run_slice_1/outbox.jsonl",
                control: "/repo/.agent-team/mailboxes/run_slice_1/control.jsonl",
                events: "/repo/.agent-team/mailboxes/run_slice_1/events.jsonl"
              }
            }
          ],
          startFailureEvidence: [
            {
              failedAt: "2026-05-13T11:01:00.000Z",
              error: "provider policy rejected write mode"
            }
          ],
          unblockEvidence: [
            {
              dependencySliceId: "slice_state_store",
              recordedAt: "2026-05-13T11:02:00.000Z",
              summary: "Dependency approved.",
              changedFiles: ["src/core/workflow-slices.ts"],
              evidencePaths: ["/repo/.agent-team/runs/run_slice_1.json"],
              sourceRunId: "run_slice_1"
            }
          ],
          implementationEvidence: {
            recordedAt: "2026-05-13T11:03:00.000Z",
            summary: "Implementation completed in a retained worktree.",
            changedFiles: ["src/core/workflow-review.ts"],
            testsRun: ["npm test -- tests/core/workflow-review.test.ts"],
            evidencePaths: ["/repo/.agent-team/runs/run_slice_1.json"],
            sourceRunId: "run_slice_1",
            worktreePath: "/repo/.worktrees/run_slice_1",
            knownRisks: ["integration queue is out of scope"]
          },
          reviewEvidence: [
            {
              reviewedAt: "2026-05-13T11:04:00.000Z",
              round: 1,
              consensus: "approved",
              summary: "Slice passed review.",
              reviewerRunIds: ["run_slice_1"]
            }
          ]
        }
      ]
    });

    await writeWorkflowRecord(workspace, record);

    await expect(readWorkflowRecord(workspace, "workflow_slice_evidence")).resolves.toEqual(record);
  });

  it("lists workflow records sorted by created time then workflow id", async () => {
    const latest = workflowRecord("workflow_c", "2026-05-13T10:00:02.000Z");
    const firstB = workflowRecord("workflow_b", "2026-05-13T10:00:00.000Z");
    const firstA = workflowRecord("workflow_a", "2026-05-13T10:00:00.000Z");

    await writeWorkflowRecord(workspace, latest);
    await writeWorkflowRecord(workspace, firstB);
    await writeWorkflowRecord(workspace, firstA);

    await expect(listWorkflowRecords(workspace)).resolves.toEqual([firstA, firstB, latest]);
  });

  it("returns an empty list when no workflows directory exists", async () => {
    await expect(listWorkflowRecords(workspace)).resolves.toEqual([]);
  });

  it("reports corrupt workflow record path and kind", async () => {
    const path = workflowRecordPath(workspace, "workflow_corrupt");
    await mkdir(join(workspace, ".agent-team", "workflows"), { recursive: true });
    await writeFile(path, "{ nope", "utf8");

    await expect(readWorkflowRecord(workspace, "workflow_corrupt")).rejects.toMatchObject({
      name: "StateCorruptionError",
      path,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });

  it("rejects unsafe workflow ids before resolving a state path", async () => {
    await expect(readWorkflowRecord(workspace, "../runs/run_escape")).rejects.toThrow(
      "Invalid workflow id"
    );
  });

  it("reports unknown top-level fields as corrupt state", async () => {
    const path = workflowRecordPath(workspace, "workflow_poisoned");
    await mkdir(join(workspace, ".agent-team", "workflows"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        ...workflowRecord("workflow_poisoned", "2026-05-13T10:00:00.000Z"),
        hiddenPrompt: "never expose this"
      }),
      "utf8"
    );

    await expect(readWorkflowRecord(workspace, "workflow_poisoned")).rejects.toMatchObject({
      name: "StateCorruptionError",
      path,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });

  it("reports workflow id and file name mismatch as corrupt state", async () => {
    const path = workflowRecordPath(workspace, "workflow_path");
    await mkdir(join(workspace, ".agent-team", "workflows"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        ...workflowRecord("workflow_other", "2026-05-13T10:00:00.000Z"),
        evidencePath: path
      }),
      "utf8"
    );

    await expect(readWorkflowRecord(workspace, "workflow_path")).rejects.toMatchObject({
      name: "StateCorruptionError",
      path,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });

  it.each([
    [
      "slice state",
      (base: WorkflowRecord) => ({
        ...base,
        slices: [{ ...base.slices[0], state: "almost-ready" }]
      })
    ],
    [
      "slice run evidence",
      (base: WorkflowRecord) => ({
        ...base,
        slices: [
          {
            ...base.slices[0],
            runEvidence: [
              {
                runId: "run_slice",
                startedAt: "2026-05-13T10:00:00.000Z",
                provider: "claude-code-cli",
                role: "planner",
                sidecarPath: "/repo/.agent-team/runs/run_slice.json",
                logPath: "/repo/.agent-team/logs/run_slice.log",
                rawProviderPayload: "nope"
              }
            ]
          }
        ]
      })
    ],
    [
      "reviewer verdict",
      (base: WorkflowRecord) => ({
        ...base,
        consensusRounds: [
          {
            ...base.consensusRounds[0],
            verdicts: [
              { ...base.consensusRounds[0]?.verdicts[0], status: "yes" }
            ]
          }
        ]
      })
    ],
    [
      "user escalation status",
      (base: WorkflowRecord) => ({
        ...base,
        userEscalations: [{ ...base.userEscalations[0], status: "waiting-on-human" }]
      })
    ],
    [
      "Opus availability status",
      (base: WorkflowRecord) => ({
        ...base,
        opusReviewEvidence: [{ ...base.opusReviewEvidence[0], status: "maybe" }]
      })
    ],
    [
      "integration queue state",
      (base: WorkflowRecord) => ({
        ...base,
        integrationQueue: [{ ...base.integrationQueue[0], state: "merging-now" }]
      })
    ]
  ])("rejects malformed %s", async (label, mutate) => {
    const suffix = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const workflowId = `workflow_bad_${suffix}`;
    const path = workflowRecordPath(workspace, workflowId);
    await mkdir(join(workspace, ".agent-team", "workflows"), { recursive: true });
    const base = workflowRecord(workflowId, "2026-05-13T10:00:00.000Z");
    await writeFile(
      path,
      JSON.stringify(mutate(base)),
      "utf8"
    );

    await expect(readWorkflowRecord(workspace, workflowId)).rejects.toMatchObject({
      name: "StateCorruptionError",
      path,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });

  it("reports a poisoned record while listing instead of leaking it", async () => {
    const good = workflowRecord("workflow_good", "2026-05-13T10:00:00.000Z");
    const poisonedPath = workflowRecordPath(workspace, "workflow_poisoned");

    await writeWorkflowRecord(workspace, good);
    await writeFile(
      poisonedPath,
      JSON.stringify({
        ...workflowRecord("workflow_poisoned", "2026-05-13T10:00:01.000Z"),
        slices: []
      }),
      "utf8"
    );

    await expect(listWorkflowRecords(workspace)).rejects.toMatchObject({
      name: "StateCorruptionError",
      path: poisonedPath,
      kind: "json"
    } satisfies Partial<StateCorruptionError>);
  });
});
