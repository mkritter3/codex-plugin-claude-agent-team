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
      integrationQueue: [],
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
          riskLevel: "low"
        })
      ],
      seniorReview: {
        opusPlanning: { mode: "required-when-available" },
        opusImplementation: { mode: "required-when-available" }
      }
    });
    expect(JSON.stringify(view)).not.toMatch(
      /internalPrompt|rawProviderPayload|rawMailboxPayload|providerSessionId|commandArgs|secret/
    );
  });
});
