import { execFile } from "node:child_process";
import { buildAgyArgs, parseAgyResult, isAgyExecutable } from "./agy.js";
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
  AGY_PROVIDER_ID,
  agyProvider,
  agyProviderDescriptor
} from "./config.js";

export interface AgyRuntimeOptions {
  readonly config?: AgentTeamConfig;
  readonly runCommand?: ProviderCommandRunner;
  readonly spawn?: SpawnLike;
  readonly now?: () => number;
  readonly maxStderrLines?: number;
  readonly maxActivities?: number;
  readonly maxLogBytes?: number;
  readonly maxRotatedLogFiles?: number;
}

export { agyProvider };

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_LOG_BYTES = 1_048_576;
const DEFAULT_MAX_ROTATED_LOG_FILES = 5;

interface SpawnOptions {
  readonly cwd: string;
  readonly stdio: ["ignore", "pipe", "pipe"];
  readonly env?: NodeJS.ProcessEnv;
  readonly windowsHide: boolean;
}

interface SpawnedAgyProcess {
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
) => SpawnedAgyProcess;

const defaultSpawn: SpawnLike = (command, args, options) =>
  nodeSpawn(command, [...args], {
    ...options,
    stdio: [...options.stdio]
  }) as SpawnedAgyProcess;

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
          ? String(commandError.message ?? "AGY command failed.")
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

function assertStartable(provider: AgentTeamConfig["providers"]["agy"], input: ProviderStartSessionInput): void {
  if (!provider.enabled) {
    throw new Error("AGY provider is disabled.");
  }
  if (!isAgyExecutable(provider.executable)) {
    throw new Error("AGY provider requires an AGY executable.");
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
      throw new Error(`AGY isolated edit requires ${missing.join(", ")}.`);
    }
  }
}

export function createAgyRuntime(
  options: AgyRuntimeOptions = {}
): AgentProviderRuntime {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const spawn = options.spawn ?? defaultSpawn;
  const now = options.now ?? Date.now;

  return {
    id: AGY_PROVIDER_ID,
    descriptor(config?: AgentTeamConfig): AgentProviderDescriptor {
      return agyProviderDescriptor(resolveConfig(config, options.config));
    },
    inspectEnvironment(
      _input: ProviderEnvironmentInspectionInput
    ): ProviderEnvironmentInspection {
      return { warnings: [] };
    },
    async runPrint(input: ProviderPrintInput): Promise<ProviderPrintResult> {
      const config = resolveConfig(input.config, options.config);
      const provider =
        config.providers.agy ?? DEFAULT_AGENT_TEAM_CONFIG.providers.agy;
      if (!provider.enabled) {
        return fail("AGY provider is disabled.");
      }
      if (!provider.capabilities.structuredOutput) {
        return fail("AGY provider requires structuredOutput capability for dispatch.");
      }
      if (!isAgyExecutable(provider.executable)) {
        return fail("AGY provider requires an AGY executable.");
      }
      const result = await runCommand(
        provider.executable,
        buildAgyArgs({ prompt: input.prompt, ...(provider.model === undefined ? {} : { model: provider.model }), write: false }),
        {
          cwd: input.cwd,
          ...(input.env === undefined ? {} : { env: input.env }),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
        }
      );
      if (!result.ok) {
        const stderr = result.stderr.trim() || "AGY exited without stderr.";
        return fail(`AGY request failed: ${stderr}`, {
          stdout: result.stdout,
          exitCode: result.exitCode ?? 1
        });
      }

      try {
        const parsed = parseAgyResult(result.stdout);
        return {
          ok: true,
          text: parsed.text,
          ...(parsed.conversationId === undefined ? {} : { sessionId: parsed.conversationId }),
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode ?? 0
        };
      } catch (error) {
        return fail(String(error), { stdout: result.stdout });
      }
    },
    startSession(input: ProviderStartSessionInput): ProviderSessionHandle {
      const config = resolveConfig(input.config, options.config);
      const provider =
        config.providers.agy ?? DEFAULT_AGENT_TEAM_CONFIG.providers.agy;
      assertStartable(provider, input);

      const args = buildAgyArgs({
        prompt: input.prompt,
        ...(provider.model === undefined ? {} : { model: provider.model }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        write: input.executionPolicy === "isolated-edit"
      });
      const logPath = runLogPath(input.workspaceRoot, input.runId);
      const textChunks: string[] = [];
      let providerSessionId = input.sessionId;
      let agyText: string | undefined;
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
      activity("tool_start", "AGY session started.");

      function clearTimeoutBudget(): void {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
      }

      if (input.timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          write(`AGY session timed out after ${input.timeoutMs}ms.\n`);
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
              activity("error", "AGY session expired.");
              resolve("expired");
              return;
            }
            if (signal === "SIGTERM" || signal === "SIGINT") {
              activity("error", "AGY session was interrupted.");
              resolve("interrupted");
              return;
            }
            let completed = code === 0;
            if (completed) {
              try {
                const result = parseAgyResult(textChunks.join("\n"));
                agyText = result.text;
                providerSessionId = result.conversationId ?? providerSessionId;
              } catch (error) {
                completed = false;
                agyText = "";
                pushBounded(lastStderr, String(error), options.maxStderrLines ?? 10);
              }
            }
            activity(completed ? "result" : "error", completed ? "AGY session completed." : "AGY session failed.");
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
        providerSessionId,
        text: agyText ?? "",
        warnings: [],
        recentActivities: [...recentActivities],
        currentActivity,
        pendingOutboxRequests: [],
        lastStderr: [...lastStderr],
        transcriptPath: undefined,
        logPath
      });

      return {
        get providerSessionId() { return providerSessionId; },
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
        config.providers.agy ?? DEFAULT_AGENT_TEAM_CONFIG.providers.agy;
      const checks: ProviderHealthCheck[] = [
        {
          id: "agy-config",
          status: provider.enabled ? "pass" : "fail",
          message:
            provider.enabled
              ? "AGY provider config is enabled."
              : "AGY provider config is incomplete.",
          details: {
            providerId: AGY_PROVIDER_ID,
            hasModel: provider.model !== undefined,
            executable: provider.executable
          }
        }
      ];
      const executablePath = await input.findExecutable(provider.executable);
      checks.push(
        executablePath === undefined
          ? {
              id: "agy-executable",
              status: "fail",
              message: "AGY executable was not found on PATH.",
              details: {
                executable: provider.executable,
                fix: "Install AGY and complete Google sign-in/OAuth before enabling this provider."
              }
            }
          : {
              id: "agy-executable",
              status: "pass",
              message: "AGY executable found.",
              details: {
                path: executablePath,
                version: await input.getVersion(executablePath)
              }
            }
      );
      return checks;
    }
  };
}

export const agyRuntime = createAgyRuntime();
