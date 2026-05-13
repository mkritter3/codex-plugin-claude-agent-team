import { describe, expect, it } from "vitest";
import { toWorkflowView } from "../../src/core/workflow-view.js";
import type { WorkflowRecord } from "../../src/core/workflow-types.js";

describe("workflow view", () => {
  it("returns a sanitized public workflow view without raw provider or prompt internals", () => {
    const record = {
      workflowId: "workflow_view",
      name: "Workflow View",
      createdAt: "2026-05-13T10:00:00.000Z",
      updatedAt: "2026-05-13T10:00:00.000Z",
      planningStatus: "draft",
      goal: {
        title: "Ship workflow view",
        successCriteria: ["sanitized output"],
        constraints: ["no raw provider payloads"],
        nonGoals: ["no live calls"]
      },
      seniorReview: {
        opusPlanning: { mode: "required-when-available" },
        opusImplementation: { mode: "required-when-available" }
      },
      slices: [
        {
          sliceId: "slice_view",
          title: "View",
          state: "ready",
          ownerRole: "planner",
          dependencies: [],
          writeScope: ["src/core/workflow-view.ts"],
          readScope: ["src/core"],
          acceptanceTests: ["workflow view excludes internals"],
          expectedEvidence: ["focused test"],
          riskLevel: "low",
          requiredReviewers: ["code-reviewer"],
          integrationOrderHint: 1,
          blockedMode: "deferred-start",
          runIds: ["run_view"],
          runEvidence: [
            {
              runId: "run_view",
              startedAt: "2026-05-13T10:01:00.000Z",
              provider: "claude-code-cli",
              role: "planner",
              sidecarPath: "/repo/.agent-team/runs/run_view.json",
              logPath: "/repo/.agent-team/logs/run_view.log",
              mailboxPaths: {
                inbox: "/repo/.agent-team/mailboxes/run_view/inbox.jsonl",
                outbox: "/repo/.agent-team/mailboxes/run_view/outbox.jsonl",
                control: "/repo/.agent-team/mailboxes/run_view/control.jsonl",
                events: "/repo/.agent-team/mailboxes/run_view/events.jsonl"
              },
              providerSessionId: "hidden-session"
            }
          ],
          startFailureEvidence: [
            {
              failedAt: "2026-05-13T10:02:00.000Z",
              error: "provider policy rejected write mode"
            }
          ],
          unblockEvidence: [
            {
              dependencySliceId: "slice_dependency",
              recordedAt: "2026-05-13T10:03:00.000Z",
              summary: "Dependency evidence is ready.",
              changedFiles: ["src/core/workflow-view.ts"],
              evidencePaths: ["/repo/.agent-team/runs/run_dependency.json"],
              sourceRunId: "run_dependency",
              rawMailboxPayload: "hidden"
            }
          ],
          implementationEvidence: {
            recordedAt: "2026-05-13T10:04:00.000Z",
            summary: "Implementation evidence is ready.",
            changedFiles: ["src/core/workflow-review.ts"],
            testsRun: ["npm test -- tests/core/workflow-review.test.ts"],
            evidencePaths: ["/repo/.agent-team/runs/run_view.json"],
            sourceRunId: "run_view",
            worktreePath: "/repo/.worktrees/run_view",
            knownRisks: ["integration queue remains out of scope"],
            rawProviderPayload: "hidden"
          },
          reviewEvidence: [
            {
              reviewedAt: "2026-05-13T10:05:00.000Z",
              round: 1,
              consensus: "approved",
              summary: "Review passed.",
              reviewerRunIds: ["run_view"],
              internalPrompt: "hidden"
            }
          ],
          integrationEvidence: [
            {
              integratedAt: "2026-05-13T10:07:00.000Z",
              integrationMethod: "manual-patch",
              summary: "Codex recorded final integration evidence.",
              changedFiles: ["src/core/workflow-integration-evidence.ts"],
              verification: [
                {
                  command: "npm test -- tests/core/workflow-integration-evidence.test.ts",
                  status: "passed",
                  summary: "Focused tests passed.",
                  evidencePath: "/repo/.agent-team/evidence/focused.log",
                  rawProviderPayload: "hidden"
                }
              ],
              evidencePaths: ["/repo/.agent-team/evidence/integration.json"],
              retainedWorktreePath: "/repo/.worktrees/run_view",
              cleanupRecommendation: "eligible-after-evidence-saved",
              providerSessionId: "hidden"
            }
          ],
          internalPrompt: "do not expose"
        }
      ],
      consensusRounds: [],
      userEscalations: [],
      opusReviewEvidence: [
        {
          phase: "planning",
          status: "unavailable",
          requiredMode: "required-when-available",
          checkedAt: "2026-05-13T10:00:00.000Z",
          provider: "claude-code-cli:opus",
          summary: "Unavailable; degraded evidence recorded.",
          rawProviderPayload: { secret: true }
        }
      ],
      integrationQueue: [
        {
          queuePosition: 1,
          sliceId: "slice_view",
          state: "queued",
          worktreePath: "/repo/.worktrees/run_view",
          branchName: "codex/workflow_view/slice_view",
          reviewRunIds: ["run_view"],
          conflictRisk: "low",
          changedFiles: ["src/core/workflow-review.ts"],
          dependencySliceIds: [],
          focusedTests: ["npm test -- tests/core/workflow-review.test.ts"],
          queuedAt: "2026-05-13T10:06:00.000Z",
          integratedAt: "2026-05-13T10:07:00.000Z",
          finalGateStatus: "passed",
          integrationEvidencePaths: ["/repo/.agent-team/evidence/integration.json"],
          cleanupRecommendation: "eligible-after-evidence-saved",
          rawProviderPayload: "hidden"
        }
      ],
      codexRationale: [
        {
          rationaleId: "rationale_1",
          createdAt: "2026-05-13T10:00:00.000Z",
          category: "technical",
          summary: "Codex owns integration ordering.",
          relatedSliceIds: ["slice_view"]
        }
      ],
      evidencePath: "/repo/.agent-team/workflows/workflow_view.json",
      rawMailboxPayload: "do not expose",
      providerSessionId: "session-secret",
      commandArgs: ["--secret"]
    } as unknown as WorkflowRecord;

    const view = toWorkflowView(record);

    expect(view).toMatchObject({
      workflowId: "workflow_view",
      planningStatus: "draft",
      evidencePath: "/repo/.agent-team/workflows/workflow_view.json",
      slices: [
        expect.objectContaining({
          sliceId: "slice_view",
          expectedEvidence: ["focused test"],
          riskLevel: "low",
          runIds: ["run_view"],
          runEvidence: [
            expect.objectContaining({
              runId: "run_view",
              sidecarPath: "/repo/.agent-team/runs/run_view.json",
              mailboxPaths: {
                inbox: "/repo/.agent-team/mailboxes/run_view/inbox.jsonl",
                outbox: "/repo/.agent-team/mailboxes/run_view/outbox.jsonl",
                control: "/repo/.agent-team/mailboxes/run_view/control.jsonl",
                events: "/repo/.agent-team/mailboxes/run_view/events.jsonl"
              }
            })
          ],
          startFailureEvidence: [
            expect.objectContaining({
              error: "provider policy rejected write mode"
            })
          ],
          unblockEvidence: [
            expect.objectContaining({
              dependencySliceId: "slice_dependency",
              sourceRunId: "run_dependency"
            })
          ],
          implementationEvidence: expect.objectContaining({
            sourceRunId: "run_view",
            changedFiles: ["src/core/workflow-review.ts"]
          }),
          reviewEvidence: [
            expect.objectContaining({
              round: 1,
              consensus: "approved",
              reviewerRunIds: ["run_view"]
            })
          ],
          integrationEvidence: [
            expect.objectContaining({
              integrationMethod: "manual-patch",
              cleanupRecommendation: "eligible-after-evidence-saved",
              verification: [
                expect.objectContaining({
                  command: "npm test -- tests/core/workflow-integration-evidence.test.ts",
                  status: "passed"
                })
              ]
            })
          ]
        })
      ],
      seniorReview: {
        opusPlanning: { mode: "required-when-available" },
        opusImplementation: { mode: "required-when-available" }
      },
      integrationQueue: [
        expect.objectContaining({
          queuePosition: 1,
          sliceId: "slice_view",
          state: "queued",
          finalGateStatus: "passed",
          cleanupRecommendation: "eligible-after-evidence-saved",
          conflictRisk: "low",
          changedFiles: ["src/core/workflow-review.ts"]
        })
      ]
    });
    expect(JSON.stringify(view)).not.toMatch(
      /internalPrompt|rawProviderPayload|rawMailboxPayload|providerSessionId|commandArgs|hidden-session|secret/
    );
  });
});
