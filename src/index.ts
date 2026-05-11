#!/usr/bin/env node
import { runStdioServer } from "./mcp/server.js";

runStdioServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
