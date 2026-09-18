import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverOptions: [] as Array<{ readonly name?: string; readonly version?: string }>,
  registeredTools: [] as Array<{
    readonly name: string;
    readonly metadata: {
      readonly title?: string;
      readonly description?: string;
      readonly inputSchema?: Record<string, unknown>;
    };
    readonly callback: (args: unknown) => Promise<unknown>;
  }>,
  createToolHandlers: vi.fn(),
  handleToolCall: vi.fn()
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    constructor(options: { readonly name?: string; readonly version?: string }) {
      mocks.serverOptions.push(options);
    }

    registerTool(
      name: string,
      metadata: {
        readonly title?: string;
        readonly description?: string;
        readonly inputSchema?: Record<string, unknown>;
      },
      callback: (args: unknown) => Promise<unknown>
    ): void {
      mocks.registeredTools.push({ name, metadata, callback });
    }
  }
}));

vi.mock("../../src/mcp/tools.js", () => ({
  listToolNames: () => [
    "agent_team_start",
    "agent_team_start_parallel",
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
    "agent_team_dashboard",
    "agent_team_cancel_many",
    "agent_team_wind_down_many",
    "agent_team_cleanup"
  ],
  createToolHandlers: mocks.createToolHandlers,
  handleToolCall: mocks.handleToolCall
}));

describe("MCP server", () => {
  beforeEach(() => {
    mocks.serverOptions.length = 0;
    mocks.registeredTools.length = 0;
    mocks.createToolHandlers.mockReset();
    mocks.handleToolCall.mockReset();
    mocks.createToolHandlers.mockReturnValue({
      handleToolCall: vi.fn(async (name: string, args: Record<string, unknown>) => ({
        structuredContent: { name, args }
      }))
    });
    mocks.handleToolCall.mockResolvedValue({
      structuredContent: { source: "stateless" }
    });
  });

  it("uses package-aligned MCP server identity", async () => {
    const { createAgentTeamServer } = await import("../../src/mcp/server.js");
    const { AGENT_TEAM_MCP_VERSION } = await import("../../src/version.js");

    createAgentTeamServer();

    expect(mocks.serverOptions[0]).toEqual({
      name: "agent-team",
      version: AGENT_TEAM_MCP_VERSION
    });
  });

  it("registers tool callbacks against one shared handler set", async () => {
    const { createAgentTeamServer } = await import("../../src/mcp/server.js");

    createAgentTeamServer();
    await mocks.registeredTools[0]?.callback({ role: "planner" });
    await mocks.registeredTools[1]?.callback({ runId: "run_live" });

    expect(mocks.createToolHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.handleToolCall).not.toHaveBeenCalled();
    expect(mocks.registeredTools.map((tool) => tool.name)).toEqual([
      "agent_team_start",
      "agent_team_start_parallel",
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
      "agent_team_dashboard",
      "agent_team_cancel_many",
      "agent_team_wind_down_many",
      "agent_team_cleanup"
    ]);
  });

  it("registers provider-neutral input schemas for tools", async () => {
    const { createAgentTeamServer } = await import("../../src/mcp/server.js");

    createAgentTeamServer();
    const metadataByName = new Map(
      mocks.registeredTools.map((tool) => [tool.name, tool.metadata])
    );

    for (const metadata of metadataByName.values()) {
      expect(metadata.inputSchema).toBeDefined();
      expect(metadata.description).not.toMatch(/prompt|Claude|claude-code-cli/i);
    }
    expect(metadataByName.get("agent_team_start")?.inputSchema).toMatchObject({
      role: expect.any(Object),
      task: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_start_parallel")?.inputSchema).toMatchObject({
      runs: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_message_many")?.inputSchema).toMatchObject({
      messages: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_status")?.inputSchema).toMatchObject({
      runId: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_status_many")?.inputSchema).toMatchObject({
      runs: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_summary")?.inputSchema).toMatchObject({
      runs: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_create_team")?.inputSchema).toMatchObject({
      runs: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_get_team")?.inputSchema).toMatchObject({
      teamId: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_list_teams")?.inputSchema).toMatchObject({
      cwd: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_create_workflow")?.inputSchema).toMatchObject({
      goal: expect.any(Object),
      slices: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_get_workflow")?.inputSchema).toMatchObject({
      workflowId: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_list_workflows")?.inputSchema).toMatchObject({
      cwd: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_plan_consensus")?.inputSchema).toMatchObject({
      workflowId: expect.any(Object),
      codexDecision: expect.any(Object),
      verdicts: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_start_slices")?.inputSchema).toMatchObject({
      workflowId: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_unblock_slice")?.inputSchema).toMatchObject({
      workflowId: expect.any(Object),
      sliceId: expect.any(Object),
      dependencyEvidence: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_review_slice")?.inputSchema).toMatchObject({
      workflowId: expect.any(Object),
      sliceId: expect.any(Object),
      codexDecision: expect.any(Object),
      verdicts: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_integration_queue")?.inputSchema).toMatchObject({
      workflowId: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_record_integration")?.inputSchema).toMatchObject({
      workflowId: expect.any(Object),
      sliceId: expect.any(Object),
      verification: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_workflow_report")?.inputSchema).toMatchObject({
      workflowId: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_dashboard")?.inputSchema).toMatchObject({
      teamId: expect.any(Object),
      runs: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_cancel_many")?.inputSchema).toMatchObject({
      runs: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_wind_down_many")?.inputSchema).toMatchObject({
      runs: expect.any(Object)
    });
    expect(metadataByName.get("agent_team_cleanup")?.inputSchema).toMatchObject({
      runId: expect.any(Object),
      force: expect.any(Object)
    });
  });
});
