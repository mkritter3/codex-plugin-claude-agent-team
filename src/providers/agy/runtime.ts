import { execFile } from "node:child_process";
import { buildAgyArgs, decodeAgyResult, parseAgyResult, isAgyExecutable } from "./agy.js";
import { spawn as nodeSpawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
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
  readonly maxOutputBytes?: number;
}

export { agyProvider };

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_LOG_BYTES = 1_048_576;
const DEFAULT_MAX_ROTATED_LOG_FILES = 5;
const DEFAULT_MAX_OUTPUT_BYTES = 262_144;

interface SpawnOptions {
  readonly cwd: string;
  readonly stdio: ["ignore", "pipe", "pipe"];
  readonly env?: NodeJS.ProcessEnv;
  readonly windowsHide: boolean;
}

interface SpawnedAgyProcess {
  readonly pid?: number;
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
    exitCode: details.exitCode ?? 1,
    ...(details.sessionId === undefined ? {} : { sessionId: details.sessionId }),
    ...(details.failureEvidence === undefined ? {} : { failureEvidence: details.failureEvidence })
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
      if (Buffer.byteLength(result.stdout, "utf8") > (options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)) {
        return fail("AGY output exceeded the configured safety limit.", {
          stdout: result.stdout.slice(0, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES),
          exitCode: result.exitCode ?? 1,
          failureEvidence: { reason: "output_too_large" }
        });
      }
      if (!result.ok) {
        const stderr = result.stderr.trim() || "AGY exited without stderr.";
        const decoded = decodeAgyResult(result.stdout);
        return fail(`AGY request failed: ${stderr}`, {
          stdout: result.stdout,
          exitCode: result.exitCode ?? 1,
          ...(decoded?.conversationId === undefined ? {} : { sessionId: decoded.conversationId }),
          failureEvidence: decoded?.failureEvidence ?? { reason: "process_failed" }
        });
      }

      try {
        const decoded = decodeAgyResult(result.stdout);
        if (decoded?.failureEvidence !== undefined || decoded?.text === undefined) {
          return fail("AGY did not complete successfully.", {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode ?? 1,
            ...(decoded?.conversationId === undefined ? {} : { sessionId: decoded.conversationId }),
            failureEvidence: decoded?.failureEvidence ?? { reason: "invalid_json" }
          });
        }
        return {
          ok: true,
          text: decoded.text,
          ...(decoded.conversationId === undefined ? {} : { sessionId: decoded.conversationId }),
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
      let outputBytes = 0;
      let outputTooLarge = false;
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let providerSessionId = input.sessionId;
      let agyText: string | undefined;
      let failureEvidence: ProviderSessionSnapshot["failureEvidence"];
      const recentActivities: ProviderSessionActivity[] = [];
      const lastStderr: string[] = [];
      let writeQueue: Promise<void> = Promise.resolve();
      let diagnosticsStopped = false;
      let currentActivity: ProviderSessionActivity | null = null;
      let timedOut = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      function write(text: string): void {
        if (diagnosticsStopped) return;
        const nextWrite = writeQueue.then(() =>
          appendBoundedLog(logPath, text, {
            maxBytes: options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES,
            maxRotatedFiles: options.maxRotatedLogFiles ?? DEFAULT_MAX_ROTATED_LOG_FILES
          })
        );
        writeQueue = nextWrite.catch(() => undefined);
      }

      function stopDiagnosticsForOversizedOutput(): void {
        if (diagnosticsStopped) return;
        write("AGY output exceeded the bounded parser limit; diagnostics stopped.\n");
        diagnosticsStopped = true;
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
        child.stdout.on("data", (chunk: Buffer | string) => {
          const text = stdoutDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const nextBytes = Buffer.byteLength(text, "utf8");
          if (outputBytes + nextBytes > (options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)) {
            outputTooLarge = true;
            stopDiagnosticsForOversizedOutput();
          }
          else { textChunks.push(text); outputBytes += nextBytes; }
          write(text.slice(0, 4_000));
          activity("text", text.slice(0, 1_000));
        });
      }

      if (child.stderr !== null) {
        child.stderr.on("data", (chunk: Buffer | string) => {
          const text = stderrDecoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).trim().slice(0, 1_000);
          pushBounded(lastStderr, text, options.maxStderrLines ?? 10);
          write(text);
          activity("error", text);
        });
      }

      const done = new Promise<ProviderSessionDoneStatus>((resolve) => {
        child.on("close", (code, signal) => {
          clearTimeoutBudget();
          const finalStdout = stdoutDecoder.end();
          if (finalStdout.length > 0) {
            const bytes = Buffer.byteLength(finalStdout, "utf8");
          if (outputBytes + bytes > (options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)) {
            outputTooLarge = true;
            stopDiagnosticsForOversizedOutput();
          }
            else { textChunks.push(finalStdout); outputBytes += bytes; }
          }
          const finalStderr = stderrDecoder.end().trim().slice(0, 1_000);
          if (finalStderr.length > 0) pushBounded(lastStderr, finalStderr, options.maxStderrLines ?? 10);
          void writeQueue.then(() => {
            const decoded = outputTooLarge ? undefined : decodeAgyResult(textChunks.join(""));
            if (decoded?.conversationId !== undefined) {
              if (input.sessionId !== undefined && decoded.conversationId !== input.sessionId) {
                failureEvidence = { reason: "session_id_conflict", details: ["AGY returned a different conversation id while resuming."] };
              } else {
                providerSessionId = decoded.conversationId;
              }
            }
            if (failureEvidence === undefined && decoded?.failureEvidence !== undefined) failureEvidence = decoded.failureEvidence;
            if (outputTooLarge) failureEvidence = { reason: "output_too_large" };
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
            if (!completed && failureEvidence === undefined) failureEvidence = { reason: "process_failed" };
            if (completed && decoded === undefined && failureEvidence === undefined) {
              failureEvidence = { reason: "invalid_json" };
            }
            if (completed && failureEvidence === undefined) {
              try {
                const result = parseAgyResult(textChunks.join(""));
                agyText = result.text;
              } catch (error) {
                completed = false;
                agyText = "";
                pushBounded(lastStderr, String(error), options.maxStderrLines ?? 10);
              }
            }
            if (failureEvidence !== undefined) completed = false;
            activity(completed ? "result" : "error", completed ? "AGY session completed." : "AGY session failed.");
            resolve(completed ? "completed" : "failed");
          });
        });
        child.on("error", (error) => {
          clearTimeoutBudget();
          pushBounded(lastStderr, error.message, options.maxStderrLines ?? 10);
          failureEvidence = failureEvidence ?? { reason: "process_failed", details: [error.message.slice(0, 400)] };
          write(`${error.message}\n`);
          // An error from a live child (for example, a signal delivery error)
          // is not termination. Hold lifecycle ownership until close confirms
          // it stopped; only a proven spawn failure has no pid to wait for.
          if (child.pid === undefined) void writeQueue.then(() => resolve(timedOut ? "expired" : "failed"));
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
        logPath,
        ...(child.pid === undefined ? {} : { providerProcessId: child.pid }),
        ...(child.pid === undefined ? {} : { providerProcessStartIdentity: "unknown" }),
        ...(failureEvidence === undefined ? {} : { failureEvidence })
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
        ...(child.pid === undefined ? {} : { providerProcessId: child.pid }),
        ...(child.pid === undefined ? {} : { providerProcessStartIdentity: "unknown" }),
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
