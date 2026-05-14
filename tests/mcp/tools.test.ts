import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { StateCorruptionError } from "../../src/core/errors.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../src/core/config.js";
import {
  appendMailboxRecord,
  readMailboxRecords
} from "../../src/core/state/mailbox-store.js";
import {
  mailboxPath,
  runSidecarPath,
  teamRecordPath
} from "../../src/core/state/paths.js";
import { writeRunSidecar } from "../../src/core/state/run-store.js";
import { readTeamRecord, writeTeamRecord } from "../../src/core/state/team-store.js";
import { TOOL_METADATA_BY_NAME } from "../../src/mcp/schemas.js";
import { createToolHandlers, handleToolCall, listToolNames } from "../../src/mcp/tools.js";

describe("MCP tool handlers", () => {
  it("lists roles with capability requirements", async () => {
    const result = await handleToolCall("agent_team_list_roles", {});

    expect(result.structuredContent?.roles?.[0]?.id).toBe("architect");
    expect(result.structuredContent?.roles).toHaveLength(17);
  });

  it("lists configured providers", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      config: DEFAULT_AGENT_TEAM_CONFIG
    });

    const result = await handlers.handleToolCall("agent_team_list_providers", {});

    expect(result.structuredContent?.providers?.[0]?.id).toBe("claude-code-cli");
    expect(result.structuredContent?.providers?.[0]?.capabilities).not.toContain("edits");
  });

  it("lists write capabilities when isolated write mode is configured", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      config: {
        schemaVersion: DEFAULT_AGENT_TEAM_CONFIG.schemaVersion,
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        routing: { rolePins: {}, providerOrder: [] },
        providers: DEFAULT_AGENT_TEAM_CONFIG.providers,
        seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
        policy: DEFAULT_AGENT_TEAM_CONFIG.policy
      }
    });

    const result = await handlers.handleToolCall("agent_team_list_providers", {});

    expect(result.structuredContent?.providers?.[0]?.capabilities).toContain("edits");
    expect(result.structuredContent?.providers?.[0]?.capabilities).toContain(
      "workspaceIsolation"
    );
  });

  it("lists configured Claude Code CLI model profiles without exposing provider internals", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      config: {
        ...DEFAULT_AGENT_TEAM_CONFIG,
        providers: {
          ...DEFAULT_AGENT_TEAM_CONFIG.providers,
          claudeCodeCli: {
            profiles: [
              {
                id: "opus",
                model: "opus",
                displayName: "Claude Opus",
                writeValidated: false,
                capabilities: {
                  structuredOutput: true,
                  longContext: true,
                  tools: true,
                  sessionResume: true,
                  cancellation: true,
                  reasoning: true,
                  edits: false,
                  workspaceIsolation: false
                }
              }
            ]
          }
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_list_providers", {});

    expect(result.structuredContent?.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude-code-cli:opus",
          displayName: "Claude Opus",
          authMode: "subscription-oauth",
          model: "opus",
          capabilities: expect.arrayContaining([
            "structuredOutput",
            "longContext",
            "tools",
            "sessionResume",
            "cancellation",
            "reasoning"
          ])
        })
      ])
    );
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /prompt|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|apiKeyEnv/i
    );
  });

  it("lists providers from an explicit cwd when supplied", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-providers-cwd-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        writeMode: { enabled: true, requireIsolatedWorktree: true }
      }),
      "utf8"
    );
    const handlers = createToolHandlers({
      cwd: () => "/repo"
    });

    const result = await handlers.handleToolCall("agent_team_list_providers", {
      cwd: workspace
    });

    expect(result.structuredContent?.providers?.[0]?.capabilities).toContain("edits");
  });

  it("describes provider inputs as neutral selector strings without provider-specific fields", () => {
    expect(TOOL_METADATA_BY_NAME.agent_team_dispatch.inputSchema.provider?.description).toBe(
      "Preferred provider selector."
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_start.inputSchema.provider?.description).toBe(
      "Preferred provider selector."
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_start_parallel.inputSchema).not.toHaveProperty(
      "providerPolicy"
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_dispatch.inputSchema).not.toHaveProperty("grok");
    expect(TOOL_METADATA_BY_NAME.agent_team_dispatch.inputSchema).not.toHaveProperty("gemini");
    expect(TOOL_METADATA_BY_NAME.agent_team_dispatch.inputSchema).not.toHaveProperty(
      "ollamaCloud"
    );
  });

  it("exposes provider-neutral durable team record tools", () => {
    expect(listToolNames()).toEqual(
      expect.arrayContaining([
        "agent_team_create_team",
        "agent_team_get_team",
        "agent_team_list_teams",
        "agent_team_dashboard"
      ])
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_create_team).toMatchObject({
      title: "Create Agent Team Record",
      description: expect.stringMatching(/durable team record/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_create_team.inputSchema).toMatchObject({
      runs: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_get_team.inputSchema).toMatchObject({
      teamId: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_list_teams.inputSchema).toMatchObject({
      cwd: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_dashboard).toMatchObject({
      title: "Agent Team Dashboard",
      description: expect.stringMatching(/read-only/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_dashboard.inputSchema).toMatchObject({
      teamId: expect.any(Object),
      runs: expect.any(Object)
    });
    expect(
      TOOL_METADATA_BY_NAME.agent_team_dashboard.inputSchema.teamId.description
    ).toContain("Exactly one");
    expect(
      TOOL_METADATA_BY_NAME.agent_team_dashboard.inputSchema.runs.description
    ).toContain("Exactly one");
    expect(TOOL_METADATA_BY_NAME.agent_team_create_team.inputSchema).not.toHaveProperty(
      "provider"
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_create_team.inputSchema).not.toHaveProperty(
      "prompt"
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_dashboard.inputSchema).not.toHaveProperty(
      "provider"
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_dashboard.inputSchema).not.toHaveProperty(
      "prompt"
    );
  });

  it("exposes provider-neutral workflow creation tools with sanitized schemas", () => {
    expect(listToolNames()).toEqual(
      expect.arrayContaining([
        "agent_team_create_workflow",
        "agent_team_get_workflow",
        "agent_team_list_workflows"
      ])
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_create_workflow).toMatchObject({
      title: "Create Agent Workflow",
      description: expect.stringMatching(/durable workflow/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_create_workflow.inputSchema).toMatchObject({
      goal: expect.any(Object),
      slices: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_get_workflow.inputSchema).toMatchObject({
      workflowId: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_list_workflows.inputSchema).toMatchObject({
      cwd: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_create_workflow.inputSchema).not.toHaveProperty(
      "prompt"
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_create_workflow.inputSchema).not.toHaveProperty(
      "provider"
    );
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_create_workflow)).not.toMatch(
      /Claude|claude-code-cli|internal prompt|raw provider/i
    );
  });

  it("public create workflow MCP schema accepts read-only slices with empty write scope", () => {
    const schema = z.object(
      TOOL_METADATA_BY_NAME.agent_team_create_workflow.inputSchema as z.ZodRawShape
    );

    const result = schema.safeParse({
      workflowId: "workflow_schema_readonly",
      goal: {
        title: "Read-only schema proof",
        successCriteria: ["direct MCP schema accepts read-only slices"],
        constraints: ["no source edits"],
        nonGoals: ["provider calls"]
      },
      slices: [
        {
          sliceId: "slice_readonly",
          title: "Read-only workflow slice",
          ownerRole: "planner",
          state: "ready",
          dependencies: [],
          writeScope: [],
          acceptanceTests: ["agent_team_workflow_report"],
          expectedEvidence: ["workflow evidence"]
        }
      ]
    });

    expect(result.success).toBe(true);
  });

  it("exposes provider-neutral workflow planning consensus tool with sanitized schema", () => {
    expect(listToolNames()).toEqual(
      expect.arrayContaining(["agent_team_plan_consensus"])
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_plan_consensus).toMatchObject({
      title: "Plan Agent Workflow Consensus",
      description: expect.stringMatching(/planning consensus/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_plan_consensus.inputSchema).toMatchObject({
      workflowId: expect.any(Object),
      codexDecision: expect.any(Object),
      verdicts: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_plan_consensus.inputSchema).not.toHaveProperty(
      "prompt"
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_plan_consensus.inputSchema).not.toHaveProperty(
      "claude"
    );
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_plan_consensus)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload/i
    );
  });

  it("exposes provider-neutral workflow slice orchestration tools with sanitized schemas", () => {
    expect(listToolNames()).toEqual(
      expect.arrayContaining([
        "agent_team_start_slices",
        "agent_team_unblock_slice",
        "agent_team_review_slice",
        "agent_team_integration_queue",
        "agent_team_record_integration",
        "agent_team_workflow_report"
      ])
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_start_slices).toMatchObject({
      title: "Start Workflow Slices",
      description: expect.stringMatching(/workflow slices/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_start_slices.inputSchema).toMatchObject({
      workflowId: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_unblock_slice).toMatchObject({
      title: "Unblock Workflow Slice",
      description: expect.stringMatching(/dependency/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_unblock_slice.inputSchema).toMatchObject({
      workflowId: expect.any(Object),
      sliceId: expect.any(Object),
      dependencyEvidence: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_review_slice).toMatchObject({
      title: "Review Workflow Slice",
      description: expect.stringMatching(/review consensus/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_review_slice.inputSchema).toMatchObject({
      workflowId: expect.any(Object),
      sliceId: expect.any(Object),
      codexDecision: expect.any(Object),
      verdicts: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_integration_queue).toMatchObject({
      title: "Build Workflow Integration Queue",
      description: expect.stringMatching(/integration order/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_integration_queue.inputSchema).toMatchObject({
      workflowId: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_record_integration).toMatchObject({
      title: "Record Workflow Integration Evidence",
      description: expect.stringMatching(/verification results/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_record_integration.inputSchema).toMatchObject({
      workflowId: expect.any(Object),
      sliceId: expect.any(Object),
      integrationMethod: expect.any(Object),
      summary: expect.any(Object),
      changedFiles: expect.any(Object),
      verification: expect.any(Object)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_workflow_report).toMatchObject({
      title: "Build Workflow Completion Report",
      description: expect.stringMatching(/completion report/i)
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_workflow_report.inputSchema).toMatchObject({
      workflowId: expect.any(Object)
    });
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_start_slices)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload/i
    );
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_unblock_slice)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload/i
    );
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_review_slice)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload/i
    );
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_integration_queue)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload|merge|cherry-pick/i
    );
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_record_integration)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload|commandArgs/i
    );
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_workflow_report)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload|commandArgs/i
    );
  });

  it("creates, reads, and lists sanitized workflow views through MCP", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-workflow-"));
    const handlers = createToolHandlers({
      cwd: () => workspace,
      createWorkflowId: () => "workflow_mcp",
      now: () => new Date("2026-05-13T10:00:00.000Z")
    });

    const created = await handlers.handleToolCall("agent_team_create_workflow", {
      name: "MCP Workflow",
      goal: {
        title: "Ship MCP workflow",
        successCriteria: ["create workflow tool works"],
        constraints: ["provider neutral"],
        nonGoals: ["live providers"]
      },
      rationale: "Codex records initial technical rationale.",
      slices: [
        {
          sliceId: "slice_mcp",
          title: "MCP tool",
          ownerRole: "planner",
          writeScope: ["src/mcp/tools.ts"],
          acceptanceTests: ["mcp workflow test"],
          expectedEvidence: ["focused test"],
          riskLevel: "medium"
        }
      ]
    });

    expect(created.structuredContent?.workflow).toMatchObject({
      workflowId: "workflow_mcp",
      planningStatus: "draft",
      slices: [expect.objectContaining({ sliceId: "slice_mcp", state: "ready" })],
      codexRationale: [
        expect.objectContaining({
          summary: "Codex records initial technical rationale."
        })
      ]
    });
    expect(JSON.stringify(created.structuredContent)).not.toMatch(
      /internalPrompt|rawProvider|providerSession|commandArgs|secret/i
    );

    await expect(
      handlers.handleToolCall("agent_team_get_workflow", {
        workflowId: "workflow_mcp"
      })
    ).resolves.toMatchObject({
      structuredContent: {
        workflow: created.structuredContent?.workflow
      }
    });
    await expect(
      handlers.handleToolCall("agent_team_list_workflows", {})
    ).resolves.toMatchObject({
      structuredContent: {
        workflows: [created.structuredContent?.workflow]
      }
    });
  });

  it("exposes provider-neutral guided workflow tools with sanitized schemas", () => {
    expect(listToolNames()).toEqual(
      expect.arrayContaining(["agent_team_workflow_next", "agent_team_record_user_decision"])
    );
    expect(TOOL_METADATA_BY_NAME.agent_team_workflow_next).toMatchObject({
      title: "Get Workflow Next Actions"
    });
    expect(TOOL_METADATA_BY_NAME.agent_team_record_user_decision).toMatchObject({
      title: "Record Workflow User Decision"
    });
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_workflow_next)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload|commandArgs|apiKey/i
    );
    expect(JSON.stringify(TOOL_METADATA_BY_NAME.agent_team_record_user_decision)).not.toMatch(
      /claude-code-cli|internal prompt|raw provider|providerPayload|commandArgs|apiKey/i
    );
  });

  it("returns sanitized guided workflow next actions through MCP", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-workflow-next-"));
    const handlers = createToolHandlers({
      cwd: () => workspace,
      createWorkflowId: () => "workflow_next",
      now: () => new Date("2026-05-13T10:00:00.000Z")
    });

    await handlers.handleToolCall("agent_team_create_workflow", {
      goal: {
        title: "Ship guided next action",
        successCriteria: ["next action is visible"],
        constraints: ["no hidden provider call"],
        nonGoals: ["raw provider payloads"]
      },
      slices: [
        {
          sliceId: "slice_next",
          title: "Next action slice",
          ownerRole: "planner",
          writeScope: ["docs/plan.md"],
          acceptanceTests: ["npm test -- tests/mcp/tools.test.ts"],
          expectedEvidence: ["focused tests"]
        }
      ]
    });

    const next = await handlers.handleToolCall("agent_team_workflow_next", {
      workflowId: "workflow_next",
      includeSteering: true,
      includeRolePolicy: true
    });

    expect(next.structuredContent).toMatchObject({
      workflowId: "workflow_next",
      guidance: {
        workflowId: "workflow_next",
        phase: "executing"
      },
      hookPlan: {
        workflowId: "workflow_next",
        mutatesSource: false,
        startsProvider: false
      }
    });
    expect(JSON.stringify(next.structuredContent)).not.toMatch(
      /systemPrompt|rawProvider|providerPayload|apiKey|commandArgs|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_API_KEY/i
    );
  });

  it("records product-level workflow user decisions and rejects technical categories", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-user-decision-"));
    const handlers = createToolHandlers({
      cwd: () => workspace,
      createWorkflowId: () => "workflow_decision",
      now: () => new Date("2026-05-13T10:00:00.000Z")
    });

    await handlers.handleToolCall("agent_team_create_workflow", {
      goal: {
        title: "Approve guided plan",
        successCriteria: ["user decision is recorded"],
        constraints: ["only product-level asks"],
        nonGoals: ["technical approval burden"]
      },
      slices: [
        {
          sliceId: "slice_decision",
          title: "Decision slice",
          ownerRole: "planner",
          writeScope: ["docs/plan.md"],
          acceptanceTests: ["npm test -- tests/mcp/tools.test.ts"],
          expectedEvidence: ["focused tests"]
        }
      ]
    });

    const recorded = await handlers.handleToolCall("agent_team_record_user_decision", {
      workflowId: "workflow_decision",
      decisionId: "decision_approval",
      category: "product",
      decision: "approve",
      summary: "Proceed with the approved user-facing workflow.",
      practicalEffect: "Users get the new workflow after release.",
      selectedOption: "Proceed"
    });

    expect(recorded.structuredContent).toMatchObject({
      workflowId: "workflow_decision",
      recorded: true,
      decisionRef: "decision_approval"
    });

    const next = await handlers.handleToolCall("agent_team_workflow_next", {
      workflowId: "workflow_decision"
    });

    expect(next.structuredContent?.guidance).toMatchObject({
      workflowId: "workflow_decision",
      phase: "executing"
    });

    const rejected = await handlers.handleToolCall("agent_team_record_user_decision", {
      workflowId: "workflow_decision",
      category: "technical",
      decision: "approve",
      summary: "Use a specific internal module split.",
      practicalEffect: "No direct user effect."
    });

    expect(rejected.structuredContent).toMatchObject({
      status: "validation_error"
    });
  });

  it("rejects invalid workflow create input before invoking injected workflow creation", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      createWorkflow: async () => {
        called = true;
        throw new Error("should not create workflow");
      }
    });

    const result = await handlers.handleToolCall("agent_team_create_workflow", {
      goal: {
        title: "Missing slices",
        successCriteria: ["reject invalid"],
        constraints: ["no side effects"],
        nonGoals: ["partial write"]
      },
      slices: []
    });

    expect(result.structuredContent).toMatchObject({
      status: "validation_error"
    });
    expect(called).toBe(false);
  });

  it("accepts empty dependencies and writeScope for read-only workflow slices", async () => {
    let createInput:
      | {
          slices: readonly {
            dependencies?: readonly string[];
            writeScope: readonly string[];
          }[];
        }
      | undefined;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      createWorkflow: async (input) => {
        createInput = input;
        return {
          workflow: {
            workflowId: "workflow_readonly",
            createdAt: "2026-05-13T10:00:00.000Z",
            updatedAt: "2026-05-13T10:00:00.000Z",
            planningStatus: "draft",
            goal: input.goal,
            seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
            slices: [
              {
                sliceId: "slice_readonly",
                title: "Read-only review",
                state: "ready",
                ownerRole: "planner",
                dependencies: [],
                writeScope: [],
                acceptanceTests: ["agent_team_status_many"]
              }
            ],
            consensusRounds: [],
            userEscalations: [],
            opusReviewEvidence: [],
            integrationQueue: [],
            codexRationale: [],
            evidencePath: "/repo/.agent-team/workflows/workflow_readonly.json"
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_create_workflow", {
      workflowId: "workflow_readonly",
      goal: {
        title: "Read-only proof",
        successCriteria: ["workflow created"],
        constraints: ["no source edits"],
        nonGoals: ["feature work"]
      },
      slices: [
        {
          sliceId: "slice_readonly",
          title: "Read-only review",
          ownerRole: "planner",
          state: "ready",
          dependencies: [],
          writeScope: [],
          acceptanceTests: ["agent_team_status_many"],
          expectedEvidence: ["run status evidence"]
        }
      ]
    });

    expect(result.structuredContent?.workflow.workflowId).toBe("workflow_readonly");
    expect(createInput?.slices[0]?.dependencies).toEqual([]);
    expect(createInput?.slices[0]?.writeScope).toEqual([]);
  });

  it("records planning consensus through MCP using the injected workflow service", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      planConsensus: async (input) => ({
        workflow: {
          workflowId: input.workflowId,
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T10:01:00.000Z",
          planningStatus: "approved",
          goal: {
            title: "Plan",
            successCriteria: ["approved"],
            constraints: ["provider neutral"],
            nonGoals: ["live claims"]
          },
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [],
          consensusRounds: [
            {
              round: 1,
              phase: "planning",
              consensus: "approved",
              verdicts: [
                {
                  reviewerRole: "architect",
                  status: "approve",
                  summary: "Looks good."
                }
              ],
              startedAt: "2026-05-13T10:01:00.000Z",
              completedAt: "2026-05-13T10:01:00.000Z"
            }
          ],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_plan_consensus", {
      workflowId: "workflow_mcp",
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Codex approves this bounded plan."
      },
      verdicts: [
        {
          reviewerRole: "architect",
          status: "approve",
          summary: "Architecture is bounded."
        }
      ]
    });

    expect(result.structuredContent?.workflow).toMatchObject({
      workflowId: "workflow_mcp",
      planningStatus: "approved",
      consensusRounds: [expect.objectContaining({ consensus: "approved" })]
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /internalPrompt|rawProvider|providerSession|commandArgs|secret/i
    );
  });

  it("accepts explicit empty optional arrays for direct workflow calls", async () => {
    let consensusCalled = false;
    let reviewCalled = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      planConsensus: async (input) => {
        consensusCalled = true;
        expect(input.userEscalations).toEqual([]);
        return {
          workflow: {
            workflowId: input.workflowId,
            createdAt: "2026-05-13T10:00:00.000Z",
            updatedAt: "2026-05-13T10:01:00.000Z",
            planningStatus: "approved",
            goal: {
              title: "Plan",
              successCriteria: ["approved"],
              constraints: ["provider neutral"],
              nonGoals: ["live claims"]
            },
            seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
            slices: [],
            consensusRounds: [],
            userEscalations: [],
            opusReviewEvidence: [],
            integrationQueue: [],
            codexRationale: [],
            evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
          }
        };
      },
      reviewWorkflowSlice: async (input) => {
        reviewCalled = true;
        expect(input.userEscalations).toEqual([]);
        expect(input.implementationEvidence?.changedFiles).toEqual([]);
        return {
          workflow: {
            workflowId: input.workflowId,
            createdAt: "2026-05-13T10:00:00.000Z",
            updatedAt: "2026-05-13T10:02:00.000Z",
            planningStatus: "approved",
            goal: {
              title: "Review",
              successCriteria: ["reviewed"],
              constraints: ["provider neutral"],
              nonGoals: ["live claims"]
            },
            seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
            slices: [],
            consensusRounds: [],
            userEscalations: [],
            opusReviewEvidence: [],
            integrationQueue: [],
            codexRationale: [],
            evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
          }
        };
      }
    });

    const consensus = await handlers.handleToolCall("agent_team_plan_consensus", {
      workflowId: "workflow_mcp",
      userEscalations: [],
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "No user escalation is needed."
      },
      verdicts: [
        {
          reviewerRole: "planner",
          status: "approve",
          summary: "Proceed."
        }
      ]
    });

    const review = await handlers.handleToolCall("agent_team_review_slice", {
      workflowId: "workflow_mcp",
      sliceId: "slice_readonly",
      userEscalations: [],
      implementationEvidence: {
        summary: "Read-only proof.",
        changedFiles: [],
        testsRun: ["agent_team_status_many"],
        evidencePaths: ["/repo/.agent-team/runs/run_readonly.json"]
      },
      codexDecision: {
        status: "revise",
        category: "technical",
        summary: "Needs docs hardening."
      },
      verdicts: [
        {
          reviewerRole: "planner",
          status: "revise",
          summary: "Revise docs."
        }
      ]
    });

    expect(consensus.structuredContent?.workflow.workflowId).toBe("workflow_mcp");
    expect(review.structuredContent?.workflow.workflowId).toBe("workflow_mcp");
    expect(consensusCalled).toBe(true);
    expect(reviewCalled).toBe(true);
  });

  it("rejects invalid consensus input before invoking injected service", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      planConsensus: async () => {
        called = true;
        throw new Error("should not record consensus");
      }
    });

    const result = await handlers.handleToolCall("agent_team_plan_consensus", {
      workflowId: "workflow_mcp",
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Missing verdicts should fail."
      },
      verdicts: []
    });

    expect(result.structuredContent).toMatchObject({ status: "validation_error" });
    expect(called).toBe(false);
  });

  it("starts workflow slices through MCP using the injected workflow service", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      startWorkflowSlices: async (input) => ({
        status: "started",
        batchId: `${input.workflowId}_slices`,
        concurrency: input.concurrency,
        slices: [
          {
            status: "started",
            index: 0,
            sliceId: "slice_core",
            run: {
              runId: "run_slice_core",
              status: "running",
              provider: "claude-code-cli",
              role: "slice-implementer",
              sidecarPath: "/repo/.agent-team/runs/run_slice_core.json",
              logPath: "/repo/.agent-team/logs/run_slice_core.log",
              mailboxPaths: {
                inbox: "/repo/.agent-team/mailboxes/run_slice_core/inbox.jsonl",
                outbox: "/repo/.agent-team/mailboxes/run_slice_core/outbox.jsonl",
                control: "/repo/.agent-team/mailboxes/run_slice_core/control.jsonl",
                events: "/repo/.agent-team/mailboxes/run_slice_core/events.jsonl"
              }
            }
          }
        ],
        workflow: {
          workflowId: input.workflowId,
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T11:00:00.000Z",
          planningStatus: "approved",
          goal: {
            title: "Workflow",
            successCriteria: ["slice started"],
            constraints: ["provider neutral"],
            nonGoals: ["auto merge"]
          },
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [
            {
              sliceId: "slice_core",
              title: "Core",
              state: "running",
              ownerRole: "slice-implementer",
              dependencies: [],
              writeScope: ["src/core"],
              acceptanceTests: ["focused tests"],
              runIds: ["run_slice_core"]
            }
          ],
          consensusRounds: [],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_start_slices", {
      workflowId: "workflow_mcp",
      sliceIds: ["slice_core"],
      concurrency: 1
    });

    expect(result.structuredContent).toMatchObject({
      status: "started",
      workflow: {
        workflowId: "workflow_mcp",
        slices: [expect.objectContaining({ sliceId: "slice_core", state: "running" })]
      }
    });
  });

  it("unblocks workflow slices through MCP using the injected workflow service", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      unblockWorkflowSlice: async (input) => ({
        status: "ready",
        sliceId: input.sliceId,
        notifications: [],
        workflow: {
          workflowId: input.workflowId,
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T11:00:00.000Z",
          planningStatus: "approved",
          goal: {
            title: "Workflow",
            successCriteria: ["slice unblocked"],
            constraints: ["provider neutral"],
            nonGoals: ["auto merge"]
          },
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [
            {
              sliceId: input.sliceId,
              title: "Blocked",
              state: "ready",
              ownerRole: "slice-implementer",
              dependencies: ["slice_core"],
              writeScope: ["src/core"],
              acceptanceTests: ["focused tests"],
              unblockEvidence: [
                {
                  dependencySliceId: "slice_core",
                  recordedAt: "2026-05-13T11:00:00.000Z",
                  summary: "Core is ready."
                }
              ]
            }
          ],
          consensusRounds: [],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_unblock_slice", {
      workflowId: "workflow_mcp",
      sliceId: "slice_blocked",
      dependencyEvidence: [
        {
          dependencySliceId: "slice_core",
          summary: "Core is ready."
        }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "ready",
      sliceId: "slice_blocked",
      workflow: {
        slices: [expect.objectContaining({ sliceId: "slice_blocked", state: "ready" })]
      }
    });
  });

  it("reviews workflow slices through MCP using the injected workflow service", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      reviewWorkflowSlice: async (input) => ({
        workflow: {
          workflowId: input.workflowId,
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T12:00:00.000Z",
          planningStatus: "approved",
          goal: {
            title: "Workflow",
            successCriteria: ["slice reviewed"],
            constraints: ["provider neutral"],
            nonGoals: ["auto merge"]
          },
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [
            {
              sliceId: input.sliceId,
              title: "Core",
              state: "approved",
              ownerRole: "slice-implementer",
              dependencies: [],
              writeScope: ["src/core"],
              acceptanceTests: ["focused tests"],
              implementationEvidence: {
                recordedAt: "2026-05-13T12:00:00.000Z",
                summary: input.implementationEvidence?.summary ?? "Implementation evidence.",
                changedFiles: input.implementationEvidence?.changedFiles ?? ["src/core"],
                testsRun: input.implementationEvidence?.testsRun ?? ["npm test"],
                evidencePaths: input.implementationEvidence?.evidencePaths ?? ["/repo/.agent-team/runs/run_impl.json"],
                ...(input.implementationEvidence?.sourceRunId === undefined
                  ? {}
                  : { sourceRunId: input.implementationEvidence.sourceRunId })
              },
              reviewEvidence: [
                {
                  reviewedAt: "2026-05-13T12:00:00.000Z",
                  round: 1,
                  consensus: "approved",
                  summary: input.codexDecision.summary
                }
              ]
            }
          ],
          consensusRounds: [
            {
              round: 1,
              phase: "review",
              consensus: "approved",
              verdicts: [
                {
                  reviewerRole: "code-reviewer",
                  status: "approve",
                  summary: "Looks good."
                }
              ],
              startedAt: "2026-05-13T12:00:00.000Z",
              completedAt: "2026-05-13T12:00:00.000Z"
            }
          ],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_review_slice", {
      workflowId: "workflow_mcp",
      sliceId: "slice_core",
      implementationEvidence: {
        summary: "Implemented in isolated worktree.",
        changedFiles: ["src/core/workflow-review.ts"],
        testsRun: ["npm test -- tests/core/workflow-review.test.ts"],
        evidencePaths: ["/repo/.agent-team/runs/run_impl.json"],
        sourceRunId: "run_impl"
      },
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Codex approves this slice."
      },
      verdicts: [
        {
          reviewerRole: "code-reviewer",
          status: "approve",
          summary: "The slice is safe to approve."
        }
      ]
    });

    expect(result.structuredContent?.workflow).toMatchObject({
      workflowId: "workflow_mcp",
      slices: [
        expect.objectContaining({
          sliceId: "slice_core",
          state: "approved",
          implementationEvidence: expect.objectContaining({
            sourceRunId: "run_impl"
          })
        })
      ],
      consensusRounds: [expect.objectContaining({ phase: "review", consensus: "approved" })]
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /internalPrompt|rawProvider|providerSession|commandArgs|secret/i
    );
  });

  it("builds workflow integration queues through MCP using the injected workflow service", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      buildWorkflowIntegrationQueue: async (input) => ({
        queue: [
          {
            queuePosition: 1,
            sliceId: input.sliceIds?.[0] ?? "slice_core",
            state: "queued",
            worktreePath: "/repo/.worktrees/slice_core",
            branchName: "codex/workflow_mcp/slice_core",
            reviewRunIds: ["run_review_slice_core"],
            conflictRisk: "low",
            changedFiles: ["src/core/workflow-integration-queue.ts"],
            dependencySliceIds: [],
            focusedTests: ["npm test -- tests/core/workflow-integration-queue.test.ts"],
            queuedAt: "2026-05-13T13:00:00.000Z"
          }
        ],
        excluded: [],
        workflow: {
          workflowId: input.workflowId,
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T13:00:00.000Z",
          planningStatus: "approved",
          goal: {
            title: "Workflow",
            successCriteria: ["queue built"],
            constraints: ["provider neutral"],
            nonGoals: ["auto merge"]
          },
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [],
          consensusRounds: [],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [
            {
              queuePosition: 1,
              sliceId: input.sliceIds?.[0] ?? "slice_core",
              state: "queued",
              worktreePath: "/repo/.worktrees/slice_core",
              branchName: "codex/workflow_mcp/slice_core",
              reviewRunIds: ["run_review_slice_core"],
              conflictRisk: "low",
              changedFiles: ["src/core/workflow-integration-queue.ts"],
              dependencySliceIds: [],
              focusedTests: ["npm test -- tests/core/workflow-integration-queue.test.ts"],
              queuedAt: "2026-05-13T13:00:00.000Z"
            }
          ],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_integration_queue", {
      workflowId: "workflow_mcp",
      sliceIds: ["slice_core"]
    });

    expect(result.structuredContent).toMatchObject({
      queue: [expect.objectContaining({ sliceId: "slice_core", conflictRisk: "low" })],
      excluded: [],
      workflow: {
        workflowId: "workflow_mcp",
        integrationQueue: [expect.objectContaining({ sliceId: "slice_core" })]
      }
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /internalPrompt|rawProvider|providerSession|commandArgs|secret/i
    );
  });

  it("records workflow integration evidence through MCP using the injected workflow service", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      recordWorkflowIntegration: async (input) => ({
        queueItem: {
          queuePosition: 1,
          sliceId: input.sliceId,
          state: "integrated",
          worktreePath: "/repo/.worktrees/slice_core",
          branchName: "codex/workflow_mcp/slice_core",
          reviewRunIds: ["run_review_slice_core"],
          conflictRisk: "low",
          changedFiles: input.changedFiles,
          dependencySliceIds: [],
          focusedTests: ["npm test -- tests/core/workflow-integration-evidence.test.ts"],
          queuedAt: "2026-05-13T13:00:00.000Z",
          integratedAt: "2026-05-13T14:00:00.000Z",
          finalGateStatus: "passed",
          integrationEvidencePaths: ["/repo/.agent-team/evidence/integration.json"],
          cleanupRecommendation: "eligible-after-evidence-saved"
        },
        slice: {
          sliceId: input.sliceId,
          title: "Core",
          state: "integrated",
          ownerRole: "slice-implementer",
          dependencies: [],
          writeScope: ["src/core"],
          acceptanceTests: ["focused tests"],
          integrationEvidence: [
            {
              integratedAt: "2026-05-13T14:00:00.000Z",
              integrationMethod: input.integrationMethod,
              summary: input.summary,
              changedFiles: input.changedFiles,
              verification: input.verification,
              evidencePaths: ["/repo/.agent-team/evidence/integration.json"],
              retainedWorktreePath: "/repo/.worktrees/slice_core",
              cleanupRecommendation: "eligible-after-evidence-saved"
            }
          ]
        },
        workflow: {
          workflowId: input.workflowId,
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T14:00:00.000Z",
          planningStatus: "approved",
          goal: {
            title: "Workflow",
            successCriteria: ["integration evidence recorded"],
            constraints: ["provider neutral"],
            nonGoals: ["auto cleanup"]
          },
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [],
          consensusRounds: [],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_record_integration", {
      workflowId: "workflow_mcp",
      sliceId: "slice_core",
      integrationMethod: "manual-patch",
      summary: "Codex integrated the slice.",
      changedFiles: ["src/core/workflow-integration-evidence.ts"],
      verification: [
        {
          command: "npm test -- tests/core/workflow-integration-evidence.test.ts",
          status: "passed",
          summary: "Focused tests passed."
        }
      ],
      evidencePaths: ["/repo/.agent-team/evidence/integration.json"],
      retainedWorktreePath: "/repo/.worktrees/slice_core",
      cleanupRecommendation: "eligible-after-evidence-saved"
    });

    expect(result.structuredContent).toMatchObject({
      queueItem: {
        sliceId: "slice_core",
        state: "integrated",
        finalGateStatus: "passed"
      },
      slice: {
        sliceId: "slice_core",
        state: "integrated",
        integrationEvidence: [
          expect.objectContaining({
            integrationMethod: "manual-patch",
            cleanupRecommendation: "eligible-after-evidence-saved"
          })
        ]
      }
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /internalPrompt|rawProvider|providerSession|commandArgs|secret/i
    );
  });

  it("builds workflow completion reports through MCP using the injected workflow service", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      buildWorkflowReport: async (input) => ({
        workflowId: input.workflowId,
        completionStatus: "complete",
        counts: {
          total: 1,
          integrated: 1,
          readyToIntegrate: 0,
          inProgress: 0,
          blocked: 0,
          deferred: 0,
          missingEvidence: 0,
          cleanupReady: 1
        },
        rows: [
          {
            sliceId: "slice_core",
            title: "Core",
            state: "integrated",
            category: "cleanup-ready",
            completionReady: true,
            blockers: [],
            reasons: ["slice is integrated and retained worktree can be cleaned up after operator approval"],
            evidencePaths: ["/repo/.agent-team/evidence/integration.json"],
            retainedWorktreePath: "/repo/.worktrees/slice_core",
            cleanupRecommendation: "eligible-after-evidence-saved"
          }
        ],
        report: `Workflow ${input.workflowId} is complete.`
      })
    });

    const result = await handlers.handleToolCall("agent_team_workflow_report", {
      workflowId: "workflow_mcp",
      includeWorkflow: false
    });

    expect(result.structuredContent).toMatchObject({
      workflowId: "workflow_mcp",
      completionStatus: "complete",
      counts: { cleanupReady: 1 },
      rows: [
        expect.objectContaining({
          sliceId: "slice_core",
          category: "cleanup-ready",
          completionReady: true
        })
      ]
    });
    expect(JSON.stringify(result.structuredContent)).not.toMatch(
      /internalPrompt|rawProvider|providerSession|commandArgs|secret/i
    );
  });

  it("rejects invalid workflow slice orchestration input before invoking injected services", async () => {
    let startCalled = false;
    let unblockCalled = false;
    let reviewCalled = false;
    let queueCalled = false;
    let integrationCalled = false;
    let reportCalled = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      startWorkflowSlices: async () => {
        startCalled = true;
        throw new Error("should not start");
      },
      unblockWorkflowSlice: async () => {
        unblockCalled = true;
        throw new Error("should not unblock");
      },
      reviewWorkflowSlice: async () => {
        reviewCalled = true;
        throw new Error("should not review");
      },
      buildWorkflowIntegrationQueue: async () => {
        queueCalled = true;
        throw new Error("should not queue");
      },
      recordWorkflowIntegration: async () => {
        integrationCalled = true;
        throw new Error("should not record integration");
      },
      buildWorkflowReport: async () => {
        reportCalled = true;
        throw new Error("should not report");
      }
    });

    const startResult = await handlers.handleToolCall("agent_team_start_slices", {
      workflowId: "workflow_mcp",
      concurrency: 0
    });
    const unblockResult = await handlers.handleToolCall("agent_team_unblock_slice", {
      workflowId: "workflow_mcp",
      sliceId: "slice_blocked",
      dependencyEvidence: []
    });
    const reviewResult = await handlers.handleToolCall("agent_team_review_slice", {
      workflowId: "workflow_mcp",
      sliceId: "slice_core",
      codexDecision: {
        status: "approve",
        category: "technical",
        summary: "Missing verdicts should fail."
      },
      verdicts: []
    });
    const queueResult = await handlers.handleToolCall("agent_team_integration_queue", {
      workflowId: "workflow_mcp",
      sliceIds: []
    });
    const integrationResult = await handlers.handleToolCall("agent_team_record_integration", {
      workflowId: "workflow_mcp",
      sliceId: "slice_core",
      integrationMethod: "manual-patch",
      summary: "Missing verification should fail.",
      changedFiles: ["src/core/workflow-integration-evidence.ts"],
      verification: []
    });
    const reportResult = await handlers.handleToolCall("agent_team_workflow_report", {
      workflowId: "workflow_mcp",
      includeWorkflow: "yes"
    });

    expect(startResult.structuredContent).toMatchObject({ status: "validation_error" });
    expect(unblockResult.structuredContent).toMatchObject({ status: "validation_error" });
    expect(reviewResult.structuredContent).toMatchObject({ status: "validation_error" });
    expect(queueResult.structuredContent).toMatchObject({ status: "validation_error" });
    expect(integrationResult.structuredContent).toMatchObject({ status: "validation_error" });
    expect(reportResult.structuredContent).toMatchObject({ status: "validation_error" });
    expect(startCalled).toBe(false);
    expect(unblockCalled).toBe(false);
    expect(reviewCalled).toBe(false);
    expect(queueCalled).toBe(false);
    expect(integrationCalled).toBe(false);
    expect(reportCalled).toBe(false);
  });

  it("loads workspace config for default lifecycle starts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-config-"));
    await mkdir(join(workspace, ".agent-team"), { recursive: true });
    await writeFile(
      join(workspace, ".agent-team", "config.json"),
      JSON.stringify({
        writeMode: { enabled: true, requireIsolatedWorktree: true }
      }),
      "utf8"
    );
    const configs: boolean[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: (config) => {
        configs.push(config.writeMode.enabled);
        return {
          async startRun(request) {
            return {
              runId: "run_configured_slice",
              status: "running",
              provider: "claude-code-cli",
              role: request.role,
              sidecarPath: join(workspace, ".agent-team", "runs", "run_configured_slice.json"),
              logPath: join(workspace, ".agent-team", "logs", "run_configured_slice.log"),
              executionCwd: `${workspace}-worktree`,
              mailboxPaths: {
                inbox: join(workspace, ".agent-team", "mailboxes", "run_configured_slice", "inbox.jsonl"),
                outbox: join(workspace, ".agent-team", "mailboxes", "run_configured_slice", "outbox.jsonl"),
                control: join(workspace, ".agent-team", "mailboxes", "run_configured_slice", "control.jsonl"),
                events: join(workspace, ".agent-team", "mailboxes", "run_configured_slice", "events.jsonl")
              }
            };
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun() {
            throw new Error("should not message");
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun() {
            throw new Error("should not cancel");
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_start", {
      role: "slice-implementer",
      task: "Implement the bounded slice."
    });

    expect(configs).toEqual([true]);
    expect(result.structuredContent).toMatchObject({
      runId: "run_configured_slice",
      executionCwd: `${workspace}-worktree`
    });
  });

  it("loads default write-disabled config for lifecycle starts when config is missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-config-"));
    const configs: boolean[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: (config) => {
        configs.push(config.writeMode.enabled);
        return {
          async startRun() {
            throw new Error("write mode is disabled");
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun() {
            throw new Error("should not message");
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun() {
            throw new Error("should not cancel");
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_start", {
        role: "slice-implementer",
        task: "Implement the bounded slice."
      })
    ).rejects.toThrow("write mode is disabled");
    expect(configs).toEqual([false]);
  });

  it("keeps default lifecycle managers live across repeated tool calls for a workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-live-"));
    const createdManagers: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        const managerId = `manager_${createdManagers.length + 1}`;
        const activeRuns = new Set<string>();
        createdManagers.push(managerId);
        return {
          async startRun(request) {
            activeRuns.add("run_live");
            return {
              runId: "run_live",
              status: "running",
              provider: "claude-code-cli",
              role: request.role,
              sidecarPath: join(workspace, ".agent-team", "runs", "run_live.json"),
              logPath: join(workspace, ".agent-team", "logs", "run_live.log"),
              mailboxPaths: {
                inbox: join(workspace, ".agent-team", "mailboxes", "run_live", "inbox.jsonl"),
                outbox: join(workspace, ".agent-team", "mailboxes", "run_live", "outbox.jsonl"),
                control: join(workspace, ".agent-team", "mailboxes", "run_live", "control.jsonl"),
                events: join(workspace, ".agent-team", "mailboxes", "run_live", "events.jsonl")
              }
            };
          },
          async messageRun(request) {
            if (!activeRuns.has(request.runId)) {
              throw new Error(`lost active handle in ${managerId}`);
            }
            return {
              runId: request.runId,
              status: "delivered_live",
              record: {
                sequence: 1,
                runId: request.runId,
                role: "planner",
                provider: "claude-code-cli",
                messageType: "user_message",
                createdAt: "2026-05-11T00:00:00.000Z",
                correlationId: "msg",
                contentHash: "hash",
                payload: { message: request.message }
              },
              message: "Message delivered live."
            };
          },
          async getStatus(cwd, runId) {
            if (!activeRuns.has(runId)) {
              throw new Error(`lost active handle in ${managerId}`);
            }
            return {
              runId,
              role: "planner",
              provider: "claude-code-cli",
              status: "running",
              createdAt: "2026-05-11T00:00:00.000Z",
              updatedAt: "2026-05-11T00:00:00.000Z",
              capabilitiesUsed: ["structuredOutput"],
              evidencePaths: []
            };
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun(cwd, runId) {
            if (!activeRuns.has(runId)) {
              throw new Error(`lost active handle in ${managerId}`);
            }
            return {
              runId,
              status: "cancelled",
              sidecarPath: join(cwd, ".agent-team", "runs", `${runId}.json`),
              message: "Run cancelled."
            };
          },
          async windDownRun(cwd, runId) {
            if (!activeRuns.has(runId)) {
              throw new Error(`lost active handle in ${managerId}`);
            }
            return {
              runId,
              status: "winding-down",
              sidecarPath: join(cwd, ".agent-team", "runs", `${runId}.json`),
              message: "Wind-down requested."
            };
          }
        };
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_start", {
        role: "planner",
        task: "Review plan"
      })
    ).resolves.toMatchObject({ structuredContent: { runId: "run_live" } });
    await expect(
      handlers.handleToolCall("agent_team_status", { runId: "run_live" })
    ).resolves.toMatchObject({ structuredContent: { run: { status: "running" } } });
    await expect(
      handlers.handleToolCall("agent_team_message", {
        runId: "run_live",
        message: "Please keep going."
      })
    ).resolves.toMatchObject({
      structuredContent: { status: "delivered_live", runId: "run_live" }
    });
    await expect(
      handlers.handleToolCall("agent_team_cancel", { runId: "run_live" })
    ).resolves.toMatchObject({ structuredContent: { status: "cancelled" } });
    await expect(
      handlers.handleToolCall("agent_team_wind_down", { runId: "run_live" })
    ).resolves.toMatchObject({ structuredContent: { status: "winding-down" } });
    expect(createdManagers).toEqual(["manager_1"]);
  });

  it("starts parallel agent runs through the shared lifecycle registry with defaults", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-parallel-"));
    const createdManagers: string[] = [];
    const requests: Array<{
      readonly managerId: string;
      readonly role: string;
      readonly task: string;
      readonly cwd: string;
      readonly provider: string | undefined;
      readonly timeoutMs: number | undefined;
    }> = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        const managerId = `manager_${createdManagers.length + 1}`;
        createdManagers.push(managerId);
        return {
          async startRun(request) {
            requests.push({
              managerId,
              role: request.role,
              task: request.task,
              cwd: request.cwd,
              provider: request.provider,
              timeoutMs: request.timeoutMs
            });
            return {
              runId: `run_${request.role}`,
              status: "running",
              provider: request.provider ?? "claude-code-cli",
              role: request.role,
              sidecarPath: join(request.cwd, ".agent-team", "runs", `run_${request.role}.json`),
              logPath: join(request.cwd, ".agent-team", "logs", `run_${request.role}.log`),
              mailboxPaths: {
                inbox: join(request.cwd, ".agent-team", "mailboxes", `run_${request.role}`, "inbox.jsonl"),
                outbox: join(request.cwd, ".agent-team", "mailboxes", `run_${request.role}`, "outbox.jsonl"),
                control: join(request.cwd, ".agent-team", "mailboxes", `run_${request.role}`, "control.jsonl"),
                events: join(request.cwd, ".agent-team", "mailboxes", `run_${request.role}`, "events.jsonl")
              }
            };
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun() {
            throw new Error("should not message");
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun() {
            throw new Error("should not cancel");
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_start_parallel", {
      cwd: workspace,
      provider: "claude-code-cli",
      timeoutMs: 1234,
      concurrency: 2,
      runs: [
        { role: "planner", task: "Plan", correlationId: "plan" },
        { role: "debugger", task: "Debug", provider: "claude-code-cli", timeoutMs: 5678 }
      ]
    });

    expect(createdManagers).toEqual(["manager_1"]);
    expect(requests).toEqual(
      expect.arrayContaining([
        {
          managerId: "manager_1",
          role: "planner",
          task: "Plan",
          cwd: workspace,
          provider: "claude-code-cli",
          timeoutMs: 1234
        },
        {
          managerId: "manager_1",
          role: "debugger",
          task: "Debug",
          cwd: workspace,
          provider: "claude-code-cli",
          timeoutMs: 5678
        }
      ])
    );
    expect(requests).toHaveLength(2);
    expect(result.structuredContent).toMatchObject({
      status: "started",
      concurrency: 2,
      runs: [
        {
          status: "started",
          index: 0,
          correlationId: "plan",
          run: { runId: "run_planner" }
        },
        {
          status: "started",
          index: 1,
          run: { runId: "run_debugger" }
        }
      ]
    });
    expect(String(result.structuredContent?.batchId)).toMatch(/^batch_/);
  });

  it("returns partial failure for parallel starts without dropping later runs", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-mcp-parallel-"));
    const attempted: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => ({
        async startRun(request) {
          attempted.push(request.role);
          if (request.role === "debugger") {
            throw new Error("provider failed");
          }
          return {
            runId: `run_${request.role}`,
            status: "running",
            provider: "claude-code-cli",
            role: request.role,
            sidecarPath: join(workspace, ".agent-team", "runs", `run_${request.role}.json`),
            logPath: join(workspace, ".agent-team", "logs", `run_${request.role}.log`),
            mailboxPaths: {
              inbox: join(workspace, ".agent-team", "mailboxes", `run_${request.role}`, "inbox.jsonl"),
              outbox: join(workspace, ".agent-team", "mailboxes", `run_${request.role}`, "outbox.jsonl"),
              control: join(workspace, ".agent-team", "mailboxes", `run_${request.role}`, "control.jsonl"),
              events: join(workspace, ".agent-team", "mailboxes", `run_${request.role}`, "events.jsonl")
            }
          };
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_start_parallel", {
      runs: [
        { role: "planner", task: "Plan" },
        { role: "debugger", task: "Debug", correlationId: "debug" },
        { role: "test-designer", task: "Test" }
      ],
      concurrency: 1
    });

    expect(attempted).toEqual(["planner", "debugger", "test-designer"]);
    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "started", index: 0, run: { runId: "run_planner" } },
        {
          status: "failed",
          index: 1,
          correlationId: "debug",
          role: "debugger",
          task: "Debug",
          error: "provider failed"
        },
        { status: "started", index: 2, run: { runId: "run_test-designer" } }
      ]
    });
  });

  it("validates parallel start args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      lifecycleFactory: () => ({
        async startRun() {
          called = true;
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      })
    });

    const cases: Array<Record<string, unknown>> = [
      {},
      { runs: [] },
      { runs: [{ role: "nope", task: "Plan" }] },
      { runs: [{ role: "planner", task: "" }] },
      { runs: [{ role: "planner", task: "Plan", cwd: 1 }] },
      { runs: [{ role: "planner", task: "Plan", provider: 1 }] },
      { runs: [{ role: "planner", task: "Plan", timeoutMs: -1 }] },
      { runs: [{ role: "planner", task: "Plan", correlationId: 1 }] },
      { runs: [{ role: "planner", task: "Plan" }], concurrency: 0 },
      { runs: [{ role: "planner", task: "Plan" }], concurrency: 9 },
      { runs: [{ role: "planner", task: "Plan" }], concurrency: 1.5 }
    ];

    for (const input of cases) {
      const result = await handlers.handleToolCall("agent_team_start_parallel", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("dispatches through injected read-only dispatcher", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      dispatch: async (request) => ({
        runId: "run_mcp",
        status: "completed",
        provider: "claude-code-cli",
        role: request.role,
        verdict: {
          status: "SHIP",
          summary: "ok",
          requiredChanges: [],
          evidence: [],
          risks: [],
          warnings: [],
          raw: ""
        },
        sidecarPath: "/repo/.agent-team/runs/run_mcp.json",
        logPath: "/repo/.agent-team/logs/run_mcp.log"
      })
    });

    const result = await handlers.handleToolCall("agent_team_dispatch", {
      role: "planner",
      task: "Review plan"
    });

    expect(result.structuredContent?.runId).toBe("run_mcp");
    expect(result.structuredContent?.role).toBe("planner");
  });

  it("validates dispatch args before invoking dispatcher", async () => {
    let called = false;
    const handlers = createToolHandlers({
      dispatch: async () => {
        called = true;
        throw new Error("should not dispatch");
      }
    });

    const result = await handlers.handleToolCall("agent_team_dispatch", {
      role: "planner"
    });

    expect(called).toBe(false);
    expect(result.structuredContent?.status).toBe("validation_error");
  });

  it("reads persisted status by run id", async () => {
    const workspace = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp("/tmp/agent-team-status-")
    );
    await writeRunSidecar(workspace, {
      runId: "run_status",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_status"
    });

    expect(result.structuredContent?.run?.status).toBe("completed");
  });

  it("archives corrupt sidecars and returns a recovery result from status", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-corrupt-status-"));
    const corruptPath = runSidecarPath(workspace, "run_corrupt_status");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{ nope", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_corrupt_status"
    });

    expect(result.structuredContent).toMatchObject({
      status: "state_corrupt",
      runId: "run_corrupt_status",
      operation: "agent_team_status",
      kind: "json",
      originalPath: corruptPath,
      recovery: "archived",
      interventionRequired: true
    });
    const archivePath = result.structuredContent?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{ nope");
  });

  it("uses default lifecycle status reconciliation for running sidecars", async () => {
    const workspace = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp("/tmp/agent-team-status-")
    );
    await writeRunSidecar(workspace, {
      runId: "run_running_status",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_running_status"
    });

    expect(result.structuredContent?.run).toMatchObject({
      status: "running",
      detached: true
    });
  });

  it("validates status_many args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          called = true;
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: 1 }] },
      { cwd: 1, runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }], concurrency: 0 },
      { runs: [{ runId: "run_1" }], concurrency: 9 },
      { runs: [{ runId: "run_1" }], concurrency: 1.5 }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_status_many", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("reads many statuses through the lifecycle registry with default and per-run cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-status-many-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-status-many-other-"));
    const managerByCwd = new Map<string, string>();
    const calls: string[] = [];
    let managerCount = 0;
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        managerCount += 1;
        const managerId = `manager_${managerCount}`;
        return {
          async startRun() {
            throw new Error("should not start");
          },
          async getStatus(cwd, runId) {
            managerByCwd.set(cwd, managerId);
            calls.push(`${managerId}:${cwd}:${runId}`);
            return {
              runId,
              role: "planner",
              provider: "claude-code-cli",
              status: "completed",
              createdAt: "2026-05-11T00:00:00.000Z",
              updatedAt: "2026-05-11T00:00:01.000Z",
              capabilitiesUsed: ["structuredOutput"],
              evidencePaths: []
            };
          },
          async messageRun() {
            throw new Error("should not message");
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun() {
            throw new Error("should not cancel");
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_status_many", {
      cwd: workspace,
      concurrency: 2,
      runs: [
        { runId: "run_a", correlationId: "a" },
        { runId: "run_b", cwd: otherWorkspace, correlationId: "b" },
        { runId: "run_c" }
      ]
    });

    expect(managerByCwd.get(workspace)).toBeDefined();
    expect(managerByCwd.get(otherWorkspace)).toBeDefined();
    expect(managerByCwd.get(workspace)).not.toBe(managerByCwd.get(otherWorkspace));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${managerByCwd.get(workspace)}:${workspace}:run_a`,
        `${managerByCwd.get(workspace)}:${workspace}:run_c`,
        `${managerByCwd.get(otherWorkspace)}:${otherWorkspace}:run_b`
      ])
    );
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_a",
          cwd: workspace,
          correlationId: "a",
          run: { runId: "run_a", status: "completed" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_b",
          cwd: otherWorkspace,
          correlationId: "b",
          run: { runId: "run_b", status: "completed" }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_c",
          cwd: workspace,
          run: { runId: "run_c", status: "completed" }
        }
      ]
    });
  });

  it("recovers one corrupt status_many sidecar and still returns later statuses", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-status-many-corrupt-"));
    const corruptPath = runSidecarPath(workspace, "run_corrupt_many");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{ nope", "utf8");
    await writeRunSidecar(workspace, {
      runId: "run_ok_many",
      role: "planner",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status_many", {
      runs: [
        { runId: "run_corrupt_many", correlationId: "bad" },
        { runId: "run_ok_many" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_many",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_many",
            operation: "agent_team_status_many",
            kind: "json",
            originalPath: corruptPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_many",
          cwd: workspace,
          run: { status: "completed" }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.runs as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{ nope");
  });

  it("uses lifecycle reconciliation for status_many running sidecars without duplicate detach events", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-status-many-detached-"));
    for (const runId of ["run_detached_a", "run_detached_b"]) {
      await writeRunSidecar(workspace, {
        runId,
        role: "planner",
        provider: "claude-code-cli",
        status: "running",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:01.000Z",
        capabilitiesUsed: ["structuredOutput"],
        evidencePaths: []
      });
    }
    const handlers = createToolHandlers({ cwd: () => workspace });

    await handlers.handleToolCall("agent_team_status_many", {
      concurrency: 2,
      runs: [{ runId: "run_detached_a" }, { runId: "run_detached_b" }]
    });
    const result = await handlers.handleToolCall("agent_team_status_many", {
      concurrency: 2,
      runs: [{ runId: "run_detached_a" }, { runId: "run_detached_b" }]
    });

    expect(result.structuredContent).toMatchObject({
      status: "ok",
      runs: [
        { status: "ok", run: { runId: "run_detached_a", detached: true } },
        { status: "ok", run: { runId: "run_detached_b", detached: true } }
      ]
    });
    const eventsA = await readMailboxRecords(workspace, "run_detached_a", "events");
    const eventsB = await readMailboxRecords(workspace, "run_detached_b", "events");
    expect(
      eventsA.filter((record) => record.messageType === "detached_handle_missing")
    ).toHaveLength(1);
    expect(
      eventsB.filter((record) => record.messageType === "detached_handle_missing")
    ).toHaveLength(1);
  });

  it("validates team record args before durable-state writes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-team-invalid-"));
    const handlers = createToolHandlers({ cwd: () => workspace });

    const invalidCreateInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "../runs/run_escape" }] },
      { runs: [{ runId: "team_not_a_run" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: "" }] },
      { cwd: "", runs: [{ runId: "run_1" }] },
      { name: "", runs: [{ runId: "run_1" }] },
      { description: "", runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }, { runId: "run_1" }] },
      { runs: [{ runId: "run_1" }, { runId: "run_1", cwd: `${workspace}/.` }] }
    ];

    for (const input of invalidCreateInputs) {
      const result = await handlers.handleToolCall("agent_team_create_team", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }

    for (const input of [
      {},
      { teamId: "" },
      { teamId: 1 },
      { teamId: "../runs/run_escape" },
      { teamId: "run_not_a_team" },
      { teamId: "team_1", cwd: 1 }
    ]) {
      const result = await handlers.handleToolCall("agent_team_get_team", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }

    const invalidList = await handlers.handleToolCall("agent_team_list_teams", { cwd: 1 });
    expect(invalidList.structuredContent?.status).toBe("validation_error");

    const invalidDashboardInputs: Record<string, unknown>[] = [
      {},
      { teamId: "team_1", runs: [{ runId: "run_1" }] },
      { teamId: "" },
      { teamId: "../runs/run_escape" },
      { teamId: "run_not_a_team" },
      { teamId: "team_1", cwd: 1 },
      { teamId: "team_1", concurrency: 0 },
      { teamId: "team_1", concurrency: 9 },
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "../runs/run_escape" }] },
      { runs: [{ runId: "team_not_a_run" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: "" }] }
    ];
    for (const input of invalidDashboardInputs) {
      const result = await handlers.handleToolCall("agent_team_dashboard", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
  });

  it("rejects team id traversal before state recovery can archive another artifact", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-team-traversal-"));
    const runPath = runSidecarPath(workspace, "run_escape");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(runPath, "{ nope", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_get_team", {
      teamId: "../runs/run_escape"
    });

    expect(result.structuredContent?.status).toBe("validation_error");
    await expect(readFile(runPath, "utf8")).resolves.toBe("{ nope");
  });

  it("creates, reads, and lists durable team records without invoking lifecycle control", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-team-record-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-team-record-other-"));
    await writeRunSidecar(workspace, {
      runId: "run_team_a",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:01:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    await writeRunSidecar(otherWorkspace, {
      runId: "run_team_b",
      role: "code-reviewer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:02:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const lifecycleCalls: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycle: {
        async startRun() {
          lifecycleCalls.push("start");
          throw new Error("should not start");
        },
        async getStatus() {
          lifecycleCalls.push("status");
          throw new Error("should not status");
        },
        async messageRun() {
          lifecycleCalls.push("message");
          throw new Error("should not message");
        },
        async replyRun() {
          lifecycleCalls.push("reply");
          throw new Error("should not reply");
        },
        async cancelRun() {
          lifecycleCalls.push("cancel");
          throw new Error("should not cancel");
        },
        async windDownRun() {
          lifecycleCalls.push("wind_down");
          throw new Error("should not wind down");
        }
      }
    });

    const created = await handlers.handleToolCall("agent_team_create_team", {
      cwd: workspace,
      name: "Review Team",
      description: "Parallel review",
      runs: [
        { runId: "run_team_a", correlationId: "planner" },
        { runId: "run_team_b", cwd: otherWorkspace, correlationId: "reviewer" }
      ]
    });

    expect(created.structuredContent).toMatchObject({
      status: "created",
      team: {
        name: "Review Team",
        description: "Parallel review",
        runs: [
          { runId: "run_team_a", cwd: workspace, correlationId: "planner" },
          { runId: "run_team_b", cwd: otherWorkspace, correlationId: "reviewer" }
        ]
      }
    });
    const teamId = String(
      (created.structuredContent?.team as { teamId?: string } | undefined)?.teamId
    );
    expect(teamId).toMatch(/^team_/);
    await expect(readTeamRecord(workspace, teamId)).resolves.toMatchObject({
      teamId,
      evidencePath: teamRecordPath(workspace, teamId)
    });

    await expect(
      handlers.handleToolCall("agent_team_get_team", { teamId })
    ).resolves.toMatchObject({
      structuredContent: {
        status: "ok",
        team: { teamId, runs: [{ runId: "run_team_a" }, { runId: "run_team_b" }] }
      }
    });
    await expect(handlers.handleToolCall("agent_team_list_teams", {})).resolves.toMatchObject({
      structuredContent: {
        status: "ok",
        teams: [expect.objectContaining({ teamId })]
      }
    });
    expect(lifecycleCalls).toEqual([]);
  });

  it("returns a read-only dashboard from a team record or explicit run refs", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-dashboard-"));
    await writeRunSidecar(workspace, {
      runId: "run_dash_a",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:01:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: [join(workspace, ".agent-team", "logs", "run_dash_a.diff.patch")],
      executionCwd: join(workspace, ".worktrees", "run_dash_a"),
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "retained",
      workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_dash_a.diff.patch"),
      changedFiles: ["src/core/team-dashboard.ts"],
      currentActivity: { type: "tool_start", summary: "Running tests", timestamp: 10 }
    });
    await writeRunSidecar(workspace, {
      runId: "run_dash_b",
      role: "code-reviewer",
      provider: "claude-code-cli",
      status: "awaiting-input",
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:02:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: [],
      awaitingInputSince: "2026-05-12T10:02:00.000Z",
      pendingOutboxRequest: {
        id: "question_dash_b",
        sequence: 1,
        messageType: "clarification",
        correlationId: "question",
        createdAt: "2026-05-12T10:02:00.000Z",
        payload: { question: "Waiting for scope" }
      },
      outputSummary: "Waiting for scope"
    });
    await writeTeamRecord(workspace, {
      teamId: "team_dashboard",
      name: "Dashboard Team",
      createdAt: "2026-05-12T10:03:00.000Z",
      updatedAt: "2026-05-12T10:03:00.000Z",
      runs: [
        { runId: "run_dash_a", cwd: workspace, correlationId: "a" },
        { runId: "run_dash_b", cwd: workspace, correlationId: "b" }
      ],
      evidencePath: teamRecordPath(workspace, "team_dashboard")
    });

    const lifecycleCalls: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycle: {
        async startRun() {
          lifecycleCalls.push("start");
          throw new Error("should not start");
        },
        async getStatus() {
          lifecycleCalls.push("status");
          throw new Error("should not status");
        },
        async messageRun() {
          lifecycleCalls.push("message");
          throw new Error("should not message");
        },
        async replyRun() {
          lifecycleCalls.push("reply");
          throw new Error("should not reply");
        },
        async cancelRun() {
          lifecycleCalls.push("cancel");
          throw new Error("should not cancel");
        },
        async windDownRun() {
          lifecycleCalls.push("wind_down");
          throw new Error("should not wind down");
        }
      }
    });

    const fromTeam = await handlers.handleToolCall("agent_team_dashboard", {
      teamId: "team_dashboard"
    });

    expect(fromTeam.structuredContent).toMatchObject({
      status: "ok",
      source: { kind: "team", teamId: "team_dashboard" },
      counts: {
        total: 2,
        running: 1,
        awaitingInput: 1,
        retainedWorktree: 1
      },
      rows: [
        {
          runId: "run_dash_a",
          latestActivity: "Running tests",
          cleanupStatus: "retained",
          changedFiles: ["src/core/team-dashboard.ts"]
        },
        {
          runId: "run_dash_b",
          pendingQuestion: true,
          latestActivity: "Waiting for scope",
          awaitingInputSince: "2026-05-12T10:02:00.000Z"
        }
      ]
    });
    expect(String(fromTeam.structuredContent?.report)).toContain("Team team_dashboard");
    expect(JSON.stringify(fromTeam.structuredContent)).not.toContain("providerSessionId");
    expect(JSON.stringify(fromTeam.structuredContent)).not.toContain("promptHash");

    const explicit = await handlers.handleToolCall("agent_team_dashboard", {
      runs: [{ runId: "run_dash_b", correlationId: "only" }]
    });

    expect(explicit.structuredContent).toMatchObject({
      status: "ok",
      source: { kind: "runs" },
      counts: { total: 1, awaitingInput: 1 },
      rows: [{ runId: "run_dash_b", correlationId: "only" }]
    });
    expect(lifecycleCalls).toEqual([]);
  });

  it("reports dashboard corrupt state without archiving inspected artifacts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-dashboard-corrupt-"));
    const corruptTeamPath = teamRecordPath(workspace, "team_dashboard_corrupt");
    await mkdir(join(workspace, ".agent-team", "teams"), { recursive: true });
    await writeFile(corruptTeamPath, "{ nope", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const corruptTeam = await handlers.handleToolCall("agent_team_dashboard", {
      teamId: "team_dashboard_corrupt"
    });

    expect(corruptTeam.structuredContent).toMatchObject({
      status: "partial_failure",
      source: {
        kind: "team",
        teamId: "team_dashboard_corrupt",
        evidencePath: corruptTeamPath
      },
      counts: { total: 0, recovered: 1 },
      rows: [],
      issues: [
        {
          status: "state_corrupt",
          target: "team_record",
          recovery: {
            status: "state_corrupt",
            operation: "agent_team_dashboard",
            originalPath: corruptTeamPath,
            recovery: "reported",
            interventionRequired: true
          }
        }
      ]
    });
    await expect(readFile(corruptTeamPath, "utf8")).resolves.toBe("{ nope");

    await writeRunSidecar(workspace, {
      runId: "run_dashboard_corrupt_mailbox",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:01:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    await writeRunSidecar(workspace, {
      runId: "run_dashboard_after_corrupt",
      role: "code-reviewer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:02:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const corruptMailboxPath = mailboxPath(
      workspace,
      "run_dashboard_corrupt_mailbox",
      "events"
    );
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_dashboard_corrupt_mailbox"), {
      recursive: true
    });
    await writeFile(corruptMailboxPath, "{ nope\n", "utf8");

    const corruptMailbox = await handlers.handleToolCall("agent_team_dashboard", {
      runs: [
        { runId: "run_dashboard_corrupt_mailbox", correlationId: "bad" },
        { runId: "run_dashboard_after_corrupt", correlationId: "after" }
      ]
    });

    expect(corruptMailbox.structuredContent).toMatchObject({
      status: "partial_failure",
      counts: { total: 2, recovered: 1 },
      rows: [
        {
          status: "state_corrupt",
          runId: "run_dashboard_corrupt_mailbox",
          correlationId: "bad",
          recovery: {
            operation: "agent_team_dashboard",
            originalPath: corruptMailboxPath,
            recovery: "reported"
          }
        },
        {
          status: "ok",
          runId: "run_dashboard_after_corrupt",
          correlationId: "after"
        }
      ]
    });
    await expect(readFile(corruptMailboxPath, "utf8")).resolves.toBe("{ nope\n");
  });

  it("recovers corrupt state while creating or reading team records", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-team-corrupt-"));
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    const corruptRunPath = runSidecarPath(workspace, "run_corrupt_team");
    await writeFile(corruptRunPath, "{ nope", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const createResult = await handlers.handleToolCall("agent_team_create_team", {
      runs: [{ runId: "run_corrupt_team" }]
    });

    expect(createResult.structuredContent).toMatchObject({
      status: "state_corrupt",
      operation: "agent_team_create_team",
      originalPath: corruptRunPath,
      recovery: "archived",
      interventionRequired: true
    });

    const corruptTeamPath = teamRecordPath(workspace, "team_corrupt");
    await mkdir(join(workspace, ".agent-team", "teams"), { recursive: true });
    await writeFile(corruptTeamPath, "{ nope", "utf8");
    const getResult = await handlers.handleToolCall("agent_team_get_team", {
      teamId: "team_corrupt"
    });

    expect(getResult.structuredContent).toMatchObject({
      status: "state_corrupt",
      operation: "agent_team_get_team",
      originalPath: corruptTeamPath,
      recovery: "archived",
      interventionRequired: true
    });
  });

  it("validates summary args before durable-state reads", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-summary-invalid-"));
    const handlers = createToolHandlers({ cwd: () => workspace });

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: "" }] },
      { cwd: "", runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }], concurrency: 0 },
      { runs: [{ runId: "run_1" }], concurrency: 9 },
      { runs: [{ runId: "run_1" }], concurrency: 1.5 },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1" }]
      },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1", cwd: `${workspace}/.` }]
      }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_summary", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
  });

  it("returns a read-only team summary from persisted sidecars and mailboxes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-summary-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-summary-other-"));
    await writeRunSidecar(workspace, {
      runId: "run_active_summary",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:01:00.000Z",
      capabilitiesUsed: ["structuredOutput", "workspaceIsolation"],
      evidencePaths: [join(workspace, ".agent-team", "logs", "run_active_summary.diff.patch")],
      detached: true,
      executionCwd: join(workspace, ".worktrees", "run_active_summary"),
      workspaceRetention: "retain-until-integrated",
      workspaceCleanup: "retained",
      workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_active_summary.diff.patch"),
      changedFiles: ["src/core/team-summary.ts"],
      verdict: {
        status: "SHIP",
        summary: "ready",
        requiredChanges: [],
        evidence: ["tests"],
        risks: [],
        warnings: [],
        raw: "status: SHIP"
      }
    });
    await writeRunSidecar(otherWorkspace, {
      runId: "run_waiting_summary",
      role: "planner",
      provider: "claude-code-cli",
      status: "awaiting-input",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:02:00.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: [],
      pendingOutboxRequest: {
        id: "ask_1",
        sequence: 1,
        messageType: "clarification_request",
        correlationId: "ask",
        createdAt: "2026-05-11T00:02:00.000Z",
        payload: { question: "Which file?" }
      }
    });
    await appendMailboxRecord(workspace, "run_active_summary", "events", {
      role: "slice-implementer",
      provider: "claude-code-cli",
      messageType: "detached_handle_missing",
      correlationId: "event_1",
      payload: { message: "detached" },
      createdAt: "2026-05-11T00:01:00.000Z"
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_summary", {
      cwd: workspace,
      concurrency: 2,
      runs: [
        { runId: "run_active_summary", correlationId: "active" },
        { runId: "run_waiting_summary", cwd: otherWorkspace, correlationId: "waiting" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "ok",
      groups: {
        running: ["run_active_summary"],
        awaitingInput: ["run_waiting_summary"],
        detached: ["run_active_summary"],
        retainedWorktree: ["run_active_summary"]
      },
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_active_summary",
          cwd: workspace,
          correlationId: "active",
          run: {
            role: "slice-implementer",
            status: "running",
            operationalState: "running",
            detached: true,
            retainedWorktree: true
          },
          evidence: {
            sidecarPath: runSidecarPath(workspace, "run_active_summary"),
            workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_active_summary.diff.patch"),
            changedFiles: ["src/core/team-summary.ts"],
            verdict: { status: "SHIP" },
            mailboxes: {
              events: {
                path: mailboxPath(workspace, "run_active_summary", "events"),
                count: 1,
                lastSequence: 1
              }
            }
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_waiting_summary",
          cwd: otherWorkspace,
          correlationId: "waiting",
          run: {
            status: "awaiting-input",
            operationalState: "awaitingInput",
            pendingOutboxRequest: { id: "ask_1" }
          }
        }
      ]
    });
  });

  it("recovers one corrupt summary mailbox and still returns later summaries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-summary-corrupt-"));
    for (const runId of ["run_corrupt_summary", "run_ok_summary"]) {
      await writeRunSidecar(workspace, {
        runId,
        role: "planner",
        provider: "claude-code-cli",
        status: "completed",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:01:00.000Z",
        capabilitiesUsed: ["structuredOutput"],
        evidencePaths: []
      });
    }
    const eventsPath = mailboxPath(workspace, "run_corrupt_summary", "events");
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_corrupt_summary"), {
      recursive: true
    });
    await writeFile(eventsPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_summary", {
      runs: [
        { runId: "run_corrupt_summary", correlationId: "bad" },
        { runId: "run_ok_summary" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      groups: { terminal: ["run_ok_summary"] },
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_summary",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_summary",
            operation: "agent_team_summary",
            kind: "jsonl",
            originalPath: eventsPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_summary",
          cwd: workspace,
          run: { operationalState: "terminal" }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.runs as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("returns implementation handoff fields from persisted status sidecars", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-status-"));
    await writeRunSidecar(workspace, {
      runId: "run_impl_status",
      role: "slice-implementer",
      provider: "claude-code-cli",
      status: "completed",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: [
        "structuredOutput",
        "tools",
        "edits",
        "sessionResume",
        "cancellation",
        "workspaceIsolation"
      ],
      evidencePaths: [join(workspace, ".agent-team", "logs", "run_impl_status.diff.patch")],
      executionCwd: "/tmp/.agent-team-worktrees/repo/run_impl_status",
      changedFiles: ["src/core/config.ts"],
      workspaceStatus: ["M src/core/config.ts"],
      workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_impl_status.diff.patch"),
      workspaceCleanup: "retained"
    });
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_impl_status"
    });

    expect(result.structuredContent?.run).toMatchObject({
      role: "slice-implementer",
      status: "completed",
      executionCwd: "/tmp/.agent-team-worktrees/repo/run_impl_status",
      changedFiles: ["src/core/config.ts"],
      workspaceStatus: ["M src/core/config.ts"],
      workspaceDiffPath: join(workspace, ".agent-team", "logs", "run_impl_status.diff.patch"),
      workspaceCleanup: "retained"
    });
  });

  it("returns pending outbox evidence from lifecycle status", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async getStatus(cwd, runId) {
          return {
            runId,
            role: "planner",
            provider: "claude-code-cli",
            status: "awaiting-input",
            createdAt: "2026-05-11T00:00:00.000Z",
            updatedAt: "2026-05-11T00:01:00.000Z",
            awaitingInputSince: "2026-05-11T00:01:00.000Z",
            capabilitiesUsed: ["structuredOutput"],
            evidencePaths: [],
            outboxRequestIds: ["ask_1"],
            pendingOutboxRequest: {
              id: "ask_1",
              sequence: 1,
              messageType: "clarification_request",
              correlationId: "corr_ask_1",
              createdAt: "2026-05-11T00:01:00.000Z",
              payload: { question: "Which test should I inspect first?" }
            }
          };
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_status", {
      runId: "run_waiting"
    });

    expect(result.structuredContent?.run).toMatchObject({
      runId: "run_waiting",
      status: "awaiting-input",
      pendingOutboxRequest: {
        id: "ask_1",
        sequence: 1,
        messageType: "clarification_request",
        payload: { question: "Which test should I inspect first?" }
      }
    });
  });

  it("returns lifecycle message results for awaiting-input replies", async () => {
    const calls: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun(request) {
          calls.push(`message:${request.runId}:${request.message}`);
          return {
            runId: request.runId,
            status: "delivered_live",
            record: {
              sequence: 1,
              runId: request.runId,
              role: "planner",
              provider: "claude-code-cli",
              messageType: "user_message",
              createdAt: "2026-05-11T00:02:00.000Z",
              correlationId: request.correlationId ?? "msg_awaiting",
              contentHash: "hash",
              payload: { message: request.message }
            },
            message: "Message delivered live."
          };
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_message", {
      runId: "run_waiting",
      message: "Use the CI logs first.",
      correlationId: "msg_awaiting"
    });

    expect(calls).toEqual(["message:run_waiting:Use the CI logs first."]);
    expect(result.structuredContent).toMatchObject({
      runId: "run_waiting",
      status: "delivered_live",
      record: {
        correlationId: "msg_awaiting",
        payload: { message: "Use the CI logs first." }
      }
    });
  });

  it("validates message_many args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          called = true;
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { messages: [] },
      { messages: [1] },
      { messages: [{}] },
      { messages: [{ runId: "", message: "hi" }] },
      { messages: [{ runId: "run_1" }] },
      { messages: [{ runId: "run_1", message: "" }] },
      { messages: [{ runId: "run_1", message: "hi", cwd: 1 }] },
      { messages: [{ runId: "run_1", message: "hi", messageType: "" }] },
      { messages: [{ runId: "run_1", message: "hi", correlationId: 1 }] },
      { cwd: "", messages: [{ runId: "run_1", message: "hi" }] },
      { messages: [{ runId: "run_1", message: "hi" }], concurrency: 0 },
      { messages: [{ runId: "run_1", message: "hi" }], concurrency: 9 },
      { messages: [{ runId: "run_1", message: "hi" }], concurrency: 1.5 },
      {
        messages: [
          { runId: "run_1", message: "first" },
          { runId: "run_1", message: "second" }
        ]
      },
      {
        messages: [
          { runId: "run_1", message: "first" },
          { runId: "run_1", cwd: "/repo/.", message: "same normalized target" }
        ]
      }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_message_many", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("sends many messages through the lifecycle registry with default and per-message cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-message-many-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-message-many-other-"));
    const managerByCwd = new Map<string, string>();
    const calls: string[] = [];
    let managerCount = 0;
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        managerCount += 1;
        const managerId = `manager_${managerCount}`;
        return {
          async startRun() {
            throw new Error("should not start");
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun(request) {
            managerByCwd.set(request.cwd, managerId);
            calls.push(`${managerId}:${request.cwd}:${request.runId}:${request.message}`);
            return {
              runId: request.runId,
              status:
                request.runId === "run_b" ? "delivered_live" : "recorded_for_resume",
              record: {
                sequence: 1,
                runId: request.runId,
                role: "planner",
                provider: "claude-code-cli",
                messageType: request.messageType ?? "user_message",
                createdAt: "2026-05-11T00:02:00.000Z",
                correlationId: request.correlationId ?? request.runId,
                contentHash: "hash",
                payload: { message: request.message }
              },
              message:
                request.runId === "run_b"
                  ? "Message delivered live."
                  : "Message recorded for resume."
            };
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun() {
            throw new Error("should not cancel");
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_message_many", {
      cwd: workspace,
      concurrency: 2,
      messages: [
        { runId: "run_a", message: "first", correlationId: "a" },
        {
          runId: "run_b",
          cwd: otherWorkspace,
          message: "second",
          messageType: "evidence",
          correlationId: "b"
        },
        { runId: "run_c", message: "third" }
      ]
    });

    expect(managerByCwd.get(workspace)).toBeDefined();
    expect(managerByCwd.get(otherWorkspace)).toBeDefined();
    expect(managerByCwd.get(workspace)).not.toBe(managerByCwd.get(otherWorkspace));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${managerByCwd.get(workspace)}:${workspace}:run_a:first`,
        `${managerByCwd.get(workspace)}:${workspace}:run_c:third`,
        `${managerByCwd.get(otherWorkspace)}:${otherWorkspace}:run_b:second`
      ])
    );
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      messages: [
        {
          status: "ok",
          index: 0,
          runId: "run_a",
          cwd: workspace,
          correlationId: "a",
          result: { runId: "run_a", status: "recorded_for_resume" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_b",
          cwd: otherWorkspace,
          correlationId: "b",
          result: {
            runId: "run_b",
            status: "delivered_live",
            record: { messageType: "evidence" }
          }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_c",
          cwd: workspace,
          result: { runId: "run_c", status: "recorded_for_resume" }
        }
      ]
    });
  });

  it("returns partial failures from message_many without dropping later messages", async () => {
    const attempted: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun(request) {
          attempted.push(request.runId);
          if (request.runId === "run_bad") {
            throw new Error("message failed");
          }
          return {
            runId: request.runId,
            status: "recorded_for_resume",
            record: {
              sequence: 1,
              runId: request.runId,
              role: "planner",
              provider: "claude-code-cli",
              messageType: "user_message",
              createdAt: "2026-05-11T00:02:00.000Z",
              correlationId: request.correlationId ?? request.runId,
              contentHash: "hash",
              payload: { message: request.message }
            },
            message: "Message recorded for resume."
          };
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_message_many", {
      concurrency: 1,
      messages: [
        { runId: "run_ok_1", message: "first" },
        { runId: "run_bad", message: "bad", correlationId: "bad" },
        { runId: "run_ok_2", message: "third" }
      ]
    });

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      messages: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        {
          status: "failed",
          index: 1,
          runId: "run_bad",
          cwd: "/repo",
          correlationId: "bad",
          error: "message failed"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("recovers one corrupt message_many mailbox and still returns later message results", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-message-many-corrupt-"));
    for (const runId of ["run_corrupt_many_message", "run_ok_many_message"]) {
      await writeRunSidecar(workspace, {
        runId,
        role: "planner",
        provider: "claude-code-cli",
        status: "running",
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:01.000Z",
        capabilitiesUsed: ["structuredOutput"],
        evidencePaths: []
      });
    }
    const inboxPath = mailboxPath(workspace, "run_corrupt_many_message", "inbox");
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_corrupt_many_message"), {
      recursive: true
    });
    await writeFile(inboxPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_message_many", {
      messages: [
        {
          runId: "run_corrupt_many_message",
          message: "bad",
          correlationId: "bad"
        },
        { runId: "run_ok_many_message", message: "ok" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      messages: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_many_message",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_many_message",
            operation: "agent_team_message_many",
            kind: "jsonl",
            originalPath: inboxPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_many_message",
          cwd: workspace,
          result: { status: "recorded_for_resume" }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.messages as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("validates cancel_many args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          called = true;
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: "" }] },
      { cwd: "", runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }], concurrency: 0 },
      { runs: [{ runId: "run_1" }], concurrency: 9 },
      { runs: [{ runId: "run_1" }], concurrency: 1.5 },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1" }]
      },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1", cwd: "/repo/." }]
      }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_cancel_many", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("cancels many runs through the lifecycle registry with default and per-run cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-cancel-many-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-cancel-many-other-"));
    const managerByCwd = new Map<string, string>();
    const calls: string[] = [];
    let managerCount = 0;
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        managerCount += 1;
        const managerId = `manager_${managerCount}`;
        return {
          async startRun() {
            throw new Error("should not start");
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun() {
            throw new Error("should not message");
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun(cwd, runId) {
            managerByCwd.set(cwd, managerId);
            calls.push(`${managerId}:${cwd}:${runId}`);
            return {
              runId,
              status: runId === "run_b" ? "cancelling" : "cancelled",
              sidecarPath: `${cwd}/.agent-team/runs/${runId}.json`,
              message:
                runId === "run_b"
                  ? "Cancellation intent recorded."
                  : "Run cancelled."
            };
          },
          async windDownRun() {
            throw new Error("should not wind down");
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_cancel_many", {
      cwd: workspace,
      concurrency: 2,
      runs: [
        { runId: "run_a", correlationId: "a" },
        { runId: "run_b", cwd: otherWorkspace, correlationId: "b" },
        { runId: "run_c" }
      ]
    });

    expect(managerByCwd.get(workspace)).toBeDefined();
    expect(managerByCwd.get(otherWorkspace)).toBeDefined();
    expect(managerByCwd.get(workspace)).not.toBe(managerByCwd.get(otherWorkspace));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${managerByCwd.get(workspace)}:${workspace}:run_a`,
        `${managerByCwd.get(workspace)}:${workspace}:run_c`,
        `${managerByCwd.get(otherWorkspace)}:${otherWorkspace}:run_b`
      ])
    );
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_a",
          cwd: workspace,
          correlationId: "a",
          result: { runId: "run_a", status: "cancelled" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_b",
          cwd: otherWorkspace,
          correlationId: "b",
          result: { runId: "run_b", status: "cancelling" }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_c",
          cwd: workspace,
          result: { runId: "run_c", status: "cancelled" }
        }
      ]
    });
  });

  it("returns partial failures from cancel_many without dropping later runs", async () => {
    const attempted: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_bad") {
            throw new Error("cancel failed");
          }
          return {
            runId,
            status: "cancelled",
            sidecarPath: `/repo/.agent-team/runs/${runId}.json`,
            message: "Run cancelled."
          };
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_cancel_many", {
      concurrency: 1,
      runs: [
        { runId: "run_ok_1" },
        { runId: "run_bad", correlationId: "bad" },
        { runId: "run_ok_2" }
      ]
    });

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        {
          status: "failed",
          index: 1,
          runId: "run_bad",
          cwd: "/repo",
          correlationId: "bad",
          error: "cancel failed"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("recovers one corrupt cancel_many sidecar and still returns later cancellation results", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-cancel-many-corrupt-"));
    await writeRunSidecar(workspace, {
      runId: "run_ok_many_cancel",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput", "cancellation"],
      evidencePaths: []
    });
    const corruptPath = runSidecarPath(workspace, "run_corrupt_many_cancel");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_cancel_many", {
      runs: [
        { runId: "run_corrupt_many_cancel", correlationId: "bad" },
        { runId: "run_ok_many_cancel" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_many_cancel",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_many_cancel",
            operation: "agent_team_cancel_many",
            kind: "json",
            originalPath: corruptPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_many_cancel",
          cwd: workspace,
          result: {
            status: "running",
            detached: true,
            message: expect.stringContaining("No active process")
          }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.runs as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("validates wind_down_many args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          called = true;
          throw new Error("should not wind down");
        }
      }
    });

    const invalidInputs: Record<string, unknown>[] = [
      {},
      { runs: [] },
      { runs: [1] },
      { runs: [{}] },
      { runs: [{ runId: "" }] },
      { runs: [{ runId: "run_1", cwd: 1 }] },
      { runs: [{ runId: "run_1", correlationId: "" }] },
      { cwd: "", runs: [{ runId: "run_1" }] },
      { runs: [{ runId: "run_1" }], concurrency: 0 },
      { runs: [{ runId: "run_1" }], concurrency: 9 },
      { runs: [{ runId: "run_1" }], concurrency: 1.5 },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1" }]
      },
      {
        runs: [{ runId: "run_1" }, { runId: "run_1", cwd: "/repo/." }]
      }
    ];

    for (const input of invalidInputs) {
      const result = await handlers.handleToolCall("agent_team_wind_down_many", input);
      expect(result.structuredContent?.status).toBe("validation_error");
    }
    expect(called).toBe(false);
  });

  it("winds down many runs through the lifecycle registry with default and per-run cwd", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-wind-many-"));
    const otherWorkspace = await mkdtemp(join(tmpdir(), "agent-team-wind-many-other-"));
    const managerByCwd = new Map<string, string>();
    const calls: string[] = [];
    let managerCount = 0;
    const handlers = createToolHandlers({
      cwd: () => workspace,
      lifecycleFactory: () => {
        managerCount += 1;
        const managerId = `manager_${managerCount}`;
        return {
          async startRun() {
            throw new Error("should not start");
          },
          async getStatus() {
            throw new Error("should not status");
          },
          async messageRun() {
            throw new Error("should not message");
          },
          async replyRun() {
            throw new Error("should not reply");
          },
          async cancelRun() {
            throw new Error("should not cancel");
          },
          async windDownRun(cwd, runId) {
            managerByCwd.set(cwd, managerId);
            calls.push(`${managerId}:${cwd}:${runId}`);
            return {
              runId,
              status: runId === "run_b" ? "completed" : "winding-down",
              sidecarPath: `${cwd}/.agent-team/runs/${runId}.json`,
              message:
                runId === "run_b"
                  ? "Run completed during wind-down."
                  : "Wind-down requested."
            };
          }
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_wind_down_many", {
      cwd: workspace,
      concurrency: 2,
      runs: [
        { runId: "run_a", correlationId: "a" },
        { runId: "run_b", cwd: otherWorkspace, correlationId: "b" },
        { runId: "run_c" }
      ]
    });

    expect(managerByCwd.get(workspace)).toBeDefined();
    expect(managerByCwd.get(otherWorkspace)).toBeDefined();
    expect(managerByCwd.get(workspace)).not.toBe(managerByCwd.get(otherWorkspace));
    expect(calls).toEqual(
      expect.arrayContaining([
        `${managerByCwd.get(workspace)}:${workspace}:run_a`,
        `${managerByCwd.get(workspace)}:${workspace}:run_c`,
        `${managerByCwd.get(otherWorkspace)}:${otherWorkspace}:run_b`
      ])
    );
    expect(result.structuredContent).toMatchObject({
      status: "ok",
      runs: [
        {
          status: "ok",
          index: 0,
          runId: "run_a",
          cwd: workspace,
          correlationId: "a",
          result: { runId: "run_a", status: "winding-down" }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_b",
          cwd: otherWorkspace,
          correlationId: "b",
          result: { runId: "run_b", status: "completed" }
        },
        {
          status: "ok",
          index: 2,
          runId: "run_c",
          cwd: workspace,
          result: { runId: "run_c", status: "winding-down" }
        }
      ]
    });
  });

  it("returns partial failures from wind_down_many without dropping later runs", async () => {
    const attempted: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_bad") {
            throw new Error("wind failed");
          }
          return {
            runId,
            status: "winding-down",
            sidecarPath: `/repo/.agent-team/runs/${runId}.json`,
            message: "Wind-down requested."
          };
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_wind_down_many", {
      concurrency: 1,
      runs: [
        { runId: "run_ok_1" },
        { runId: "run_bad", correlationId: "bad" },
        { runId: "run_ok_2" }
      ]
    });

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        {
          status: "failed",
          index: 1,
          runId: "run_bad",
          cwd: "/repo",
          correlationId: "bad",
          error: "wind failed"
        },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("recovers one corrupt wind_down_many sidecar and still returns later wind-down results", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-wind-many-corrupt-"));
    await writeRunSidecar(workspace, {
      runId: "run_ok_many_wind",
      role: "planner",
      provider: "claude-code-cli",
      status: "running",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:01.000Z",
      capabilitiesUsed: ["structuredOutput"],
      evidencePaths: []
    });
    const corruptPath = runSidecarPath(workspace, "run_corrupt_many_wind");
    await mkdir(join(workspace, ".agent-team", "runs"), { recursive: true });
    await writeFile(corruptPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_wind_down_many", {
      runs: [
        { runId: "run_corrupt_many_wind", correlationId: "bad" },
        { runId: "run_ok_many_wind" }
      ]
    });

    expect(result.structuredContent).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt_many_wind",
          cwd: workspace,
          correlationId: "bad",
          recovery: {
            status: "state_corrupt",
            runId: "run_corrupt_many_wind",
            operation: "agent_team_wind_down_many",
            kind: "json",
            originalPath: corruptPath,
            recovery: "archived",
            interventionRequired: true
          }
        },
        {
          status: "ok",
          index: 1,
          runId: "run_ok_many_wind",
          cwd: workspace,
          result: { status: "winding-down" }
        }
      ]
    });
    const archivePath = (
      result.structuredContent?.runs as Array<{ recovery?: { archivePath?: string } }>
    )[0]?.recovery?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("archives corrupt mailboxes and returns a recovery result from reply", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-team-corrupt-reply-"));
    await writeRunSidecar(workspace, {
      runId: "run_corrupt_reply",
      role: "planner",
      provider: "claude-code-cli",
      status: "awaiting-input",
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:01:00.000Z",
      capabilitiesUsed: ["structuredOutput", "sessionResume"],
      evidencePaths: [],
      providerSessionId: "session_parent"
    });
    const inboxPath = mailboxPath(workspace, "run_corrupt_reply", "inbox");
    await mkdir(join(workspace, ".agent-team", "mailboxes", "run_corrupt_reply"), {
      recursive: true
    });
    await writeFile(inboxPath, "{\"bad\"\n", "utf8");
    const handlers = createToolHandlers({ cwd: () => workspace });

    const result = await handlers.handleToolCall("agent_team_reply", {
      runId: "run_corrupt_reply"
    });

    expect(result.structuredContent).toMatchObject({
      status: "state_corrupt",
      runId: "run_corrupt_reply",
      operation: "agent_team_reply",
      kind: "jsonl",
      originalPath: inboxPath,
      recovery: "archived",
      interventionRequired: true
    });
    const archivePath = result.structuredContent?.archivePath as string;
    expect(archivePath).toContain(join(".agent-team", "archive"));
    await expect(readFile(archivePath, "utf8")).resolves.toBe("{\"bad\"\n");
  });

  it("lets non-state-corruption lifecycle errors propagate", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("boom");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new StateCorruptionError("Synthetic corruption without metadata.");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_status", { runId: "run_boom" })
    ).rejects.toThrow("boom");
  });

  it("delegates start, status, message, reply, cancel, and wind-down to injected lifecycle", async () => {
    const calls: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun(request) {
          calls.push(`start:${request.role}:${request.task}:${request.cwd}`);
          return {
            runId: "run_lifecycle",
            status: "running",
            provider: "claude-code-cli",
            role: request.role,
            sidecarPath: "/repo/.agent-team/runs/run_lifecycle.json",
            logPath: "/repo/.agent-team/logs/run_lifecycle.log",
            mailboxPaths: {
              inbox: "/repo/.agent-team/mailboxes/run_lifecycle/inbox.jsonl",
              outbox: "/repo/.agent-team/mailboxes/run_lifecycle/outbox.jsonl",
              control: "/repo/.agent-team/mailboxes/run_lifecycle/control.jsonl",
              events: "/repo/.agent-team/mailboxes/run_lifecycle/events.jsonl"
            }
          };
        },
        async messageRun(request) {
          calls.push(`message:${request.cwd}:${request.runId}:${request.message}`);
          return {
            runId: request.runId,
            status: "delivered_live",
            record: {
              sequence: 1,
              runId: request.runId,
              role: "planner",
              provider: "claude-code-cli",
              messageType: "user_message",
              createdAt: "2026-05-11T00:00:00.000Z",
              correlationId: request.correlationId ?? "msg",
              contentHash: "hash",
              payload: { message: request.message }
            },
            message: "Message delivered live."
          };
        },
        async replyRun(request) {
          calls.push(`reply:${request.cwd}:${request.runId}:${request.message}`);
          return {
            runId: "run_reply_child",
            status: "running",
            provider: "claude-code-cli",
            role: "planner",
            sidecarPath: "/repo/.agent-team/runs/run_reply_child.json",
            logPath: "/repo/.agent-team/logs/run_reply_child.log",
            mailboxPaths: {
              inbox: "/repo/.agent-team/mailboxes/run_reply_child/inbox.jsonl",
              outbox: "/repo/.agent-team/mailboxes/run_reply_child/outbox.jsonl",
              control: "/repo/.agent-team/mailboxes/run_reply_child/control.jsonl",
              events: "/repo/.agent-team/mailboxes/run_reply_child/events.jsonl"
            },
            parentRunId: request.runId,
            resumedFromRunId: request.runId,
            providerSessionId: "session_parent"
          };
        },
        async getStatus(cwd, runId) {
          calls.push(`status:${cwd}:${runId}`);
          return {
            runId,
            role: "planner",
            provider: "claude-code-cli",
            status: "running",
            createdAt: "2026-05-11T00:00:00.000Z",
            updatedAt: "2026-05-11T00:00:00.000Z",
            capabilitiesUsed: ["structuredOutput"],
            evidencePaths: []
          };
        },
        async cancelRun(cwd, runId) {
          calls.push(`cancel:${cwd}:${runId}`);
          return {
            runId,
            status: "cancelled",
            sidecarPath: `${cwd}/.agent-team/runs/${runId}.json`,
            message: "Run cancelled."
          };
        },
        async windDownRun(cwd, runId) {
          calls.push(`wind:${cwd}:${runId}`);
          return {
            runId,
            status: "winding-down",
            sidecarPath: `${cwd}/.agent-team/runs/${runId}.json`,
            message: "Wind-down requested."
          };
        }
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_start", {
        role: "planner",
        task: "Review plan"
      })
    ).resolves.toMatchObject({ structuredContent: { runId: "run_lifecycle" } });
    await expect(
      handlers.handleToolCall("agent_team_status", { runId: "run_lifecycle" })
    ).resolves.toMatchObject({ structuredContent: { run: { status: "running" } } });
    await expect(
      handlers.handleToolCall("agent_team_message", {
        runId: "run_lifecycle",
        message: "Please keep going."
      })
    ).resolves.toMatchObject({
      structuredContent: { status: "delivered_live", runId: "run_lifecycle" }
    });
    await expect(
      handlers.handleToolCall("agent_team_reply", {
        runId: "run_lifecycle",
        message: "Please reply now."
      })
    ).resolves.toMatchObject({
      structuredContent: {
        runId: "run_reply_child",
        parentRunId: "run_lifecycle",
        providerSessionId: "session_parent"
      }
    });
    await expect(
      handlers.handleToolCall("agent_team_cancel", { runId: "run_lifecycle" })
    ).resolves.toMatchObject({ structuredContent: { status: "cancelled" } });
    await expect(
      handlers.handleToolCall("agent_team_wind_down", { runId: "run_lifecycle" })
    ).resolves.toMatchObject({ structuredContent: { status: "winding-down" } });

    expect(calls).toEqual([
      "start:planner:Review plan:/repo",
      "status:/repo:run_lifecycle",
      "message:/repo:run_lifecycle:Please keep going.",
      "reply:/repo:run_lifecycle:Please reply now.",
      "cancel:/repo:run_lifecycle",
      "wind:/repo:run_lifecycle"
    ]);
  });

  it("delegates cleanup through the lifecycle selected for the workspace", async () => {
    const workspaces: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/default",
      lifecycleFactory: () => ({
        async startRun() {
          throw new Error("should not start");
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        },
        async cleanupRunWorkspace(request) {
          workspaces.push(`${request.cwd}:${request.runId}:${request.force}`);
          return {
            runId: request.runId,
            status: "removed",
            sidecarPath: `${request.cwd}/.agent-team/runs/${request.runId}.json`,
            workspaceCleanup: "removed",
            message: "Implementation worktree removed."
          };
        }
      })
    });

    const result = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "run_cleanup_tool",
      cwd: "/repo",
      force: true
    });

    expect(workspaces).toEqual(["/repo:run_cleanup_tool:true"]);
    expect(result.structuredContent).toMatchObject({
      runId: "run_cleanup_tool",
      status: "removed",
      workspaceCleanup: "removed"
    });
  });

  it("validates cleanup args before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      lifecycle: {
        async startRun() {
          called = true;
          throw new Error("should not start");
        },
        async getStatus() {
          called = true;
          throw new Error("should not status");
        },
        async messageRun() {
          called = true;
          throw new Error("should not message");
        },
        async replyRun() {
          called = true;
          throw new Error("should not reply");
        },
        async cancelRun() {
          called = true;
          throw new Error("should not cancel");
        },
        async windDownRun() {
          called = true;
          throw new Error("should not wind down");
        },
        async cleanupRunWorkspace() {
          called = true;
          throw new Error("should not cleanup");
        }
      }
    });

    const missingForce = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "run_1"
    });
    const invalidForce = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "run_1",
      force: "yes"
    });
    const invalidCwd = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "run_1",
      cwd: 42,
      force: true
    });
    const invalidRun = await handlers.handleToolCall("agent_team_cleanup", {
      runId: "",
      force: true
    });

    expect(called).toBe(false);
    expect(missingForce.structuredContent?.status).toBe("validation_error");
    expect(invalidForce.structuredContent?.status).toBe("validation_error");
    expect(invalidCwd.structuredContent?.status).toBe("validation_error");
    expect(invalidRun.structuredContent?.status).toBe("validation_error");
  });

  it("passes optional cwd to agent_team_doctor", async () => {
    const workspaces: string[] = [];
    const handlers = createToolHandlers({
      cwd: () => "/default",
      doctor: async (input = {}) => {
        const { workspaceRoot } = input;
        workspaces.push(workspaceRoot ?? "");
        return {
          ok: true,
          checks: [
            {
              id: "config",
              status: "pass",
              message: "ok"
            }
          ],
          warnings: []
        };
      }
    });

    const result = await handlers.handleToolCall("agent_team_doctor", {
      cwd: "/repo"
    });

    expect(workspaces).toEqual(["/repo"]);
    expect(result.structuredContent?.ok).toBe(true);
  });

  it("validates doctor cwd before invoking doctor", async () => {
    let called = false;
    const handlers = createToolHandlers({
      doctor: async () => {
        called = true;
        throw new Error("should not call doctor");
      }
    });

    const result = await handlers.handleToolCall("agent_team_doctor", {
      cwd: 42
    });

    expect(called).toBe(false);
    expect(result.structuredContent?.status).toBe("validation_error");
  });

  it("returns execution cwd from implementation starts", async () => {
    const handlers = createToolHandlers({
      cwd: () => "/repo",
      lifecycle: {
        async startRun(request) {
          return {
            runId: "run_slice",
            status: "running",
            provider: "claude-code-cli",
            role: request.role,
            sidecarPath: "/repo/.agent-team/runs/run_slice.json",
            logPath: "/repo/.agent-team/logs/run_slice.log",
            executionCwd: "/tmp/.agent-team-worktrees/repo/run_slice",
            mailboxPaths: {
              inbox: "/repo/.agent-team/mailboxes/run_slice/inbox.jsonl",
              outbox: "/repo/.agent-team/mailboxes/run_slice/outbox.jsonl",
              control: "/repo/.agent-team/mailboxes/run_slice/control.jsonl",
              events: "/repo/.agent-team/mailboxes/run_slice/events.jsonl"
            }
          };
        },
        async getStatus() {
          throw new Error("should not status");
        },
        async messageRun() {
          throw new Error("should not message");
        },
        async replyRun() {
          throw new Error("should not reply");
        },
        async cancelRun() {
          throw new Error("should not cancel");
        },
        async windDownRun() {
          throw new Error("should not wind down");
        }
      }
    });

    await expect(
      handlers.handleToolCall("agent_team_start", {
        role: "slice-implementer",
        task: "Implement config loading"
      })
    ).resolves.toMatchObject({
      structuredContent: {
        runId: "run_slice",
        executionCwd: "/tmp/.agent-team-worktrees/repo/run_slice"
      }
    });
  });

  it("includes guarded Codex orchestration prompts in plugin metadata", async () => {
    const plugin = JSON.parse(
      await readFile(new URL("../../.codex-plugin/plugin.json", import.meta.url), "utf8")
    ) as { interface?: { defaultPrompt?: readonly string[] } };

    expect(plugin.interface?.defaultPrompt).toContain(
      "Start an L11 agent-team workflow with Codex as orchestrator."
    );
    expect(plugin.interface?.defaultPrompt).not.toContain(
      "Start a bounded Claude agent team."
    );
    expect(plugin.interface?.defaultPrompt?.length).toBeLessThanOrEqual(3);
  });

  it("runs the shared CI script in GitHub CI", async () => {
    const workflow = await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8"
    );

    expect(workflow).toContain("- run: npm ci");
    expect(workflow).toContain("- run: npm run ci");
    expect(workflow.indexOf("- run: npm run ci")).toBeGreaterThan(
      workflow.indexOf("- run: npm ci")
    );
  });

  it("validates lifecycle control run ids before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      lifecycle: {
        async startRun() {
          called = true;
          throw new Error("should not start");
        },
        async getStatus() {
          called = true;
          throw new Error("should not status");
        },
        async messageRun() {
          called = true;
          throw new Error("should not message");
        },
        async replyRun() {
          called = true;
          throw new Error("should not reply");
        },
        async cancelRun() {
          called = true;
          throw new Error("should not cancel");
        },
        async windDownRun() {
          called = true;
          throw new Error("should not wind down");
        }
      }
    });

    const result = await handlers.handleToolCall("agent_team_cancel", { runId: "" });

    expect(called).toBe(false);
    expect(result.structuredContent?.status).toBe("validation_error");
  });

  it("validates message and reply payloads before invoking lifecycle", async () => {
    let called = false;
    const handlers = createToolHandlers({
      lifecycle: {
        async startRun() {
          called = true;
          throw new Error("should not start");
        },
        async getStatus() {
          called = true;
          throw new Error("should not status");
        },
        async messageRun() {
          called = true;
          throw new Error("should not message");
        },
        async replyRun() {
          called = true;
          throw new Error("should not reply");
        },
        async cancelRun() {
          called = true;
          throw new Error("should not cancel");
        },
        async windDownRun() {
          called = true;
          throw new Error("should not wind down");
        }
      }
    });

    const messageResult = await handlers.handleToolCall("agent_team_message", {
      runId: "run_1"
    });
    const replyResult = await handlers.handleToolCall("agent_team_reply", {
      runId: ""
    });

    expect(called).toBe(false);
    expect(messageResult.structuredContent?.status).toBe("validation_error");
    expect(replyResult.structuredContent?.status).toBe("validation_error");
  });

  it("registers the expected tool names", () => {
    expect(listToolNames()).toEqual([
      "agent_team_dispatch",
      "agent_team_start",
      "agent_team_start_parallel",
      "agent_team_reply",
      "agent_team_message",
      "agent_team_message_many",
      "agent_team_status",
      "agent_team_status_many",
      "agent_team_summary",
      "agent_team_create_team",
      "agent_team_get_team",
      "agent_team_list_teams",
      "agent_team_create_workflow",
      "agent_team_get_workflow",
      "agent_team_list_workflows",
      "agent_team_plan_consensus",
      "agent_team_start_slices",
      "agent_team_unblock_slice",
      "agent_team_review_slice",
      "agent_team_integration_queue",
      "agent_team_record_integration",
      "agent_team_workflow_report",
      "agent_team_workflow_next",
      "agent_team_record_user_decision",
      "agent_team_dashboard",
      "agent_team_cancel",
      "agent_team_cancel_many",
      "agent_team_wind_down",
      "agent_team_wind_down_many",
      "agent_team_cleanup",
      "agent_team_doctor",
      "agent_team_list_roles",
      "agent_team_list_providers"
    ]);
  });
});
