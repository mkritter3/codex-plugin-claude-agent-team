import { runDoctor } from "../doctor.js";
import { dispatchReadOnlyAgent } from "../core/dispatch.js";
import { defaultLifecycleManager } from "../core/lifecycle.js";
import { listRoles } from "../core/roles.js";
import { readRunSidecar } from "../core/state/run-store.js";
import type {
  AgentControlResult,
  AgentDispatchRequest,
  AgentStartResult,
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

const DEFERRED_TOOLS = new Set<ToolName>([
  "agent_team_reply",
  "agent_team_message"
]);

const ROLE_IDS = new Set<string>(listRoles().map((role) => role.id));

export interface ToolDependencies {
  readonly dispatch?: typeof dispatchReadOnlyAgent;
  readonly lifecycle?: {
    readonly startRun: (request: AgentDispatchRequest) => Promise<AgentStartResult>;
    readonly getStatus: (cwd: string, runId: string) => Promise<RunSidecar>;
    readonly cancelRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
    readonly windDownRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
  };
  readonly cwd?: () => string;
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

export function createToolHandlers(deps: ToolDependencies = {}): {
  readonly handleToolCall: (
    name: ToolName,
    args: Record<string, unknown>
  ) => Promise<JsonToolResult>;
} {
  const dispatch = deps.dispatch ?? dispatchReadOnlyAgent;
  const lifecycle = deps.lifecycle ?? defaultLifecycleManager;
  const cwd = deps.cwd ?? process.cwd;

  return {
    async handleToolCall(name, args): Promise<JsonToolResult> {
      if (name === "agent_team_list_roles") {
        return jsonToolResult({ roles: listRoles() });
      }

      if (name === "agent_team_list_providers") {
        return jsonToolResult({ providers: listProviders() });
      }

      if (name === "agent_team_doctor") {
        return jsonToolResult({ ...(await runDoctor()) });
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
        return jsonToolResult({ ...(await lifecycle.startRun(parsed)) });
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
          run:
            deps.lifecycle === undefined
              ? await readRunSidecar(workspaceRoot, args.runId)
              : await lifecycle.getStatus(workspaceRoot, args.runId)
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
        const result =
          name === "agent_team_cancel"
            ? await lifecycle.cancelRun(workspaceRoot, args.runId)
            : await lifecycle.windDownRun(workspaceRoot, args.runId);
        return jsonToolResult({ ...result });
      }

      if (DEFERRED_TOOLS.has(name)) {
        return jsonToolResult({
          status: "not_implemented",
          tool: name,
          milestone: "milestone-3"
        });
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
