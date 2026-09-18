import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { appendBoundedLog } from "../../core/logs.js";
import { runLogPath } from "../../core/state/paths.js";
import type { AgentProviderDescriptor, AgentTeamConfig } from "../../core/types.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "../../core/config.js";
import type { AgentProviderRuntime } from "../runtime.js";
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
import {
  CODEX_CLI_PROVIDER_ID,
  codexCliProvider,
  codexCliProviderDescriptor
} from "./config.js";

export interface CodexCliRuntimeOptions {
  readonly config?: AgentTeamConfig;
  readonly runCommand?: ProviderCommandRunner;
  readonly spawn?: SpawnLike;
  readonly now?: () => number;
  readonly maxStderrLines?: number;
  readonly maxActivities?: number;
  readonly maxLogBytes?: number;
  readonly maxRotatedLogFiles?: number;
}

export { codexCliProvider };

const DEFAULT_MAX_LOG_BYTES = 1_048_576;
const DEFAULT_MAX_ROTATED_LOG_FILES = 5;

interface SpawnOptions {
  readonly cwd: string;
  readonly stdio: ["ignore", "pipe", "pipe"];
  readonly env?: NodeJS.ProcessEnv;
  readonly windowsHide: boolean;
}

interface SpawnedCodexProcess {
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
) => SpawnedCodexProcess;

const defaultSpawn: SpawnLike = (command, args, options) =>
  nodeSpawn(command, [...args], {
    ...options,
    stdio: [...options.stdio]
  }) as SpawnedCodexProcess;

const defaultRunCommand: ProviderCommandRunner = (path, args, options = {}) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = nodeSpawn(path, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const finish = (result: { readonly exitCode: number | null; readonly error?: Error }): void => {
      if (settled) {
        return;
      }
      settled = true;
      const exitCode = result.exitCode ?? 1;
      resolve({
        ok: result.error === undefined && exitCode === 0,
        stdout,
        stderr:
          stderr.trim().length === 0 && result.error !== undefined
            ? result.error.message
            : stderr,
        exitCode
      });
    };

    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill("SIGTERM");
            finish({
              exitCode: 1,
              error: new Error(`Codex CLI command timed out after ${options.timeoutMs}ms.`)
            });
          }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", (error) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      finish({ exitCode: 1, error });
    });
    child.on("close", (code) => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      finish({ exitCode: code });
    });
  });

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

function pushBounded<T>(items: T[], item: T, max: number): void {
  items.push(item);
  while (items.length > max) {
    items.shift();
  }
}

function sandboxFor(input: { readonly executionPolicy?: string }): "read-only" | "workspace-write" {
  return input.executionPolicy === "isolated-edit" ? "workspace-write" : "read-only";
}

function buildCodexExecArgs(input: {
  readonly prompt: string;
  readonly cwd: string;
  readonly model?: string;
  readonly sandbox: "read-only" | "workspace-write";
}): readonly string[] {
  return [
    "exec",
    ...(input.model === undefined ? [] : ["--model", input.model]),
    "--cd",
    input.cwd,
    "--sandbox",
    input.sandbox,
    input.prompt
  ];
}

const CODEX_API_KEY_ENV_VARS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT"
] as const;

function codexSubscriptionEnv(input: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env = { ...(input ?? process.env) };
  for (const key of CODEX_API_KEY_ENV_VARS) {
    delete env[key];
  }
  return env;
}

function assertStartable(provider: AgentTeamConfig["providers"]["codexCli"], input: ProviderStartSessionInput): void {
  if (!provider.enabled) {
    throw new Error("Codex CLI provider is disabled.");
  }
  if (provider.executable.trim().length === 0) {
    throw new Error("Codex CLI provider requires executable.");
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
      throw new Error(`Codex CLI isolated edit requires ${missing.join(", ")}.`);
    }
  }
}

export function createCodexCliRuntime(
  options: CodexCliRuntimeOptions = {}
): AgentProviderRuntime {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const spawn = options.spawn ?? defaultSpawn;
  const now = options.now ?? Date.now;

  return {
    id: CODEX_CLI_PROVIDER_ID,
    descriptor(config?: AgentTeamConfig): AgentProviderDescriptor {
      return codexCliProviderDescriptor(resolveConfig(config, options.config));
    },
    inspectEnvironment(
      _input: ProviderEnvironmentInspectionInput
    ): ProviderEnvironmentInspection {
      return { warnings: [] };
    },
    async runPrint(input: ProviderPrintInput): Promise<ProviderPrintResult> {
      const config = resolveConfig(input.config, options.config);
      const provider =
        config.providers.codexCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli;
      if (!provider.enabled) {
        return fail("Codex CLI provider is disabled.");
      }
      if (!provider.capabilities.structuredOutput) {
        return fail("Codex CLI provider requires structuredOutput capability for dispatch.");
      }
      if (provider.executable.trim().length === 0) {
        return fail("Codex CLI provider requires executable.");
      }

      const result = await runCommand(
        provider.executable,
        buildCodexExecArgs({
          prompt: input.prompt,
          cwd: input.cwd,
          ...(provider.model === undefined ? {} : { model: provider.model }),
          sandbox: sandboxFor(input)
        }),
        {
          cwd: input.cwd,
          env: codexSubscriptionEnv(input.env),
          ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs })
        }
      );
      if (!result.ok) {
        const stderr = result.stderr.trim() || "Codex CLI exited without stderr.";
        return fail(`Codex CLI request failed: ${stderr}`, {
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
        config.providers.codexCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli;
      assertStartable(provider, input);

      const args = buildCodexExecArgs({
        prompt: input.prompt,
        cwd: input.cwd,
        ...(provider.model === undefined ? {} : { model: provider.model }),
        sandbox: sandboxFor(input)
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
        env: codexSubscriptionEnv(input.env),
        windowsHide: true
      });
      activity("tool_start", "Codex CLI session started.");

      function clearTimeoutBudget(): void {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
      }

      if (input.timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          write(`Codex CLI session timed out after ${input.timeoutMs}ms.\n`);
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
              activity("error", "Codex CLI session expired.");
              resolve("expired");
              return;
            }
            if (signal === "SIGTERM" || signal === "SIGINT") {
              activity("error", "Codex CLI session was interrupted.");
              resolve("interrupted");
              return;
            }
            const completed = code === 0;
            activity(completed ? "result" : "error", completed ? "Codex CLI session completed." : "Codex CLI session failed.");
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
        config.providers.codexCli ?? DEFAULT_AGENT_TEAM_CONFIG.providers.codexCli;
      const checks: ProviderHealthCheck[] = [
        {
          id: "codex-cli-config",
          status: provider.enabled ? "pass" : "fail",
          message:
            provider.enabled
              ? "Codex CLI provider config is enabled."
              : "Codex CLI provider config is incomplete.",
          details: {
            providerId: CODEX_CLI_PROVIDER_ID,
            hasModel: provider.model !== undefined,
            executable: provider.executable
          }
        }
      ];
      const executablePath = await input.findExecutable(provider.executable);
      checks.push(
        executablePath === undefined
          ? {
              id: "codex-cli-executable",
              status: "fail",
              message: "Codex CLI executable was not found on PATH.",
              details: {
                executable: provider.executable,
                fix: "Install Codex CLI and complete login before enabling this provider."
              }
            }
          : {
              id: "codex-cli-executable",
              status: "pass",
              message: "Codex CLI executable found.",
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

export const codexCliRuntime = createCodexCliRuntime();
