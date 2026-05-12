import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "./core/config.js";
import { listRoles } from "./core/roles.js";
import { selectProvider } from "./core/router.js";
import { STATE_DIR } from "./core/state/paths.js";
import type { AgentProviderDescriptor, AgentTeamConfig } from "./core/types.js";
import {
  inspectGitWorktreeSupport as defaultInspectGitWorktreeSupport
} from "./core/workspaces.js";
import {
  getProviderRuntime,
  listProviders,
  type AgentProviderRuntime
} from "./providers/index.js";
import type {
  ProviderCommandOptions,
  ProviderCommandResult,
  ProviderCommandRunner
} from "./providers/types.js";

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
  readonly runProviderCommand?: ProviderCommandRunner;
  readonly nodeVersion?: string;
  readonly checkMcpServerLoadable?: () => Promise<void>;
  readonly loadConfig?: typeof loadAgentTeamConfig;
  readonly ensureWritableState?: (workspaceRoot: string) => Promise<void>;
  readonly inspectGitWorktreeSupport?: typeof defaultInspectGitWorktreeSupport;
  readonly providers?: readonly AgentProviderDescriptor[];
  readonly runtimes?: readonly AgentProviderRuntime[];
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

function text(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

async function defaultRunProviderCommand(
  path: string,
  args: readonly string[],
  options: ProviderCommandOptions = {}
): Promise<ProviderCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(path, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      encoding: "utf8"
    });
    return {
      ok: true,
      stdout: text(stdout),
      stderr: text(stderr),
      exitCode: 0
    };
  } catch (error) {
    const commandError = error as {
      readonly stdout?: unknown;
      readonly stderr?: unknown;
      readonly code?: unknown;
    };
    return {
      ok: false,
      stdout: text(commandError.stdout),
      stderr: text(commandError.stderr),
      exitCode: typeof commandError.code === "number" ? commandError.code : null
    };
  }
}

async function defaultEnsureWritableState(workspaceRoot: string): Promise<void> {
  const stateDir = join(workspaceRoot, STATE_DIR);
  await mkdir(stateDir, { recursive: true });
  const probePath = join(stateDir, `.doctor-write-probe-${process.pid}-${Date.now()}`);
  await writeFile(probePath, "ok\n", "utf8");
  await rm(probePath, { force: true });
}

async function defaultCheckMcpServerLoadable(): Promise<void> {
  const module = await import("./mcp/server.js");
  if (typeof module.createAgentTeamServer !== "function") {
    throw new Error("createAgentTeamServer export was not found");
  }
}

function nodeMajor(version: string): number | undefined {
  const match = /^v?(\d+)/.exec(version);
  return match === null ? undefined : Number(match[1]);
}

