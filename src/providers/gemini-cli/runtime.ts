import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentProviderDescriptor, AgentTeamConfig } from "../../core/types.js";
import type {
  ProviderCommandRunner,
  ProviderEnvironmentInspection,
  ProviderEnvironmentInspectionInput,
  ProviderHealthCheck,
  ProviderHealthCheckInput,
  ProviderPrintInput,
  ProviderPrintResult,
  ProviderSessionActivity,
  ProviderSessionHandle,
  ProviderSessionSnapshot,
  ProviderStartSessionInput
} from "../types.js";
import type { AgentProviderRuntime } from "../runtime.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";
import {
  GEMINI_CLI_PROVIDER_ID,
  geminiCliProvider,
  geminiCliProviderDescriptor
} from "./config.js";

export interface GeminiCliRuntimeOptions {
  readonly config?: AgentTeamConfig;
  readonly runCommand?: ProviderCommandRunner;
}

export { geminiCliProvider };

const execFileAsync = promisify(execFile);

function fail(message: string, details: Partial<ProviderPrintResult> = {}): ProviderPrintResult {
  return {
    ok: false,
    text: details.text ?? "",
    stdout: details.stdout ?? "",
    stderr: message,
    exitCode: details.exitCode ?? 1
  };
}

function resolveConfig(
  inputConfig: AgentTeamConfig | undefined,
  runtimeConfig: AgentTeamConfig | undefined
): AgentTeamConfig {
  return inputConfig ?? runtimeConfig ?? DEFAULT_AGENT_TEAM_CONFIG;
}

const defaultRunCommand: ProviderCommandRunner = async (path, args, options = {}) => {
  try {
    const { stdout, stderr } = await execFileAsync(path, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      encoding: "utf8"
    });
    return {
      ok: true,
      stdout: String(stdout),
      stderr: String(stderr),
      exitCode: 0
    };
  } catch (error) {
    const commandError = error as {
      readonly stdout?: unknown;
      readonly stderr?: unknown;
      readonly code?: unknown;
      readonly message?: string;
    };
    return {
      ok: false,
      stdout: commandError.stdout === undefined ? "" : String(commandError.stdout),
      stderr:
        commandError.stderr === undefined || String(commandError.stderr).trim().length === 0
          ? String(commandError.message ?? "Gemini CLI command failed.")
          : String(commandError.stderr),
      exitCode: typeof commandError.code === "number" ? commandError.code : 1
    };
  }
};

function unsupportedSessionHandle(_input: ProviderStartSessionInput): ProviderSessionHandle {
  const warning =
    "Gemini CLI adapter does not support background sessions, resume, live stdin, cancellation, or edits.";
  const activity: ProviderSessionActivity = {
    type: "error",
    summary: warning,
    timestamp: Date.now()
  };
  let closed = false;
  const snapshot = (): ProviderSessionSnapshot => ({
    providerSessionId: undefined,
    text: "",
    warnings: closed ? [warning, "Gemini CLI unsupported session handle was closed."] : [warning],
    recentActivities: [activity],
    currentActivity: null,
    pendingOutboxRequests: [],
    lastStderr: [warning],
    transcriptPath: undefined,
    logPath: undefined
  });

  return {
    providerSessionId: undefined,
    done: Promise.resolve("failed"),
    recentActivities: [activity],
    currentActivity: null,
    lastStderr: [warning],
    transcriptPath: undefined,
    logPath: undefined,
    supportsStdin: false,
    kill() {
      closed = true;
    },
    forceKill() {
      closed = true;
    },
    snapshot
  };
}

export function createGeminiCliRuntime(
  options: GeminiCliRuntimeOptions = {}
): AgentProviderRuntime {
  const runCommand = options.runCommand ?? defaultRunCommand;

  return {
    id: GEMINI_CLI_PROVIDER_ID,
    descriptor(config?: AgentTeamConfig): AgentProviderDescriptor {
      return geminiCliProviderDescriptor(resolveConfig(config, options.config));
    },
    inspectEnvironment(
      _input: ProviderEnvironmentInspectionInput
    ): ProviderEnvironmentInspection {
      return { warnings: [] };
    },
    async runPrint(input: ProviderPrintInput): Promise<ProviderPrintResult> {
      const config = resolveConfig(input.config, options.config);
      const provider =
        config.providers.geminiCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli;
      if (!provider.enabled) {
        return fail("Gemini CLI provider is disabled.");
      }
      if (!provider.capabilities.structuredOutput) {
        return fail("Gemini CLI provider requires structuredOutput capability for dispatch.");
      }
      if (provider.executable.trim().length === 0) {
        return fail("Gemini CLI provider requires executable.");
      }
      if (provider.model === undefined) {
        return fail("Gemini CLI provider requires model.");
      }

      const result = await runCommand(
        provider.executable,
        [
          "--prompt",
          input.prompt,
          "--model",
          provider.model,
          "--output-format",
          "text"
        ],
        {
          cwd: input.cwd,
          ...(input.env === undefined ? {} : { env: input.env }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
        }
      );
      if (!result.ok) {
        const stderr = result.stderr.trim() || "Gemini CLI exited without stderr.";
        return fail(`Gemini CLI request failed: ${stderr}`, {
          stdout: result.stdout,
          exitCode: result.exitCode ?? 1
        });
      }

      return {
        ok: true,
        text: result.stdout.trim(),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0
      };
    },
    startSession(input: ProviderStartSessionInput): ProviderSessionHandle {
      return unsupportedSessionHandle(input);
    },
    async healthCheck(input: ProviderHealthCheckInput): Promise<readonly ProviderHealthCheck[]> {
      const config = resolveConfig(input.config, options.config);
      const provider =
        config.providers.geminiCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli;
      const checks: ProviderHealthCheck[] = [
        {
          id: "gemini-cli-config",
          status: provider.enabled && provider.model !== undefined ? "pass" : "fail",
          message:
            provider.enabled && provider.model !== undefined
              ? "Gemini CLI provider config is explicit."
              : "Gemini CLI provider config is incomplete.",
          details: {
            providerId: GEMINI_CLI_PROVIDER_ID,
            hasModel: provider.model !== undefined,
            executable: provider.executable,
            projectEnv: provider.projectEnv
          }
        }
      ];
      const executablePath = await input.findExecutable(provider.executable);
      checks.push(
        executablePath === undefined
          ? {
              id: "gemini-cli-executable",
              status: "fail",
              message: "Gemini CLI executable was not found on PATH.",
              details: {
                executable: provider.executable,
                fix: "Install Gemini CLI and complete Google sign-in/OAuth before enabling this provider."
              }
            }
          : {
              id: "gemini-cli-executable",
              status: "pass",
              message: "Gemini CLI executable found.",
              details: {
                path: executablePath,
                version: await input.getVersion(executablePath)
              }
            }
      );
      const projectValue = input.env[provider.projectEnv]?.trim();
      checks.push({
        id: "gemini-cli-project-env",
        status: projectValue === undefined || projectValue.length === 0 ? "warn" : "pass",
        message:
          projectValue === undefined || projectValue.length === 0
            ? `Gemini CLI project env ${provider.projectEnv} is not set; this can be required for Workspace or Code Assist accounts.`
            : "Gemini CLI project env is present.",
        details: {
          env: provider.projectEnv,
          present: projectValue !== undefined && projectValue.length > 0
        }
      });
      return checks;
    }
  };
}

export const geminiCliRuntime = createGeminiCliRuntime();
