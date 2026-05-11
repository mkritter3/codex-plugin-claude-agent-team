import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildClaudeCommand } from "./commands.js";
import { parseClaudeJsonOutput } from "./output.js";

const execFileAsync = promisify(execFile);

export interface ClaudeProcessResult {
  readonly ok: boolean;
  readonly sessionId?: string;
  readonly text: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string; stderr: string }>;

export class ClaudeProcessError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;

  constructor(
    message: string,
    details: { stdout?: string; stderr?: string; exitCode?: number } = {}
  ) {
    super(message);
    this.name = "ClaudeProcessError";
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
    this.exitCode = details.exitCode ?? 1;
  }
}

const defaultExecFile: ExecFileLike = async (command, args, options) => {
  try {
    const result = await execFileAsync(command, [...args], options);
    return {
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const execError = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    throw new ClaudeProcessError(execError.message, {
      ...(execError.stdout === undefined ? {} : { stdout: execError.stdout }),
      ...(execError.stderr === undefined ? {} : { stderr: execError.stderr }),
      exitCode: typeof execError.code === "number" ? execError.code : 1
    });
  }
};

export async function runClaudePrint(input: {
  readonly prompt: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly execFile?: ExecFileLike;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<ClaudeProcessResult> {
  const command = buildClaudeCommand({
    prompt: input.prompt,
    cwd: input.cwd,
    outputFormat: "json",
    permissionMode: "default"
  });
  const execFileImpl = input.execFile ?? defaultExecFile;

  try {
    const result = await execFileImpl(command.command, command.args, {
      cwd: command.cwd,
      ...(input.timeoutMs === undefined ? {} : { timeout: input.timeoutMs }),
      ...(input.env === undefined ? {} : { env: input.env })
    });
    const parsed = parseClaudeJsonOutput(result.stdout);
    return {
      ok: true,
      ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
      text: parsed.text,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    };
  } catch (error) {
    if (error instanceof ClaudeProcessError) {
      return {
        ok: false,
        text: error.stdout,
        stdout: error.stdout,
        stderr: error.stderr,
        exitCode: error.exitCode
      };
    }
    throw error;
  }
}
