import type { AgentExecutionPolicy, AgentTeamConfig, RoleId } from "../core/types.js";

export interface ProviderSessionActivity {
  readonly type: "tool_start" | "text" | "result" | "error";
  readonly summary: string;
  readonly timestamp: number;
}

export interface ProviderOutboxRequest {
  readonly id: string;
  readonly messageType: string;
  readonly payload: unknown;
  readonly correlationId?: string;
  readonly createdAt?: string;
}

export type ProviderSessionDoneStatus = "completed" | "failed" | "interrupted" | "expired";
export type ProviderSessionPermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";

export interface ProviderPrintInput {
  readonly prompt: string;
  readonly cwd: string;
  readonly roleId?: RoleId;
  readonly executionPolicy?: AgentExecutionPolicy;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly config?: AgentTeamConfig;
}

export interface ProviderPrintResult {
  readonly ok: boolean;
  readonly sessionId?: string;
  readonly text: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ProviderStartSessionInput {
  readonly prompt: string;
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly roleId?: RoleId;
  readonly executionPolicy?: AgentExecutionPolicy;
  readonly env?: NodeJS.ProcessEnv;
  readonly config?: AgentTeamConfig;
  readonly sessionId?: string;
  readonly permissionMode?: ProviderSessionPermissionMode;
  readonly timeoutMs?: number;
}

export interface ProviderEnvironmentInspectionInput {
  readonly authMode: "subscription-oauth" | "api-key" | "oauth" | "none";
  readonly env: NodeJS.ProcessEnv;
  readonly config?: AgentTeamConfig;
}

export interface ProviderEnvironmentInspection {
  readonly warnings: readonly string[];
}

export interface ProviderCommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

export interface ProviderCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export type ProviderCommandRunner = (
  path: string,
  args: readonly string[],
  options?: ProviderCommandOptions
) => Promise<ProviderCommandResult>;

export interface ProviderHealthCheckInput {
  readonly workspaceRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly config?: AgentTeamConfig;
  readonly findExecutable: (name: string) => Promise<string | undefined>;
  readonly getVersion: (path: string) => Promise<string | undefined>;
  readonly runCommand: ProviderCommandRunner;
}

export type ProviderHealthCheckStatus = "pass" | "warn" | "fail";

export interface ProviderHealthCheck {
  readonly id: string;
  readonly status: ProviderHealthCheckStatus;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface ProviderSessionHandle {
  readonly providerSessionId: string | undefined;
  readonly done: Promise<ProviderSessionDoneStatus>;
  readonly recentActivities: readonly ProviderSessionActivity[];
  readonly currentActivity: ProviderSessionActivity | null;
  readonly lastStderr: readonly string[];
  readonly transcriptPath: string | undefined;
  readonly logPath: string | undefined;
  readonly supportsStdin: boolean;
  kill(): void;
  forceKill(): void;
  writeStdin?(data: string): boolean;
  snapshot(): ProviderSessionSnapshot;
}

export interface ProviderSessionSnapshot {
  readonly providerSessionId: string | undefined;
  readonly text: string;
  readonly warnings: readonly string[];
  readonly recentActivities: readonly ProviderSessionActivity[];
  readonly currentActivity: ProviderSessionActivity | null;
  readonly pendingOutboxRequests: readonly ProviderOutboxRequest[];
  readonly lastStderr: readonly string[];
  readonly transcriptPath: string | undefined;
  readonly logPath: string | undefined;
}
