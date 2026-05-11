import { runDoctor } from "../doctor.js";
import { loadAgentTeamConfig } from "../core/config.js";
import { dispatchReadOnlyAgent } from "../core/dispatch.js";
import { LifecycleRegistry } from "../core/lifecycle-registry.js";
import { AgentLifecycleManager } from "../core/lifecycle.js";
import { listRoles } from "../core/roles.js";
import type {
  AgentControlResult,
  AgentDispatchRequest,
  AgentMessageRequest,
  AgentMessageResult,
  AgentReplyRequest,
  AgentReplyResult,
  AgentStartResult,
  AgentTeamConfig,
  RoleId,
  RunSidecar
} from "../core/types.js";
import { listProviders } from "../providers/index.js";
import { jsonToolResult, type JsonToolResult } from "../utils/json.js";

export const TOOL_NAMES = [
  "agent_team_dispatch",
  "agent_team_start",
  "agent_team_reply",
  "agent_team_message",
  "agent_team_status",
  "agent_team_cancel",
  "agent_team_wind_down",
  "agent_team_doctor",
  "agent_team_list_roles",
  "agent_team_list_providers"
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const ROLE_IDS = new Set<string>(listRoles().map((role) => role.id));

type LifecycleLike = {
  readonly startRun: (request: AgentDispatchRequest) => Promise<AgentStartResult>;
  readonly messageRun: (request: AgentMessageRequest) => Promise<AgentMessageResult>;
  readonly replyRun: (request: AgentReplyRequest) => Promise<AgentReplyResult>;
  readonly getStatus: (cwd: string, runId: string) => Promise<RunSidecar>;
  readonly cancelRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
  readonly windDownRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
};

const defaultLifecycleRegistry = new LifecycleRegistry<LifecycleLike>({
  createLifecycle: (config) => new AgentLifecycleManager({ config })
});

export interface ToolDependencies {
  readonly dispatch?: typeof dispatchReadOnlyAgent;
  readonly lifecycle?: LifecycleLike;
  readonly lifecycleFactory?: (config: AgentTeamConfig) => LifecycleLike;
  readonly lifecycleRegistry?: LifecycleRegistry<LifecycleLike>;
  readonly doctor?: typeof runDoctor;
  readonly cwd?: () => string;
  readonly config?: AgentTeamConfig;
}

export function listToolNames(): readonly ToolName[] {
  return TOOL_NAMES;
}

function validationError(message: string): JsonToolResult {
  return jsonToolResult({ status: "validation_error", message });
}

function parseDispatchArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentDispatchRequest | JsonToolResult {
  if (typeof args.role !== "string" || !ROLE_IDS.has(args.role)) {
    return validationError("agent_team_dispatch requires a valid role.");
  }
  if (typeof args.task !== "string" || args.task.trim().length === 0) {
    return validationError("agent_team_dispatch requires a non-empty task.");
  }
  if (args.cwd !== undefined && typeof args.cwd !== "string") {
    return validationError("agent_team_dispatch cwd must be a string.");
  }
  if (args.provider !== undefined && typeof args.provider !== "string") {
    return validationError("agent_team_dispatch provider must be a string.");
  }
  if (
    args.timeoutMs !== undefined &&
    (typeof args.timeoutMs !== "number" || args.timeoutMs <= 0)
  ) {
    return validationError("agent_team_dispatch timeoutMs must be a positive number.");
  }

  return {
    role: args.role as RoleId,
    task: args.task,
    cwd: args.cwd ?? cwd,
    ...(args.provider === undefined ? {} : { provider: args.provider }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  };
}

function parseMessageArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentMessageRequest | JsonToolResult {
  if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
    return validationError("agent_team_message requires a non-empty runId.");
  }
  if (typeof args.message !== "string" || args.message.trim().length === 0) {
    return validationError("agent_team_message requires a non-empty message.");
  }
  if (args.cwd !== undefined && typeof args.cwd !== "string") {
    return validationError("agent_team_message cwd must be a string.");
  }
  if (args.messageType !== undefined && typeof args.messageType !== "string") {
    return validationError("agent_team_message messageType must be a string.");
  }
  if (args.correlationId !== undefined && typeof args.correlationId !== "string") {
    return validationError("agent_team_message correlationId must be a string.");
  }

  return {
    runId: args.runId,
    cwd: args.cwd ?? cwd,
    message: args.message,
    ...(args.messageType === undefined ? {} : { messageType: args.messageType }),
    ...(args.correlationId === undefined ? {} : { correlationId: args.correlationId })
  };
}

function parseReplyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentReplyRequest | JsonToolResult {
  if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
    return validationError("agent_team_reply requires a non-empty runId.");
  }
  if (
    args.message !== undefined &&
    (typeof args.message !== "string" || args.message.trim().length === 0)
  ) {
    return validationError("agent_team_reply message must be a non-empty string when provided.");
  }
  if (args.cwd !== undefined && typeof args.cwd !== "string") {
    return validationError("agent_team_reply cwd must be a string.");
  }
  if (args.provider !== undefined && typeof args.provider !== "string") {
    return validationError("agent_team_reply provider must be a string.");
  }
  if (args.messageType !== undefined && typeof args.messageType !== "string") {
    return validationError("agent_team_reply messageType must be a string.");
  }
  if (args.correlationId !== undefined && typeof args.correlationId !== "string") {
    return validationError("agent_team_reply correlationId must be a string.");
  }
  if (
    args.timeoutMs !== undefined &&
    (typeof args.timeoutMs !== "number" || args.timeoutMs <= 0)
  ) {
    return validationError("agent_team_reply timeoutMs must be a positive number.");
  }

  return {
    runId: args.runId,
    cwd: args.cwd ?? cwd,
    ...(args.message === undefined ? {} : { message: args.message }),
    ...(args.messageType === undefined ? {} : { messageType: args.messageType }),
    ...(args.correlationId === undefined ? {} : { correlationId: args.correlationId }),
    ...(args.provider === undefined ? {} : { provider: args.provider }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs })
  };
}

