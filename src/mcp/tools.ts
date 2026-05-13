import { resolve } from "node:path";
import { runDoctor } from "../doctor.js";
import { cancelAgentRuns } from "../core/cancel-many.js";
import { loadAgentTeamConfig } from "../core/config.js";
import { dispatchReadOnlyAgent } from "../core/dispatch.js";
import { StateCorruptionError } from "../core/errors.js";
import {
  buildAgentTeamDashboard,
  buildAgentTeamDashboardStateCorrupt
} from "../core/team-dashboard.js";
import {
  createDefaultLifecycleRegistry,
  LifecycleRegistry
} from "../core/lifecycle-registry.js";
import { startAgentTeamInParallel } from "../core/parallel-start.js";
import { listRoles } from "../core/roles.js";
import { createRunId } from "../core/run-ids.js";
import { sendAgentMessages } from "../core/message-many.js";
import { readMailboxRecords } from "../core/state/mailbox-store.js";
import { isSafeRunId, isSafeTeamId, teamRecordPath } from "../core/state/paths.js";
import {
  recoverStateCorruption,
  reportStateCorruption
} from "../core/state/recovery.js";
import { readRunSidecar } from "../core/state/run-store.js";
import { readAgentStatuses } from "../core/status-many.js";
import { summarizeAgentTeam } from "../core/team-summary.js";
import {
  createAgentTeamRecord,
  getAgentTeamRecord,
  listAgentTeamRecords
} from "../core/team-records.js";
import { windDownAgentRuns } from "../core/wind-down-many.js";
import type {
  AgentCleanupRequest,
  AgentCleanupResult,
  AgentCancelManyRequest,
  AgentCancelManyRun,
  AgentControlResult,
  AgentDispatchRequest,
  AgentMessageManyItemRequest,
  AgentMessageManyRequest,
  AgentMessageRequest,
  AgentMessageResult,
  AgentParallelStartRequest,
  AgentParallelStartRun,
  AgentReplyRequest,
  AgentReplyResult,
  AgentStartResult,
  AgentStatusManyRequest,
  AgentStatusManyRun,
  AgentTeamDashboardRequest,
  AgentTeamConfig,
  AgentTeamCreateRequest,
  AgentTeamRunRef,
  AgentTeamSummaryRequest,
  AgentTeamSummaryRunRequest,
  AgentWindDownManyRequest,
  AgentWindDownManyRun,
  RoleId,
  RunSidecar
} from "../core/types.js";
import { listProviders } from "../providers/index.js";
import { jsonToolResult, type JsonToolResult } from "../utils/json.js";

export const TOOL_NAMES = [
  "agent_team_dispatch",
  "agent_team_start",
  "agent_team_start_parallel",
  "agent_team_reply",
  "agent_team_message",
  "agent_team_message_many",
  "agent_team_status",
  "agent_team_status_many",
  "agent_team_summary",
  "agent_team_create_team",
  "agent_team_get_team",
  "agent_team_list_teams",
  "agent_team_dashboard",
  "agent_team_cancel",
  "agent_team_cancel_many",
  "agent_team_wind_down",
  "agent_team_wind_down_many",
  "agent_team_cleanup",
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
  readonly cleanupRunWorkspace?: (request: AgentCleanupRequest) => Promise<AgentCleanupResult>;
};

const defaultLifecycleRegistry = createDefaultLifecycleRegistry();

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

async function recoverableLifecycleTool(input: {
  readonly workspaceRoot: string;
  readonly runId?: string;
  readonly operation: ToolName;
  readonly action: () => Promise<JsonToolResult>;
}): Promise<JsonToolResult> {
  try {
    return await input.action();
  } catch (error) {
    if (error instanceof StateCorruptionError) {
      return jsonToolResult(
        await recoverStateCorruption({
          workspaceRoot: input.workspaceRoot,
          ...(input.runId === undefined ? {} : { runId: input.runId }),
          operation: input.operation,
          error
        })
      );
    }
    throw error;
  }
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

function readOptionalString(
  value: unknown,
  message: string
): string | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return validationError(message);
  }
  return value;
}

function readOptionalTimeout(
  value: unknown,
  message: string
): number | JsonToolResult | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || value <= 0) {
    return validationError(message);
  }
  return value;
}

function parseParallelStartArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentParallelStartRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_start_parallel requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_start_parallel cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const defaultProvider = readOptionalString(
    args.provider,
    "agent_team_start_parallel provider must be a string."
  );
  if (typeof defaultProvider === "object") {
    return defaultProvider;
  }

  const defaultTimeoutMs = readOptionalTimeout(
    args.timeoutMs,
    "agent_team_start_parallel timeoutMs must be a positive number."
  );
  if (typeof defaultTimeoutMs === "object") {
    return defaultTimeoutMs;
  }

  const concurrency = args.concurrency === undefined ? 3 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_start_parallel concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentParallelStartRun[] = [];
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_start_parallel runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.role !== "string" || !ROLE_IDS.has(run.role)) {
      return validationError(`agent_team_start_parallel runs[${index}] requires a valid role.`);
    }
    if (typeof run.task !== "string" || run.task.trim().length === 0) {
      return validationError(
        `agent_team_start_parallel runs[${index}] requires a non-empty task.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_start_parallel runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const itemProvider = readOptionalString(
      run.provider,
      `agent_team_start_parallel runs[${index}] provider must be a string.`
    );
    if (typeof itemProvider === "object") {
      return itemProvider;
    }

    const itemTimeoutMs = readOptionalTimeout(
      run.timeoutMs,
      `agent_team_start_parallel runs[${index}] timeoutMs must be a positive number.`
    );
    if (typeof itemTimeoutMs === "object") {
      return itemTimeoutMs;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_start_parallel runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const provider = itemProvider ?? defaultProvider;
    const timeoutMs = itemTimeoutMs ?? defaultTimeoutMs;
    runs.push({
      role: run.role as RoleId,
      task: run.task,
      cwd: itemCwd ?? defaultCwd ?? cwd,
      ...(provider === undefined ? {} : { provider }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    batchId: createRunId().replace(/^run_/, "batch_"),
    runs,
    concurrency
  };
}

function parseStatusManyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentStatusManyRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_status_many requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_status_many cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_status_many concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentStatusManyRun[] = [];
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_status_many runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_status_many runs[${index}] requires a non-empty runId.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_status_many runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_status_many runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    runs.push({
      runId: run.runId,
      cwd: itemCwd ?? defaultCwd ?? cwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    runs,
    concurrency
  };
}

function parseSummaryArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentTeamSummaryRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_summary requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_summary cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_summary concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentTeamSummaryRunRequest[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_summary runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(`agent_team_summary runs[${index}] requires a non-empty runId.`);
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_summary runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_summary runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_summary runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    runs,
    concurrency
  };
}

function parseCreateTeamArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentTeamCreateRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_create_team requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_create_team cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const name = readOptionalString(
    args.name,
    "agent_team_create_team name must be a string."
  );
  if (typeof name === "object") {
    return name;
  }

  const description = readOptionalString(
    args.description,
    "agent_team_create_team description must be a string."
  );
  if (typeof description === "object") {
    return description;
  }

  const runs: AgentTeamRunRef[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_create_team runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_create_team runs[${index}] requires a non-empty runId.`
      );
    }
    if (!isSafeRunId(run.runId)) {
      return validationError(
        `agent_team_create_team runs[${index}] requires a safe run_ id.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_create_team runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_create_team runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_create_team runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    cwd: defaultCwd ?? cwd,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    runs
  };
}

function parseTeamIdArgs(
  args: Record<string, unknown>,
  cwd: string,
  toolName: "agent_team_get_team"
): { readonly teamId: string; readonly cwd: string } | JsonToolResult {
  if (typeof args.teamId !== "string" || args.teamId.trim().length === 0) {
    return validationError(`${toolName} requires a non-empty teamId.`);
  }
  if (!isSafeTeamId(args.teamId)) {
    return validationError(`${toolName} requires a safe team_ id.`);
  }
  const workspaceRoot = readOptionalString(args.cwd, `${toolName} cwd must be a string.`);
  if (typeof workspaceRoot === "object") {
    return workspaceRoot;
  }
  return {
    teamId: args.teamId,
    cwd: workspaceRoot ?? cwd
  };
}

function parseListTeamsArgs(
  args: Record<string, unknown>,
  cwd: string
): { readonly cwd: string } | JsonToolResult {
  const workspaceRoot = readOptionalString(
    args.cwd,
    "agent_team_list_teams cwd must be a string."
  );
  if (typeof workspaceRoot === "object") {
    return workspaceRoot;
  }
  return {
    cwd: workspaceRoot ?? cwd
  };
}

function parseDashboardArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentTeamDashboardRequest | JsonToolResult {
  const hasTeamId = args.teamId !== undefined;
  const hasRuns = args.runs !== undefined;
  if (hasTeamId === hasRuns) {
    return validationError("agent_team_dashboard requires exactly one of teamId or runs.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_dashboard cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_dashboard concurrency must be an integer from 1 to 8."
    );
  }

  const workspaceRoot = defaultCwd ?? cwd;
  if (hasTeamId) {
    if (typeof args.teamId !== "string" || args.teamId.trim().length === 0) {
      return validationError("agent_team_dashboard requires a non-empty teamId.");
    }
    if (!isSafeTeamId(args.teamId)) {
      return validationError("agent_team_dashboard requires a safe team_ id.");
    }
    return {
      cwd: workspaceRoot,
      teamId: args.teamId,
      concurrency
    };
  }

  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_dashboard requires a non-empty runs array.");
  }

  const runs: AgentTeamSummaryRunRequest[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_dashboard runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_dashboard runs[${index}] requires a non-empty runId.`
      );
    }
    if (!isSafeRunId(run.runId)) {
      return validationError(
        `agent_team_dashboard runs[${index}] requires a safe run_ id.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_dashboard runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_dashboard runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? workspaceRoot;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_dashboard runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    cwd: workspaceRoot,
    runs,
    concurrency
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

function parseMessageManyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentMessageManyRequest | JsonToolResult {
  if (!Array.isArray(args.messages) || args.messages.length === 0) {
    return validationError("agent_team_message_many requires a non-empty messages array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_message_many cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_message_many concurrency must be an integer from 1 to 8."
    );
  }

  const messages: AgentMessageManyItemRequest[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.messages.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_message_many messages[${index}] must be an object.`);
    }

    const item = value as Record<string, unknown>;
    if (typeof item.runId !== "string" || item.runId.trim().length === 0) {
      return validationError(
        `agent_team_message_many messages[${index}] requires a non-empty runId.`
      );
    }
    if (typeof item.message !== "string" || item.message.trim().length === 0) {
      return validationError(
        `agent_team_message_many messages[${index}] requires a non-empty message.`
      );
    }

    const itemCwd = readOptionalString(
      item.cwd,
      `agent_team_message_many messages[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const messageType = readOptionalString(
      item.messageType,
      `agent_team_message_many messages[${index}] messageType must be a string.`
    );
    if (typeof messageType === "object") {
      return messageType;
    }

    const correlationId = readOptionalString(
      item.correlationId,
      `agent_team_message_many messages[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${item.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_message_many messages[${index}] duplicates target ${item.runId}.`
      );
    }
    seenTargets.add(targetKey);

    messages.push({
      runId: item.runId,
      cwd: resolvedCwd,
      message: item.message,
      ...(messageType === undefined ? {} : { messageType }),
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    messages,
    concurrency
  };
}

function parseCancelManyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentCancelManyRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_cancel_many requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_cancel_many cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_cancel_many concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentCancelManyRun[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_cancel_many runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_cancel_many runs[${index}] requires a non-empty runId.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_cancel_many runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_cancel_many runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_cancel_many runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    runs,
    concurrency
  };
}

function parseWindDownManyArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentWindDownManyRequest | JsonToolResult {
  if (!Array.isArray(args.runs) || args.runs.length === 0) {
    return validationError("agent_team_wind_down_many requires a non-empty runs array.");
  }

  const defaultCwd = readOptionalString(
    args.cwd,
    "agent_team_wind_down_many cwd must be a string."
  );
  if (typeof defaultCwd === "object") {
    return defaultCwd;
  }

  const concurrency = args.concurrency === undefined ? 8 : args.concurrency;
  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  ) {
    return validationError(
      "agent_team_wind_down_many concurrency must be an integer from 1 to 8."
    );
  }

  const runs: AgentWindDownManyRun[] = [];
  const seenTargets = new Set<string>();
  for (const [index, value] of args.runs.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return validationError(`agent_team_wind_down_many runs[${index}] must be an object.`);
    }

    const run = value as Record<string, unknown>;
    if (typeof run.runId !== "string" || run.runId.trim().length === 0) {
      return validationError(
        `agent_team_wind_down_many runs[${index}] requires a non-empty runId.`
      );
    }

    const itemCwd = readOptionalString(
      run.cwd,
      `agent_team_wind_down_many runs[${index}] cwd must be a string.`
    );
    if (typeof itemCwd === "object") {
      return itemCwd;
    }

    const correlationId = readOptionalString(
      run.correlationId,
      `agent_team_wind_down_many runs[${index}] correlationId must be a string.`
    );
    if (typeof correlationId === "object") {
      return correlationId;
    }

    const resolvedCwd = itemCwd ?? defaultCwd ?? cwd;
    const targetKey = `${resolve(resolvedCwd)}\0${run.runId}`;
    if (seenTargets.has(targetKey)) {
      return validationError(
        `agent_team_wind_down_many runs[${index}] duplicates target ${run.runId}.`
      );
    }
    seenTargets.add(targetKey);

    runs.push({
      runId: run.runId,
      cwd: resolvedCwd,
      ...(correlationId === undefined ? {} : { correlationId })
    });
  }

  return {
    runs,
    concurrency
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

function parseCleanupArgs(
  args: Record<string, unknown>,
  cwd: string
): AgentCleanupRequest | JsonToolResult {
  if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
    return validationError("agent_team_cleanup requires a non-empty runId.");
  }
  if (args.cwd !== undefined && typeof args.cwd !== "string") {
    return validationError("agent_team_cleanup cwd must be a string.");
  }
  if (typeof args.force !== "boolean") {
    return validationError("agent_team_cleanup force must be a boolean.");
  }

  return {
    runId: args.runId,
    cwd: args.cwd ?? cwd,
    force: args.force
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
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError("agent_team_list_providers cwd must be a string.");
        }
        const workspaceRoot = args.cwd ?? cwd();
        return jsonToolResult({ providers: listProviders({ config: await config(workspaceRoot) }) });
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
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).startRun(parsed)) })
        });
      }

      if (name === "agent_team_start_parallel") {
        const parsed = parseParallelStartArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }

        return jsonToolResult({
          ...(await startAgentTeamInParallel(parsed, {
            startRun: async (request) =>
              (await lifecycleFor(request.cwd)).startRun(request)
          }))
        });
      }

      if (name === "agent_team_message") {
        const parsed = parseMessageArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          runId: parsed.runId,
          operation: name,
          action: async () =>
            jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).messageRun(parsed)) })
        });
      }

      if (name === "agent_team_message_many") {
        const parsed = parseMessageManyArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }

        return jsonToolResult({
          ...(await sendAgentMessages(parsed, {
            messageRun: async (request) =>
              (await lifecycleFor(request.cwd)).messageRun(request),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_reply") {
        const parsed = parseReplyArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          runId: parsed.runId,
          operation: name,
          action: async () =>
            jsonToolResult({ ...(await (await lifecycleFor(parsed.cwd)).replyRun(parsed)) })
        });
      }

      if (name === "agent_team_status") {
        if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
          return validationError("agent_team_status requires a non-empty runId.");
        }
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError("agent_team_status cwd must be a string.");
        }
        const runId = args.runId;
        const workspaceRoot = args.cwd ?? cwd();
        return recoverableLifecycleTool({
          workspaceRoot,
          runId,
          operation: name,
          action: async () =>
            jsonToolResult({
              run: await (await lifecycleFor(workspaceRoot)).getStatus(
                workspaceRoot,
                runId
              )
            })
        });
      }

      if (name === "agent_team_status_many") {
        const parsed = parseStatusManyArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }

        return jsonToolResult({
          ...(await readAgentStatuses(parsed, {
            getStatus: async (workspaceRoot, runId) =>
              (await lifecycleFor(workspaceRoot)).getStatus(workspaceRoot, runId),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_summary") {
        const parsed = parseSummaryArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }

        return jsonToolResult({
          ...(await summarizeAgentTeam(parsed, {
            readRun: async (workspaceRoot, runId) =>
              readRunSidecar(workspaceRoot, runId),
            readMailbox: async (workspaceRoot, runId, kind) =>
              readMailboxRecords(workspaceRoot, runId, kind),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_create_team") {
        const parsed = parseCreateTeamArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await createAgentTeamRecord(parsed))
            })
        });
      }

      if (name === "agent_team_get_team") {
        const parsed = parseTeamIdArgs(args, cwd(), name);
        if ("content" in parsed) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await getAgentTeamRecord(parsed))
            })
        });
      }

      if (name === "agent_team_list_teams") {
        const parsed = parseListTeamsArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          operation: name,
          action: async () =>
            jsonToolResult({
              ...(await listAgentTeamRecords(parsed.cwd))
            })
        });
      }

      if (name === "agent_team_dashboard") {
        const parsed = parseDashboardArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        try {
          const team =
            parsed.teamId === undefined
              ? undefined
              : (await getAgentTeamRecord({
                  cwd: parsed.cwd,
                  teamId: parsed.teamId
                })).team;
          const runs = team?.runs ?? parsed.runs ?? [];
          const summary = await summarizeAgentTeam(
            {
              runs,
              concurrency: parsed.concurrency
            },
            {
              readRun: async (workspaceRoot, runId) =>
                readRunSidecar(workspaceRoot, runId),
              readMailbox: async (workspaceRoot, runId, kind) =>
                readMailboxRecords(workspaceRoot, runId, kind),
              recoverStateCorruption: async (input) =>
                reportStateCorruption({ ...input, operation: name })
            }
          );
          return jsonToolResult({
            ...buildAgentTeamDashboard({
              source:
                team === undefined
                  ? { kind: "runs" }
                  : {
                      kind: "team",
                      teamId: team.teamId,
                      evidencePath: team.evidencePath
                    },
              summary,
              generatedAt: new Date().toISOString()
            })
          });
        } catch (error) {
          if (error instanceof StateCorruptionError) {
            const recovery = reportStateCorruption({
              workspaceRoot: parsed.cwd,
              operation: name,
              error
            });
            return jsonToolResult({
              ...buildAgentTeamDashboardStateCorrupt({
                source:
                  parsed.teamId === undefined
                    ? { kind: "runs" }
                    : {
                        kind: "team",
                        teamId: parsed.teamId,
                        evidencePath:
                          recovery.originalPath ?? teamRecordPath(parsed.cwd, parsed.teamId)
                      },
                issue: {
                  status: "state_corrupt",
                  target: "team_record",
                  recovery
                },
                generatedAt: new Date().toISOString()
              })
            });
          }
          throw error;
        }
      }

      if (name === "agent_team_cancel" || name === "agent_team_wind_down") {
        if (typeof args.runId !== "string" || args.runId.trim().length === 0) {
          return validationError(`${name} requires a non-empty runId.`);
        }
        if (args.cwd !== undefined && typeof args.cwd !== "string") {
          return validationError(`${name} cwd must be a string.`);
        }
        const runId = args.runId;
        const workspaceRoot = args.cwd ?? cwd();
        return recoverableLifecycleTool({
          workspaceRoot,
          runId,
          operation: name,
          action: async () => {
            const lifecycle = await lifecycleFor(workspaceRoot);
            const result =
              name === "agent_team_cancel"
                ? await lifecycle.cancelRun(workspaceRoot, runId)
                : await lifecycle.windDownRun(workspaceRoot, runId);
            return jsonToolResult({ ...result });
          }
        });
      }

      if (name === "agent_team_cancel_many") {
        const parsed = parseCancelManyArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }

        return jsonToolResult({
          ...(await cancelAgentRuns(parsed, {
            cancelRun: async (workspaceRoot, runId) =>
              (await lifecycleFor(workspaceRoot)).cancelRun(workspaceRoot, runId),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_wind_down_many") {
        const parsed = parseWindDownManyArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }

        return jsonToolResult({
          ...(await windDownAgentRuns(parsed, {
            windDownRun: async (workspaceRoot, runId) =>
              (await lifecycleFor(workspaceRoot)).windDownRun(workspaceRoot, runId),
            recoverStateCorruption: async (input) => recoverStateCorruption(input)
          }))
        });
      }

      if (name === "agent_team_cleanup") {
        const parsed = parseCleanupArgs(args, cwd());
        if ("content" in parsed) {
          return parsed;
        }
        return recoverableLifecycleTool({
          workspaceRoot: parsed.cwd,
          runId: parsed.runId,
          operation: name,
          action: async () => {
            const lifecycle = await lifecycleFor(parsed.cwd);
            if (lifecycle.cleanupRunWorkspace === undefined) {
              throw new Error("Lifecycle does not support workspace cleanup.");
            }
            return jsonToolResult({ ...(await lifecycle.cleanupRunWorkspace(parsed)) });
          }
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
