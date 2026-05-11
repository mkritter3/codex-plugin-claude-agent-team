import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registeredTools: [] as Array<{
    readonly name: string;
    readonly callback: (args: unknown) => Promise<unknown>;
  }>,
  createToolHandlers: vi.fn(),
  handleToolCall: vi.fn()
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(
      name: string,
      _metadata: unknown,
      callback: (args: unknown) => Promise<unknown>
    ): void {
      mocks.registeredTools.push({ name, callback });
    }
  }
}));

vi.mock("../../src/mcp/tools.js", () => ({
  listToolNames: () => ["agent_team_start", "agent_team_status"],
  createToolHandlers: mocks.createToolHandlers,
  handleToolCall: mocks.handleToolCall
}));

describe("MCP server", () => {
  beforeEach(() => {
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

  it("registers tool callbacks against one shared handler set", async () => {
    const { createAgentTeamServer } = await import("../../src/mcp/server.js");

    createAgentTeamServer();
    await mocks.registeredTools[0]?.callback({ role: "planner" });
    await mocks.registeredTools[1]?.callback({ runId: "run_live" });

    expect(mocks.createToolHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.handleToolCall).not.toHaveBeenCalled();
    expect(mocks.registeredTools.map((tool) => tool.name)).toEqual([
      "agent_team_start",
      "agent_team_status"
    ]);
  });
});
