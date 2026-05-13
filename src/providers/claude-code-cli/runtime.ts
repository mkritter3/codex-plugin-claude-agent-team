import { relative } from "node:path";
import { claudeCodeCliProvider } from "../index.js";
import type { AgentProviderRuntime } from "../runtime.js";
import type { ProviderHealthCheck } from "../types.js";
import {
  claudeAgentDefinitionArtifacts,
  ensureValidClaudeAgentDefinitionArtifacts
} from "./agent-definition-store.js";
import { startClaudeBackgroundSession } from "./background.js";
import { isClaudeCodeCliProfileProviderId, resolveClaudeCodeCliProfile } from "./config.js";
import {
  checkClaudeAgentDefinitions,
  inspectClaudeEnvironment
} from "./doctor.js";
import { runClaudePrint } from "./runner.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";
import type { AgentTeamConfig } from "../../core/types.js";
import type {
  ProviderPrintInput,
  ProviderPrintResult,
  ProviderSessionHandle,
  ProviderStartSessionInput
} from "../types.js";

export interface ClaudeCodeCliRuntimeOptions {
  readonly config?: AgentTeamConfig;
  readonly runClaudePrint?: typeof runClaudePrint;
  readonly startClaudeBackgroundSession?: typeof startClaudeBackgroundSession;
}

function fail(message: string): ProviderPrintResult {
  return {
    ok: false,
    text: "",
    stdout: "",
    stderr: message,
    exitCode: 1
  };
}

function resolveConfig(
  inputConfig: AgentTeamConfig | undefined,
  runtimeConfig: AgentTeamConfig | undefined
): AgentTeamConfig {
  return inputConfig ?? runtimeConfig ?? DEFAULT_AGENT_TEAM_CONFIG;
}

function resolveModel(
  config: AgentTeamConfig,
  providerId: string | undefined
): string | undefined | Error {
  if (providerId === undefined || !isClaudeCodeCliProfileProviderId(providerId)) {
    return undefined;
  }
  const profile = resolveClaudeCodeCliProfile(config, providerId);
  if (profile === undefined) {
    return new Error(`Claude Code CLI profile not found for provider ${providerId}.`);
  }
  if (profile.model === undefined) {
    return new Error(`Claude Code CLI profile ${profile.displayName ?? profile.id} requires model.`);
  }
  return profile.model;
}

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

export function createClaudeCodeCliRuntime(
  options: ClaudeCodeCliRuntimeOptions = {}
): AgentProviderRuntime {
  const runPrint = options.runClaudePrint ?? runClaudePrint;
  const startSession = options.startClaudeBackgroundSession ?? startClaudeBackgroundSession;

  return {
    id: "claude-code-cli",
    descriptor: claudeCodeCliProvider,
    inspectEnvironment: inspectClaudeEnvironment,
    async runPrint(input: ProviderPrintInput): Promise<ProviderPrintResult> {
      const model = resolveModel(resolveConfig(input.config, options.config), input.providerId);
      if (model instanceof Error) {
        return fail(model.message);
      }
      return runPrint({
        ...input,
        ...(model === undefined ? {} : { model })
      });
    },
    startSession(input: ProviderStartSessionInput): ProviderSessionHandle {
      const model = resolveModel(resolveConfig(input.config, options.config), input.providerId);
      if (model instanceof Error) {
        throw model;
      }
      return startSession({
        ...input,
        providerAuthMode: "subscription-oauth",
        ...(model === undefined ? {} : { model })
      });
    },
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
}

export const claudeCodeCliRuntime = createClaudeCodeCliRuntime();