export async function runDoctor(input: DoctorInput = {}): Promise<DoctorReport> {
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const env = input.env ?? process.env;
  const findExecutable = input.findExecutable ?? defaultFindExecutable;
  const getVersion = input.getVersion ?? defaultGetVersion;
  const runProviderCommand = input.runProviderCommand ?? defaultRunProviderCommand;
  const nodeVersion = input.nodeVersion ?? process.versions.node;
  const checkMcpServerLoadable =
    input.checkMcpServerLoadable ?? defaultCheckMcpServerLoadable;
  const loadConfig = input.loadConfig ?? loadAgentTeamConfig;
  const ensureWritableState = input.ensureWritableState ?? defaultEnsureWritableState;
  const inspectGitWorktreeSupport =
    input.inspectGitWorktreeSupport ?? defaultInspectGitWorktreeSupport;
  const checks: DoctorCheck[] = [];
  let config: AgentTeamConfig = DEFAULT_AGENT_TEAM_CONFIG;

  const major = nodeMajor(nodeVersion);
  if (major !== undefined && major >= 22) {
    checks.push({
      id: "node-version",
      status: "pass",
      message: "Host Node.js runtime satisfies the Agent Team MCP requirement.",
      details: { version: nodeVersion, required: ">=22" }
    });
  } else {
    checks.push({
      id: "node-version",
      status: "fail",
      message: "Host Node.js runtime is below the Agent Team MCP requirement.",
      details: {
        version: nodeVersion,
        required: ">=22",
        fix: "Use Node.js 22 or newer to run the Agent Team MCP server."
      }
    });
  }

  try {
    await checkMcpServerLoadable();
    checks.push({
      id: "mcp-server-loadable",
      status: "pass",
      message: "Agent Team MCP server module is loadable."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      id: "mcp-server-loadable",
      status: "fail",
      message: "Agent Team MCP server module could not be loaded.",
      details: {
        error: message,
        fix: "Run npm run build and verify the MCP server entrypoint can be imported."
      }
    });
  }

  try {
    config = await loadConfig(workspaceRoot);
    checks.push({
      id: "config",
      status: "pass",
      message: "Agent Team workspace config loaded.",
      details: {
        workspaceRoot,
        writeMode: config.writeMode,
        auth: config.auth,
        providers: {
          openaiCompatible: {
            enabled: config.providers.openaiCompatible.enabled,
            hasBaseUrl: config.providers.openaiCompatible.baseUrl !== undefined,
            hasModel: config.providers.openaiCompatible.model !== undefined,
            apiKeyEnv: config.providers.openaiCompatible.apiKeyEnv,
            capabilities: config.providers.openaiCompatible.capabilities
          },
          ollamaCloud: {
            enabled: config.providers.ollamaCloud.enabled,
            profileCount: config.providers.ollamaCloud.profiles.length
          },
          gemini: {
            enabled: config.providers.gemini.enabled,
            hasBaseUrl: config.providers.gemini.baseUrl !== undefined,
            hasModel: config.providers.gemini.model !== undefined,
            apiKeyEnv: config.providers.gemini.apiKeyEnv,
            capabilities: config.providers.gemini.capabilities
          }
        }
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

  const providers = input.providers ?? listProviders({ config });
  const environmentWarnings: string[] = [];
  for (const provider of providers) {
    const runtime = getProviderRuntime(
      provider.id,
      input.runtimes === undefined ? {} : { runtimes: input.runtimes }
    );
    if (runtime === undefined) {
      checks.push({
        id: `provider-runtime:${provider.id}`,
        status: "fail",
        message: `No provider runtime registered for ${provider.id}.`
      });
      continue;
    }

    checks.push(
      ...(await runtime.healthCheck({
        workspaceRoot,
        providerId: provider.id,
        env,
        config,
        findExecutable,
        getVersion,
        runCommand: runProviderCommand
      }))
    );
    environmentWarnings.push(
      ...runtime.inspectEnvironment({
        providerId: provider.id,
        authMode: provider.authMode,
        env,
        config
      }).warnings
    );
  }

  const uniqueEnvironmentWarnings = [...new Set(environmentWarnings)];
  if (uniqueEnvironmentWarnings.length > 0) {
    const status = config.auth.allowApiKeyFallback ? "warn" : "fail";
    checks.push({
      id: "auth-precedence",
      status,
      message: config.auth.allowApiKeyFallback
        ? "Environment may override Claude Code subscription OAuth; API fallback is explicitly allowed."
        : "Environment may override Claude Code subscription OAuth and API fallback is disabled.",
      details: { warnings: uniqueEnvironmentWarnings }
    });
  } else {
    checks.push({
      id: "auth-precedence",
      status: "pass",
      message: "No API-key override variables detected for subscription mode."
    });
  }

  for (const role of listRoles()) {
    if (!role.defaultReadOnly && !config.writeMode.enabled) {
      checks.push({
        id: `role-routing:${role.id}`,
        status: "warn",
        message: "slice-implementer is unavailable until isolated write mode is enabled.",
        details: {
          role: role.id,
          requiredCapabilities: role.requiredCapabilities
        }
      });
      continue;
    }

    try {
      const provider = selectProvider({
        roleId: role.id,
        providers
      });
      checks.push({
        id: `role-routing:${role.id}`,
        status: "pass",
        message: `Role ${role.id} can route to ${provider.id}.`,
        details: {
          role: role.id,
          provider: provider.id,
          requiredCapabilities: role.requiredCapabilities
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        id: `role-routing:${role.id}`,
        status: "fail",
        message: `Role ${role.id} cannot route to an available provider.`,
        details: {
          role: role.id,
          error: message,
          requiredCapabilities: role.requiredCapabilities
        }
      });
    }
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    warnings: [
        ...new Set([
        ...uniqueEnvironmentWarnings,
        ...checks
          .filter((check) => check.status === "warn")
          .map((check) => check.message)
      ])
    ]
  };
}
