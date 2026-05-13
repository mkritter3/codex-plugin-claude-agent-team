import { execFile } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import { appendBoundedLog } from "../../core/logs.js";
import { runLogPath } from "../../core/state/paths.js";
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
  ProviderSessionDoneStatus,
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
  readonly spawn?: SpawnLike;
  readonly now?: () => number;
  readonly maxStderrLines?: number;
  readonly maxActivities?: number;
  readonly maxLogBytes?: number;
  readonly maxRotatedLogFiles?: number;
}

export { geminiCliProvider };

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_LOG_BYTES = 1_048_576;
const DEFAULT_MAX_ROTATED_LOG_FILES = 5;

interface SpawnOptions {
  readonly cwd: string;
  readonly stdio: ["ignore", "pipe", "pipe"];
  readonly env?: NodeJS.ProcessEnv;
  readonly windowsHide: boolean;
}

interface SpawnedGeminiProcess {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly stdin?: Writable | null;
  readonly killed?: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => SpawnedGeminiProcess;

const defaultSpawn: SpawnLike = (command, args, options) =>
  nodeSpawn(command, [...args], {
    ...options,
    stdio: [...options.stdio]
  }) as SpawnedGeminiProcess;

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

function pushBounded<T>(items: T[], item: T, max: number): void {
  items.push(item);
  while (items.length > max) {
    items.shift();
  }
}

function approvalModeFor(input: ProviderStartSessionInput): "auto_edit" | "plan" {
  return input.executionPolicy === "isolated-edit" ? "auto_edit" : "plan";
}

function assertStartable(provider: AgentTeamConfig["providers"]["geminiCli"], input: ProviderStartSessionInput): void {
  if (!provider.enabled) {
    throw new Error("Gemini CLI provider is disabled.");
  }
  if (provider.executable.trim().length === 0) {
    throw new Error("Gemini CLI provider requires executable.");
  }
  if (provider.model === undefined) {
    throw new Error("Gemini CLI provider requires model.");
  }
  if (input.executionPolicy === "isolated-edit") {
    const missing: string[] = [];
    if (!provider.writeValidated) {
      missing.push("writeValidated");
    }
    if (!provider.capabilities.tools) {
      missing.push("tools");
    }
    if (!provider.capabilities.edits) {
      missing.push("edits");
    }
    if (!provider.capabilities.sessionResume) {
      missing.push("sessionResume");
    }
    if (!provider.capabilities.cancellation) {
      missing.push("cancellation");
    }
    if (!provider.capabilities.workspaceIsolation) {
      missing.push("workspaceIsolation");
    }
    if (missing.length > 0) {
      throw new Error(`Gemini CLI isolated edit requires ${missing.join(", ")}.`);
    }
  }
}

function buildGeminiSessionArgs(input: {
  readonly prompt: string;
  readonly model: string;
  readonly sessionId: string;
  readonly approvalMode: "auto_edit" | "plan";
}): readonly string[] {
  return [
    "--prompt",
    input.prompt,
    "--model",
    input.model,
    "--output-format",
    "text",
    "--session-id",
    input.sessionId,
    "--approval-mode",
    input.approvalMode
  ];
}

export function createGeminiCliRuntime(
  options: GeminiCliRuntimeOptions = {}
): AgentProviderRuntime {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const spawn = options.spawn ?? defaultSpawn;
  const now = options.now ?? Date.now;

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
      const config = resolveConfig(input.config, options.config);
      const provider =
        config.providers.geminiCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.geminiCli;
      assertStartable(provider, input);

      const args = buildGeminiSessionArgs({
        prompt: input.prompt,
        model: provider.model!,
        sessionId: input.sessionId ?? input.runId,
        approvalMode: approvalModeFor(input)
      });
      const logPath = runLogPath(input.workspaceRoot, input.runId);
      const textChunks: string[] = [];
      const recentActivities: ProviderSessionActivity[] = [];
      const lastStderr: string[] = [];
      const writes: Array<Promise<void>> = [];
      let writeQueue: Promise<void> = Promise.resolve();
      let currentActivity: ProviderSessionActivity | null = null;
      let timedOut = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      function write(text: string): void {
        const nextWrite = writeQueue.then(() =>
          appendBoundedLog(logPath, text, {
            maxBytes: options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES,
            maxRotatedFiles: options.maxRotatedLogFiles ?? DEFAULT_MAX_ROTATED_LOG_FILES
          })
        );
        writeQueue = nextWrite.catch(() => undefined);
        writes.push(nextWrite);
      }

      function activity(type: ProviderSessionActivity["type"], summary: string): void {
        const item = { type, summary, timestamp: now() };
        currentActivity = type === "result" || type === "error" ? null : item;
        pushBounded(recentActivities, item, options.maxActivities ?? 20);
      }

      const child = spawn(provider.executable, args, {
        cwd: input.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        ...(input.env === undefined ? {} : { env: input.env }),
        windowsHide: true
      });
      activity("tool_start", "Gemini CLI session started.");

      function clearTimeoutBudget(): void {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
      }

      if (input.timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          write(`Gemini CLI session timed out after ${input.timeoutMs}ms.\n`);
          child.kill(process.platform === "win32" ? undefined : "SIGTERM");
          child.kill(process.platform === "win32" ? undefined : "SIGKILL");
        }, input.timeoutMs);
        timeoutHandle.unref?.();
      }

      if (child.stdout !== null) {
        const stdout = createInterface({ input: child.stdout });
        stdout.on("line", (line) => {
          textChunks.push(line);
          write(`${line}\n`);
          activity("text", line);
        });
      }

      if (child.stderr !== null) {
        const stderr = createInterface({ input: child.stderr });
        stderr.on("line", (line) => {
          pushBounded(lastStderr, line, options.maxStderrLines ?? 10);
          write(`${line}\n`);
          activity("error", line);
        });
      }

      const done = new Promise<ProviderSessionDoneStatus>((resolve) => {
        child.on("close", (code, signal) => {
          clearTimeoutBudget();
          void Promise.allSettled(writes).then(() => {
            if (timedOut) {
              activity("error", "Gemini CLI session expired.");
              resolve("expired");
              return;
            }
            if (signal === "SIGTERM" || signal === "SIGINT") {
              activity("error", "Gemini CLI session was interrupted.");
              resolve("interrupted");
              return;
            }
            const completed = code === 0;
            activity(completed ? "result" : "error", completed ? "Gemini CLI session completed." : "Gemini CLI session failed.");
            resolve(completed ? "completed" : "failed");
          });
        });
        child.on("error", (error) => {
          clearTimeoutBudget();
          pushBounded(lastStderr, error.message, options.maxStderrLines ?? 10);
          write(`${error.message}\n`);
          void Promise.allSettled(writes).then(() => resolve(timedOut ? "expired" : "failed"));
        });
      });

      const snapshot = (): ProviderSessionSnapshot => ({
        providerSessionId: input.sessionId ?? input.runId,
        text: textChunks.join("\n").trim(),
        warnings: [],
        recentActivities: [...recentActivities],
        currentActivity,
        pendingOutboxRequests: [],
        lastStderr: [...lastStderr],
        transcriptPath: undefined,
        logPath
      });

      return {
        providerSessionId: input.sessionId ?? input.runId,
        done,
        get recentActivities() {
          return snapshot().recentActivities;
        },
        get currentActivity() {
          return snapshot().currentActivity;
        },
        get lastStderr() {
          return snapshot().lastStderr;
        },
        transcriptPath: undefined,
        logPath,
        supportsStdin: false,
        kill() {
          child.kill(process.platform === "win32" ? undefined : "SIGTERM");
        },
        forceKill() {
          child.kill(process.platform === "win32" ? undefined : "SIGKILL");
        },
        snapshot
      };
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
