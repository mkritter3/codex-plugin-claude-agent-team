import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "./core/config.js";
import { STATE_DIR } from "./core/state/paths.js";
import type { AgentTeamConfig } from "./core/types.js";
import {
  inspectGitWorktreeSupport as defaultInspectGitWorktreeSupport
} from "./core/workspaces.js";
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
  readonly ensureWritableState?: (workspaceRoot: string) => Promise<void>;
  readonly inspectGitWorktreeSupport?: typeof defaultInspectGitWorktreeSupport;
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

async function defaultEnsureWritableState(workspaceRoot: string): Promise<void> {
  const stateDir = join(workspaceRoot, STATE_DIR);
  await mkdir(stateDir, { recursive: true });
  const probePath = join(stateDir, `.doctor-write-probe-${process.pid}-${Date.now()}`);
  await writeFile(probePath, "ok\n", "utf8");
  await rm(probePath, { force: true });
}

export async function runDoctor(input: DoctorInput = {}): Promise<DoctorReport> {
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const env = input.env ?? process.env;
  const findExecutable = input.findExecutable ?? defaultFindExecutable;
  const getVersion = input.getVersion ?? defaultGetVersion;
  const loadConfig = input.loadConfig ?? loadAgentTeamConfig;
  const ensureWritableState = input.ensureWritableState ?? defaultEnsureWritableState;
  const inspectGitWorktreeSupport =
    input.inspectGitWorktreeSupport ?? defaultInspectGitWorktreeSupport;
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

  try {
    await ensureWritableState(workspaceRoot);
    checks.push({
      id: "state-writable",
      status: "pass",
      message: "Agent Team state directory is writable.",
      details: { path: join(workspaceRoot, STATE_DIR) }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      id: "state-writable",
      status: "fail",
      message: "Agent Team state directory is not writable.",
      details: {
        path: join(workspaceRoot, STATE_DIR),
        error: message,
        fix: `Ensure ${join(workspaceRoot, STATE_DIR)} can be created and written.`
      }
    });
  }

  if (config.writeMode.enabled && config.writeMode.requireIsolatedWorktree) {
    const git = await inspectGitWorktreeSupport({ workspaceRoot });
    checks.push(
      git.ok
        ? {
            id: "git-worktree",
            status: "pass",
            message: "Git worktree support is available.",
            details: {
              gitVersion: git.gitVersion,
              sourceRoot: git.sourceRoot,
              worktreeList: git.worktreeList
            }
          }
        : {
            id: "git-worktree",
            status: "fail",
            message: "Git worktree support is required for isolated write mode.",
            details: {
              error: git.message,
              fix: "Install git and run doctor from inside a git workspace."
            }
          }
    );
  } else {
    checks.push({
      id: "git-worktree",
      status: "pass",
      message: "Git worktree support is not required while write mode is disabled."
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
