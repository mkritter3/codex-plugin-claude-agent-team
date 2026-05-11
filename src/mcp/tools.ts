import { runDoctor } from "../doctor.js";
import { listRoles } from "../core/roles.js";
import { listProviders } from "../providers/index.js";
import { jsonToolResult, type JsonToolResult } from "../utils/json.js";

export const TOOL_NAMES = [
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
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const DEFERRED_TOOLS = new Set<ToolName>([
  "agent_team_dispatch",
  "agent_team_start",
  "agent_team_reply",
  "agent_team_message",
  "agent_team_status",
  "agent_team_cancel",
  "agent_team_wind_down"
]);

export function listToolNames(): readonly ToolName[] {
  return TOOL_NAMES;
}

export async function handleToolCall(
  name: ToolName,
  _args: Record<string, unknown>
): Promise<JsonToolResult> {
  if (name === "agent_team_list_roles") {
    return jsonToolResult({ roles: listRoles() });
  }

  if (name === "agent_team_list_providers") {
    return jsonToolResult({ providers: listProviders() });
  }

  if (name === "agent_team_doctor") {
    return jsonToolResult({ ...(await runDoctor()) });
  }

  if (DEFERRED_TOOLS.has(name)) {
    return jsonToolResult({
      status: "not_implemented",
      tool: name,
      milestone: "milestone-2"
    });
  }

  return jsonToolResult({
    status: "unknown_tool",
    tool: name
  });
}
