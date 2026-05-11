import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "./core/config.js";
import type { AgentTeamConfig } from "./core/types.js";
import { inspectClaudeEnvironment } from "./providers/claude-code-cli/doctor.js";

const execFileAsync = promisify(execFile);

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
  readonly warnings: readonly string[];
}

export interface DoctorInput {
  readonly workspaceRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly findExecutable?: (name: string) => Promise<string | undefined>;
  readonly getVersion?: (path: string) => Promise<string | undefined>;
  readonly loadConfig?: typeof loadAgentTeamConfig;
}

async function defaultFindExecutable(name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("command", ["-v", name], {
      shell: true
    });
    const path = stdout.trim();
    return path.length === 0 ? undefined : path;
  } catch {
    return undefined;
  }
}

async function defaultGetVersion(path: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(path, ["--version"]);
    const version = stdout.trim();
    return version.length === 0 ? undefined : version;
  } catch {
    return undefined;
  }
}

export async function runDoctor(input: DoctorInput = {}): Promise<DoctorReport> {
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const env = input.env ?? process.env;
  const findExecutable = input.findExecutable ?? defaultFindExecutable;
  const getVersion = input.getVersion ?? defaultGetVersion;
  const loadConfig = input.loadConfig ?? loadAgentTeamConfig;
  const checks: DoctorCheck[] = [];
  let config: AgentTeamConfig = DEFAULT_AGENT_TEAM_CONFIG;

  try {
    config = await loadConfig(workspaceRoot);
    checks.push({
      id: "config",
      status: "pass",
      message: "Agent Team workspace config loaded.",
      details: {
        workspaceRoot,
        writeMode: config.writeMode,
        auth: config.auth
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      id: "config",
      status: "fail",
      message: "Agent Team workspace config is invalid.",
      details: {
        workspaceRoot,
        error: message,
        fix: `Fix or remove ${workspaceRoot}/.agent-team/config.json.`
      }
    });
  }

  const claudePath = await findExecutable("claude");
  if (claudePath === undefined) {
    checks.push({
      id: "claude-cli",
      status: "fail",
      message: "Claude Code CLI was not found on PATH."
    });
  } else {
    checks.push({
      id: "claude-cli",
      status: "pass",
      message: "Claude Code CLI found.",
      details: {
        path: claudePath,
        version: await getVersion(claudePath)
      }
    });
  }

  const environment = inspectClaudeEnvironment({
    authMode: "subscription-oauth",
    env
  });
  if (environment.warnings.length > 0) {
    const status = config.auth.allowApiKeyFallback ? "warn" : "fail";
    checks.push({
      id: "auth-precedence",
      status,
      message: config.auth.allowApiKeyFallback
        ? "Environment may override Claude Code subscription OAuth; API fallback is explicitly allowed."
        : "Environment may override Claude Code subscription OAuth and API fallback is disabled.",
      details: { warnings: environment.warnings }
    });
  } else {
    checks.push({
      id: "auth-precedence",
      status: "pass",
      message: "No API-key override variables detected for subscription mode."
    });
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    warnings: environment.warnings
  };
}
