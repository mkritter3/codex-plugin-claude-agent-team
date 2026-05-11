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
          message: "Claude Code CLI was not found on PATH.",
          details: {
            fix: "Install Claude Code CLI and ensure claude is available on PATH."
          }
        }
      ];
    }

    const version = await input.getVersion(claudePath);
    const auth = await input.runCommand(claudePath, ["auth", "status"], {
      env: input.env
    });

    return [
      {
        id: "claude-cli",
        status: "pass",
        message: "Claude Code CLI found.",
        details: {
          path: claudePath,
          version
        }
      },
      auth.ok
        ? {
            id: "claude-auth",
            status: "pass",
            message: "Claude Code CLI auth status succeeded.",
            details: {
              command: "claude auth status"
            }
          }
        : {
            id: "claude-auth",
            status: "fail",
            message: "Claude Code CLI is not authenticated for subscription OAuth.",
            details: {
              command: "claude auth status",
              exitCode: auth.exitCode,
              stderr: auth.stderr,
              fix: "Run claude auth login or open Claude Code and complete the subscription OAuth login flow."
            }
          }
    ];
  }
};
