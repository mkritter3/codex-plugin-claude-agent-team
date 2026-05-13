import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import {
  createWorkflow,
  getWorkflow,
  listWorkflows
} from "../../src/core/workflow-service.js";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "agent-team-workflow-service-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("workflow service", () => {
  it("creates a durable workflow with senior review policy, slice DAG, and sanitized view", async () => {
    const created = await createWorkflow({
      workspaceRoot: workspace,
      config: DEFAULT_AGENT_TEAM_CONFIG,
      now: () => new Date("2026-05-13T10:00:00.000Z"),
      createWorkflowId: () => "workflow_service",
      name: "Service Workflow",
      rationale: "Codex selected the initial slice order.",
      goal: {
        title: "Ship workflow service",
        successCriteria: ["workflow persists"],
        constraints: ["provider neutral"],
        nonGoals: ["live provider calls"]
      },
      slices: [
        {
          sliceId: "slice_core",
          title: "Core",
          ownerRole: "backend-engineer",
          writeScope: ["src/core/workflow-service.ts"],
          readScope: ["src/core"],
          acceptanceTests: ["workflow service test"],
          expectedEvidence: ["focused tests"],
          riskLevel: "medium",
          requiredReviewers: ["code-reviewer", "test-hardening-engineer"],
          blockedMode: "deferred-start"
        },
        {
          sliceId: "slice_mcp",
          title: "MCP",
          ownerRole: "planner",
          dependencies: ["slice_core"],
          writeScope: ["src/mcp/tools.ts"],
          readScope: ["src/mcp"],
          acceptanceTests: ["mcp tool tests"],
          expectedEvidence: ["package smoke"],
          riskLevel: "high",
          requiredReviewers: ["integration-engineer"],
          integrationOrderHint: 2,
          blockedMode: "prep-then-wait"
        }
      ]
    });

    expect(created.workflow).toMatchObject({
      workflowId: "workflow_service",
      name: "Service Workflow",
      planningStatus: "draft",
      seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
      slices: [
        expect.objectContaining({
          sliceId: "slice_core",
          state: "ready",
          ownerRole: "backend-engineer",
          riskLevel: "medium"
        }),
        expect.objectContaining({
          sliceId: "slice_mcp",
          state: "blocked",
          dependencies: ["slice_core"],
          blockedMode: "prep-then-wait"
        })
      ],
      codexRationale: [
        expect.objectContaining({
          category: "technical",
          summary: "Codex selected the initial slice order."
        })
      ],
      opusReviewEvidence: [],
      consensusRounds: [],
      userEscalations: [],
      integrationQueue: []
    });
    expect(JSON.stringify(created.workflow)).not.toMatch(/rawProvider|providerSession|prompt/i);

    await expect(getWorkflow({ workspaceRoot: workspace, workflowId: "workflow_service" }))
      .resolves.toEqual(created);
    await expect(listWorkflows(workspace)).resolves.toEqual({
      workflows: [created.workflow]
    });
  });

  it.each([
    ["unsafe workflow id", { workflowId: "../escape" }, /Invalid workflow id/],
    ["duplicate slice id", { duplicateSlice: true }, /Duplicate workflow slice id/],
    ["invalid owner role", { ownerRole: "chief-vibes-officer" }, /Invalid workflow slice owner role/],
    ["invalid state", { state: "running" }, /initial slice state must be planned, blocked, or ready/],
    ["missing dependency", { dependencies: ["missing"] }, /unknown dependency/],
    ["self dependency", { dependencies: ["slice_core"] }, /cannot depend on itself/],
    ["empty expected evidence", { expectedEvidence: [] }, /expectedEvidence must contain at least one item/],
    ["empty acceptance tests", { acceptanceTests: [] }, /acceptanceTests must contain at least one item/],
    ["invalid risk level", { riskLevel: "cosmic" }, /riskLevel must be low, medium, or high/],
    ["invalid blocked mode", { blockedMode: "hover" }, /blockedMode must be deferred-start or prep-then-wait/]
  ])("rejects %s before writing state", async (_label, overrideInput, message) => {
    const override = overrideInput as Record<string, unknown>;
    const baseSlice = {
      sliceId: "slice_core",
      title: "Core",
      ownerRole: "planner",
      writeScope: ["src/core/workflow-service.ts"],
      acceptanceTests: ["workflow service test"],
      expectedEvidence: ["focused tests"]
    };
    await expect(
      createWorkflow({
        workspaceRoot: workspace,
        config: DEFAULT_AGENT_TEAM_CONFIG,
        ...(typeof override.workflowId === "string"
          ? { workflowId: override.workflowId }
          : {}),
        createWorkflowId: () => "workflow_invalid",
        goal: {
          title: "Invalid workflow",
          successCriteria: ["reject invalid input"],
          constraints: ["no state write"],
          nonGoals: ["best effort repair"]
        },
        slices: [
          {
            ...baseSlice,
            ...override
          },
          ...(override.duplicateSlice === true ? [baseSlice] : [])
        ]
      })
    ).rejects.toThrow(message);

    await expect(listWorkflows(workspace)).resolves.toEqual({ workflows: [] });
  });

  it("allows empty write scope for read-only direct MCP workflow slices", async () => {
    const created = await createWorkflow({
      workspaceRoot: workspace,
      config: DEFAULT_AGENT_TEAM_CONFIG,
      createWorkflowId: () => "workflow_readonly",
      goal: {
        title: "Read-only workflow",
        successCriteria: ["review completes without source edits"],
        constraints: ["no source write scope"],
        nonGoals: ["implementation edits"]
      },
      slices: [
        {
          sliceId: "slice_readonly",
          title: "Read-only review",
          ownerRole: "planner",
          writeScope: [],
          acceptanceTests: ["agent_team_status_many"],
          expectedEvidence: ["status evidence"]
        }
      ]
    });

    expect(created.workflow.slices[0]).toMatchObject({
      sliceId: "slice_readonly",
      state: "ready",
      writeScope: []
    });
    await expect(listWorkflows(workspace)).resolves.toEqual({
      workflows: [created.workflow]
    });
  });
});
