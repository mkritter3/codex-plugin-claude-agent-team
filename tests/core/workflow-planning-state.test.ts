import { describe, expect, it } from "vitest";
import {
  appendCodexRationale,
  classifyUserEscalation,
  deriveInitialSliceState
} from "../../src/core/workflow-planning-state.js";
import type { WorkflowRecord } from "../../src/core/workflow-types.js";

function record(): WorkflowRecord {
  return {
    workflowId: "workflow_plan",
    createdAt: "2026-05-13T10:00:00.000Z",
    updatedAt: "2026-05-13T10:00:00.000Z",
    planningStatus: "draft",
    goal: {
      title: "Ship workflow creation",
      successCriteria: ["durable state"],
      constraints: ["provider neutral"],
      nonGoals: ["live providers"]
    },
    seniorReview: {
      opusPlanning: { mode: "required-when-available" },
      opusImplementation: { mode: "required-when-available" }
    },
    slices: [
      {
        sliceId: "slice_a",
        title: "A",
        state: "ready",
        ownerRole: "planner",
        dependencies: [],
        writeScope: ["src/a.ts"],
        readScope: ["src"],
        acceptanceTests: ["test a"],
        expectedEvidence: ["focused test"],
        riskLevel: "medium",
        requiredReviewers: ["code-reviewer"],
        blockedMode: "deferred-start"
      }
    ],
    consensusRounds: [],
    userEscalations: [],
    opusReviewEvidence: [],
    integrationQueue: [],
    codexRationale: [],
    evidencePath: "/repo/.agent-team/workflows/workflow_plan.json"
  };
}

describe("workflow planning state", () => {
  it("derives ready or blocked initial slice state from dependencies", () => {
    expect(deriveInitialSliceState({ dependencies: [] })).toBe("ready");
    expect(deriveInitialSliceState({ dependencies: ["slice_a"] })).toBe("blocked");
    expect(deriveInitialSliceState({ dependencies: [], requestedState: "planned" })).toBe(
      "planned"
    );
  });

  it("rejects requested running or terminal initial states", () => {
    expect(() =>
      deriveInitialSliceState({ dependencies: [], requestedState: "running" })
    ).toThrow("initial slice state must be planned, blocked, or ready");
  });

  it("records Codex-owned rationale without mutating the source record", () => {
    const original = record();
    const next = appendCodexRationale(original, {
      rationaleId: "rationale_1",
      createdAt: "2026-05-13T10:01:00.000Z",
      summary: "Technical slice order is Codex-owned.",
      category: "technical",
      relatedSliceIds: ["slice_a"]
    });

    expect(original.codexRationale).toEqual([]);
    expect(next.codexRationale).toEqual([
      {
        rationaleId: "rationale_1",
        createdAt: "2026-05-13T10:01:00.000Z",
        summary: "Technical slice order is Codex-owned.",
        category: "technical",
        relatedSliceIds: ["slice_a"]
      }
    ]);
    expect(next.updatedAt).toBe("2026-05-13T10:01:00.000Z");
  });

  it("classifies only product-impact categories as user escalation candidates", () => {
    expect(classifyUserEscalation("release-posture")).toEqual({
      shouldEscalateToUser: true,
      category: "release-posture"
    });
    expect(classifyUserEscalation("technical")).toEqual({
      shouldEscalateToUser: false,
      category: "technical"
    });
  });
});
