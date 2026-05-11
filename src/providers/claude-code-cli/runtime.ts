import { relative } from "node:path";
import { claudeCodeCliProvider } from "../index.js";
import type { AgentProviderRuntime } from "../runtime.js";
import type { ProviderHealthCheck } from "../types.js";
import {
  claudeAgentDefinitionArtifacts,
  ensureValidClaudeAgentDefinitionArtifacts
} from "./agent-definition-store.js";
import { startClaudeBackgroundSession } from "./background.js";
import {
  checkClaudeAgentDefinitions,
  inspectClaudeEnvironment
} from "./doctor.js";
import { runClaudePrint } from "./runner.js";

async function checkClaudeAgentDefinitionArtifacts(
  workspaceRoot: string
): Promise<ProviderHealthCheck> {
  try {
    const artifact = await ensureValidClaudeAgentDefinitionArtifacts({ workspaceRoot });
    return {
      id: "claude-agent-definition-artifacts",
      status: "pass",
      message: "Generated Claude agent definition artifacts are current.",
      details: {
        agentsPath: artifact.manifest.agentsPath,
        manifestPath: artifact.manifest.manifestPath,
        definitionCount: artifact.manifest.definitionCount,
        definitionsHash: artifact.manifest.definitionsHash,
        action: artifact.action
      }
    };
  } catch (error) {
    const paths = claudeAgentDefinitionArtifacts(workspaceRoot);
    return {
      id: "claude-agent-definition-artifacts",
      status: "fail",
      message: "Generated Claude agent definition artifacts are not valid.",
      details: {
        agentsPath: relative(workspaceRoot, paths.agentsPath),
        manifestPath: relative(workspaceRoot, paths.manifestPath),
        error: error instanceof Error ? error.message : String(error),
        fix: "Repair Claude agent definitions by regenerating provider artifacts after reviewing the drift."
      }
    };
  }
}

export const claudeCodeCliRuntime: AgentProviderRuntime = {
  id: "claude-code-cli",
  descriptor: claudeCodeCliProvider,
  inspectEnvironment: inspectClaudeEnvironment,
  runPrint: runClaudePrint,
  startSession: startClaudeBackgroundSession,
  async healthCheck(input) {
    const agentArtifacts = await checkClaudeAgentDefinitionArtifacts(input.workspaceRoot);
    const claudePath = await input.findExecutable("claude");
    if (claudePath === undefined) {
      return [
        agentArtifacts,
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
      checkClaudeAgentDefinitions(),
      agentArtifacts,
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
