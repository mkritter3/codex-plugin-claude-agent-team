import { describe, expect, it } from "vitest";
import { handleToolCall, listToolNames } from "../../src/mcp/tools.js";

describe("MCP tool handlers", () => {
  it("lists roles with capability requirements", async () => {
    const result = await handleToolCall("agent_team_list_roles", {});

    expect(result.structuredContent?.roles?.[0]?.id).toBe("architect");
    expect(result.structuredContent?.roles).toHaveLength(7);
  });

  it("lists configured providers", async () => {
    const result = await handleToolCall("agent_team_list_providers", {});

    expect(result.structuredContent?.providers?.[0]?.id).toBe("claude-code-cli");
  });

  it("returns stable not_implemented envelopes for deferred lifecycle tools", async () => {
    const result = await handleToolCall("agent_team_dispatch", {
      role: "planner",
      task: "Review plan"
    });

    expect(result.structuredContent).toEqual({
      status: "not_implemented",
      tool: "agent_team_dispatch",
      milestone: "milestone-2"
    });
  });

  it("registers the expected tool names", () => {
    expect(listToolNames()).toEqual([
      "agent_team_dispatch",
      "agent_team_start",
      "agent_team_reply",
      "agent_team_message",
      "agent_team_status",
      "agent_team_cancel",
      "agent_team_wind_down",
      "agent_team_doctor",
      "agent_team_list_roles",
      "agent_team_list_providers"
    ]);
  });
});
