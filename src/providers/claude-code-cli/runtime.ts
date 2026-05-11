import { claudeCodeCliProvider } from "../index.js";
import type { AgentProviderRuntime } from "../runtime.js";
import { startClaudeBackgroundSession } from "./background.js";
import { inspectClaudeEnvironment } from "./doctor.js";
import { runClaudePrint } from "./runner.js";

export const claudeCodeCliRuntime: AgentProviderRuntime = {
  id: "claude-code-cli",
  descriptor: claudeCodeCliProvider,
  inspectEnvironment: inspectClaudeEnvironment,
  runPrint: runClaudePrint,
  startSession: startClaudeBackgroundSession,
  async healthCheck(input) {
    const claudePath = await input.findExecutable("claude");
    if (claudePath === undefined) {
      return [
        {
          id: "claude-cli",
          status: "fail",
          message: "Claude Code CLI was not found on PATH."
        }
      ];
    }

    return [
      {
        id: "claude-cli",
        status: "pass",
        message: "Claude Code CLI found.",
        details: {
          path: claudePath,
          version: await input.getVersion(claudePath)
        }
      }
    ];
  }
};
