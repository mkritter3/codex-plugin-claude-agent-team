import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createToolHandlers, listToolNames } from "./tools.js";

export function createAgentTeamServer(): McpServer {
  const server = new McpServer({
    name: "agent-team",
    version: "0.1.0"
  });
  const handlers = createToolHandlers();

  for (const toolName of listToolNames()) {
    server.registerTool(
      toolName,
      {
        title: toolName,
        description: `Agent Team tool: ${toolName}`
      },
      async (args) => handlers.handleToolCall(toolName, args as Record<string, unknown>)
    );
  }

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createAgentTeamServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
