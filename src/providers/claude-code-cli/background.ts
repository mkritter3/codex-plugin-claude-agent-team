import { spawn as nodeSpawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { runLogPath } from "../../core/state/paths.js";
import type {
  ProviderSessionDoneStatus,
  ProviderSessionHandle,
  ProviderSessionSnapshot
} from "../types.js";
import { buildClaudeCommand } from "./commands.js";
import { inspectClaudeEnvironment } from "./doctor.js";
import { createClaudeStreamParser } from "./stream-parser.js";

export class ClaudeBackgroundSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeBackgroundSessionError";
  }
}

export interface StartClaudeBackgroundSessionInput {
  readonly prompt: string;
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionId?: string;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly stdio: ["pipe", "pipe", "pipe"];
  readonly env?: NodeJS.ProcessEnv;
  readonly windowsHide: boolean;
}

export interface SpawnedClaudeProcess {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly stdin: Writable | null;
  readonly pid?: number;
  readonly killed?: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => SpawnedClaudeProcess;

export interface StartClaudeBackgroundSessionDependencies {
  readonly spawn?: SpawnLike;
  readonly now?: () => number;
  readonly maxActivities?: number;
  readonly maxStderrLines?: number;
}

const defaultSpawn: SpawnLike = (command, args, options) =>
  nodeSpawn(command, [...args], {
    ...options,
    stdio: [...options.stdio]
  }) as SpawnedClaudeProcess;

function transcriptPath(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, ".agent-team", "logs", `${runId}.stream.jsonl`);
}

function pushBounded(lines: string[], line: string, max: number): void {
  lines.push(line);
  while (lines.length > max) {
    lines.shift();
  }
}

export function startClaudeBackgroundSession(
  input: StartClaudeBackgroundSessionInput,
  deps: StartClaudeBackgroundSessionDependencies = {}
): ProviderSessionHandle {
  const env = input.env ?? process.env;
  const inspection = inspectClaudeEnvironment({
    authMode: "subscription-oauth",
    env
  });
  if (inspection.warnings.length > 0) {
    throw new ClaudeBackgroundSessionError(inspection.warnings.join("\n"));
  }

  const command = buildClaudeCommand({
    prompt: input.prompt,
    cwd: input.cwd,
    outputFormat: "stream-json",
    inputFormat: "stream-json",
    permissionMode: "default",
    excludeDynamicSystemPromptSections: true,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId })
  });
  const spawnImpl = deps.spawn ?? defaultSpawn;
  const logPath = runLogPath(input.workspaceRoot, input.runId);
  const rawTranscriptPath = transcriptPath(input.workspaceRoot, input.runId);
  const parser = createClaudeStreamParser({
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.maxActivities === undefined ? {} : { maxActivities: deps.maxActivities })
  });
  const lastStderr: string[] = [];
  const writes: Array<Promise<void>> = [];
  let sigkillSent = false;

  const child = spawnImpl(command.command, command.args, {
    cwd: command.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env,
    windowsHide: true
  });

  function write(path: string, text: string): void {
    writes.push(
      mkdir(dirname(path), { recursive: true }).then(() => appendFile(path, text, "utf8"))
    );
  }

  if (child.stdout !== null) {
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      write(rawTranscriptPath, `${line}\n`);
      write(logPath, `${line}\n`);
      parser.acceptLine(line);
    });
  }

  if (child.stderr !== null) {
    const stderr = createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      pushBounded(lastStderr, line, deps.maxStderrLines ?? 10);
      write(logPath, `${line}\n`);
    });
  }

  const done = new Promise<ProviderSessionDoneStatus>((resolve) => {
    child.on("close", (code, signal) => {
      void Promise.allSettled(writes).then(() => {
        if (signal === "SIGTERM" || signal === "SIGINT") {
          resolve("interrupted");
          return;
        }
        resolve(code === 0 ? "completed" : "failed");
      });
    });
    child.on("error", (error) => {
      write(logPath, `${error.message}\n`);
      void Promise.allSettled(writes).then(() => resolve("failed"));
    });
  });

  const handle: ProviderSessionHandle = {
    done,
    get providerSessionId() {
      return parser.snapshot().providerSessionId;
    },
    get recentActivities() {
      return parser.snapshot().recentActivities;
    },
    get currentActivity() {
      return parser.snapshot().currentActivity;
    },
    get lastStderr() {
      return [...lastStderr];
    },
    transcriptPath: rawTranscriptPath,
    logPath,
    kill(): void {
      if (child.killed !== true) {
        child.kill(process.platform === "win32" ? undefined : "SIGTERM");
      }
    },
    forceKill(): void {
      if (!sigkillSent) {
        sigkillSent = true;
        child.kill(process.platform === "win32" ? undefined : "SIGKILL");
      }
    },
    writeStdin(data: string): void {
      if (child.stdin !== null && !child.stdin.destroyed) {
        child.stdin.write(data);
      }
    },
    snapshot(): ProviderSessionSnapshot {
      const snapshot = parser.snapshot();
      return {
        ...snapshot,
        lastStderr: [...lastStderr],
        transcriptPath: rawTranscriptPath,
        logPath
      };
    }
  };

  return handle;
}
