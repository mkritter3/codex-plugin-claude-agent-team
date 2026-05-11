import type { ProviderSessionActivity } from "../providers/types.js";

export const PROVIDER_CAPABILITIES = [
  "structuredOutput",
  "longContext",
  "tools",
  "edits",
  "sessionResume",
  "cancellation",
  "workspaceIsolation",
  "parallelDispatch",
  "reasoning"
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export type ProviderAuthMode =
  | "subscription-oauth"
  | "api-key"
  | "oauth"
  | "none";

export type RoleId =
  | "architect"
  | "planner"
  | "code-reviewer"
  | "debugger"
  | "test-designer"
  | "slice-implementer"
  | "ux-product-critic";

export type VerdictStatus = "SHIP" | "REVISE" | "BLOCKED" | "INCONCLUSIVE";

export interface AgentRole {
  readonly id: RoleId;
  readonly displayName: string;
  readonly description: string;
  readonly requiredCapabilities: readonly ProviderCapability[];
  readonly defaultReadOnly: boolean;
}

export interface AgentProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly authMode: ProviderAuthMode;
  readonly capabilities: readonly ProviderCapability[];
  readonly available: boolean;
  readonly model?: string;
  readonly warnings?: readonly string[];
}

export interface AgentTeamConfig {
  readonly writeMode: {
    readonly enabled: boolean;
    readonly requireIsolatedWorktree: boolean;
  };
  readonly auth: {
    readonly allowApiKeyFallback: boolean;
  };
}

export interface WorkspaceLease {
  readonly sourceCwd: string;
  readonly executionCwd: string;
  readonly branchName: string;
  readonly baseRef: string;
  readonly isolation: "git-worktree";
  readonly retention: "retain-until-integrated";
  readonly cleanup: "retained" | "removed";
}

export interface ImplementationWorkspaceInspection {
  readonly changedFiles: readonly string[];
  readonly statusSummary: readonly string[];
  readonly diffText?: string;
}

export interface ProviderSelectionRequest {
  readonly roleId: RoleId;
  readonly providers: readonly AgentProviderDescriptor[];
  readonly requestedProviderId?: string;
  readonly extraCapabilities?: readonly ProviderCapability[];
}

export interface AgentDispatchRequest {
  readonly role: RoleId;
  readonly task: string;
  readonly cwd: string;
  readonly provider?: string;
  readonly timeoutMs?: number;
}

export interface AgentDispatchResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly provider: string;
  readonly role: RoleId;
  readonly verdict: ParsedVerdict;
  readonly sidecarPath: string;
  readonly logPath: string;
}

export interface AgentMailboxPaths {
  readonly inbox: string;
  readonly outbox: string;
  readonly control: string;
  readonly events: string;
}

export interface AgentStartResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly provider: string;
  readonly role: RoleId;
  readonly sidecarPath: string;
  readonly logPath: string;
  readonly executionCwd?: string;
  readonly transcriptPath?: string;
  readonly mailboxPaths: AgentMailboxPaths;
}

export interface AgentControlResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly sidecarPath: string;
  readonly message: string;
}

export interface AgentMessageRequest {
  readonly runId: string;
  readonly cwd: string;
  readonly message: string;
  readonly messageType?: string;
  readonly correlationId?: string;
}

export interface AgentMessageResult {
  readonly runId: string;
  readonly status: "recorded_for_resume" | "delivered_live";
  readonly record: MailboxRecord;
  readonly message: string;
}

export interface AgentReplyRequest {
  readonly runId: string;
  readonly cwd: string;
  readonly message?: string;
  readonly messageType?: string;
  readonly correlationId?: string;
  readonly provider?: string;
  readonly timeoutMs?: number;
}

export interface AgentReplyResult extends AgentStartResult {
  readonly parentRunId: string;
  readonly resumedFromRunId: string;
  readonly providerSessionId: string;
}

export interface AgentOutboxRequestEvidence {
  readonly id: string;
  readonly sequence: number;
  readonly messageType: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly payload: unknown;
}

export interface ParsedVerdict {
  readonly status: VerdictStatus;
  readonly summary: string;
  readonly requiredChanges: readonly string[];
  readonly evidence: readonly string[];
  readonly risks: readonly string[];
  readonly warnings: readonly string[];
  readonly raw: string;
}

export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "awaiting-input"
  | "winding-down"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed"
  | "expired";

export interface RunSidecar {
  readonly runId: string;
  readonly role: RoleId;
  readonly provider: string;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly capabilitiesUsed: readonly ProviderCapability[];
  readonly evidencePaths: readonly string[];
  readonly providerSessionId?: string;
  readonly sourceCwd?: string;
  readonly executionCwd?: string;
  readonly workspaceIsolation?: "git-worktree";
  readonly workspaceRetention?: "retain-until-integrated";
  readonly workspaceCleanup?: "retained" | "removed";
  readonly workspaceStatus?: readonly string[];
  readonly workspaceDiffPath?: string;
  readonly parentRunId?: string;
  readonly resumedFromRunId?: string;
  readonly resumeSequence?: number;
  readonly model?: string;
  readonly authMode?: ProviderAuthMode;
  readonly promptHash?: string;
  readonly outputSummary?: string;
  readonly cleanup?: "complete" | "partial" | "not-needed";
  readonly inputClosed?: boolean;
  readonly windDownRequestedAt?: string;
  readonly awaitingInputSince?: string;
  readonly pendingOutboxRequest?: AgentOutboxRequestEvidence;
  readonly outboxRequestIds?: readonly string[];
  readonly detached?: boolean;
  readonly warnings?: readonly string[];
  readonly recentActivities?: readonly ProviderSessionActivity[];
  readonly currentActivity?: ProviderSessionActivity | null;
  readonly lastStderr?: readonly string[];
  readonly transcriptPath?: string;
  readonly logPath?: string;
  readonly verdict?: ParsedVerdict;
  readonly changedFiles?: readonly string[];
}

export type MailboxKind = "inbox" | "outbox" | "control" | "events";

export interface MailboxRecord {
  readonly sequence: number;
  readonly runId: string;
  readonly role: RoleId;
  readonly provider: string;
  readonly messageType: string;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly contentHash: string;
  readonly payload: unknown;
}