export function createToolHandlers(deps: ToolDependencies = {}): {
  readonly handleToolCall: (
    name: ToolName,
    args: Record<string, unknown>
  ) => Promise<JsonToolResult>;
} {
  const dispatch = deps.dispatch ?? dispatchReadOnlyAgent;
  const doctor = deps.doctor ?? runDoctor;
  const cwd = deps.cwd ?? process.cwd;
  const lifecycleRegistry =
    deps.lifecycleRegistry ??
    (deps.lifecycleFactory === undefined
      ? defaultLifecycleRegistry
      : new LifecycleRegistry<LifecycleLike>({
          createLifecycle: deps.lifecycleFactory
        }));

  async function config(workspaceRoot: string): Promise<AgentTeamConfig> {
    return deps.config ?? loadAgentTeamConfig(workspaceRoot);
  }

  async function lifecycleFor(
    workspaceRoot: string
  ): Promise<LifecycleLike> {
    if (deps.lifecycle !== undefined) {
      return deps.lifecycle;
    }
    const resolvedConfig = await config(workspaceRoot);
    return lifecycleRegistry.get(workspaceRoot, resolvedConfig);
  }

  return {
    async handleToolCall(name, args): Promise<JsonToolResult> {
      if (name === "agent_team_list_roles") {
        return jsonToolResult({ roles: listRoles() });
      }

      if (name === "agent_team_list_providers") {
        return jsonToolResult({ providers: listProviders({ config: await config(cwd()) }) });
      }

      if (name === "agent_team_doctor") {
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError("agent_team_doctor cwd must be a string.");
        }
        const workspaceRoot = args.cwd ?? cwd();
        return jsonToolResult({ ...(await doctor({ workspaceRoot })) });
      }

      if (name === "agent_team_dispatch") {
        const parsed = parseDispatchArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return jsonToolResult({ ...(await dispatch(parsed)) });
      }

      if (name === "agent_team_start") {
        const parsed = parseDispatchArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).startRun(parsed)) });
      }

      if (name === "agent_team_message") {
        const parsed = parseMessageArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).messageRun(parsed)) });
      }

      if (name === "agent_team_reply") {
        const parsed = parseReplyArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).replyRun(parsed)) });
      }

      if (name === "agent_team_status") {
        if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
          return validationError("agent_team_status requires a non-empty runId.");
        }
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError("agent_team_status cwd must be a string.");
        }
        const workspaceRoot = args.cwd ?? cwd();
        return jsonToolResult({
          run: await (await lifecycleFor(workspaceRoot)).getStatus(workspaceRoot, args.runId)
        });
      }

      if (name === "agent_team_cancel" || name === "agent_team_wind_down") {
        if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
          return validationError(`${name} requires a non-empty runId.`);
        }
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError(`${name} cwd must be a string.`);
        }
        const workspaceRoot = args.cwd ?? cwd();
        const lifecycle = await lifecycleFor(workspaceRoot);
        const result =
          name === "agent_team_cancel"
            ? await lifecycle.cancelRun(workspaceRoot, args.runId)
            : await lifecycle.windDownRun(workspaceRoot, args.runId);
        return jsonToolResult({ ...result });
      }

      return jsonToolResult({
        status: "unknown_tool",
        tool: name
      });
    }
  };
}

export async function handleToolCall(
  name: ToolName,
  args: Record<string, unknown>
): Promise<JsonToolResult> {
  return createToolHandlers().handleToolCall(name, args);
}
