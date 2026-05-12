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

export type AgentExecutionPolicy = "read-only" | "isolated-edit";

export type VerdictStatus = "SHIP" | "REVISE" | "BLOCKED" | "INCONCLUSIVE";

export interface AgentRole {
  readonly id: RoleId;
  readonly displayName: string;
  readonly description: string;
  readonly requiredCapabilities: readonly ProviderCapability[];
  readonly defaultReadOnly: boolean;
  readonly executionPolicy: AgentExecutionPolicy;
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

export interface OpenAICompatibleProviderCapabilitiesConfig {
  readonly structuredOutput: boolean;
  readonly longContext: boolean;
  readonly reasoning: boolean;
}

export interface OpenAICompatibleProviderConfig {
  readonly enabled: boolean;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly displayName?: string;
  readonly capabilities: OpenAICompatibleProviderCapabilitiesConfig;
}

export interface OllamaCloudProfileConfig {
  readonly id: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly displayName?: string;
  readonly capabilities: OpenAICompatibleProviderCapabilitiesConfig;
}

export interface OllamaCloudProviderConfig {
  readonly enabled: boolean;
  readonly profiles: readonly OllamaCloudProfileConfig[];
}

export interface GrokProfileConfig {
  readonly id: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly displayName?: string;
  readonly capabilities: OpenAICompatibleProviderCapabilitiesConfig;
}

export interface GrokProviderConfig {
  readonly enabled: boolean;
  readonly profiles: readonly GrokProfileConfig[];
}

export interface GeminiProviderConfig {
  readonly enabled: boolean;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly displayName?: string;
  readonly capabilities: OpenAICompatibleProviderCapabilitiesConfig;
}

export interface AgentTeamProviderConfig {
  readonly openaiCompatible: OpenAICompatibleProviderConfig;
  readonly ollamaCloud: OllamaCloudProviderConfig;
  readonly grok: GrokProviderConfig;
  readonly gemini: GeminiProviderConfig;
}

export type ProviderSelectorSource = "request" | "role-pin" | "provider-order" | "default";

export interface ProviderRoutingPolicyConfig {
  readonly rolePins: Partial<Record<RoleId, string>>;
  readonly providerOrder: readonly string[];
}

export interface AgentTeamConfig {
  readonly writeMode: {
    readonly enabled: boolean;
    readonly requireIsolatedWorktree: boolean;
  };
  readonly auth: {
    readonly allowApiKeyFallback: boolean;
  };
  readonly routing: ProviderRoutingPolicyConfig;
  readonly providers: AgentTeamProviderConfig;
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
  readonly routingPolicy?: ProviderRoutingPolicyConfig;
}

export type ProviderSelectorKind = "id" | "family" | "model" | "capability";

export interface ProviderSelectionSelector {
  readonly source: ProviderSelectorSource;
  readonly value: string;
  readonly kind: ProviderSelectorKind;
  readonly target: string;
}

export type ProviderSelectionRejectionReason =
  | "unavailable"
  | "selector_mismatch"
  | "missing_capabilities";

export interface ProviderSelectionCandidate {
  readonly providerId: string;
  readonly available: boolean;
  readonly matchedSelector: boolean;
  readonly eligible: boolean;
  readonly missingCapabilities: readonly ProviderCapability[];
  readonly rejectionReason?: ProviderSelectionRejectionReason;
}

export interface ProviderSelectionExplanation {
  readonly ok: boolean;
  readonly requiredCapabilities: readonly ProviderCapability[];
  readonly selector?: ProviderSelectionSelector;
  readonly selectedProviderId?: string;
  readonly selectedProvider?: AgentProviderDescriptor;
  readonly candidates: readonly ProviderSelectionCandidate[];
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

export interface AgentParallelStartRun {
  readonly role: RoleId;
  readonly task: string;
  readonly cwd: string;
  readonly provider?: string;
  readonly timeoutMs?: number;
  readonly correlationId?: string;
}

export interface AgentParallelStartRequest {
  readonly batchId: string;
  readonly runs: readonly AgentParallelStartRun[];
  readonly concurrency: number;
}

export interface AgentParallelStartSuccess {
  readonly status: "started";
  readonly index: number;
  readonly correlationId?: string;
  readonly run: AgentStartResult;
}

export interface AgentParallelStartFailure {
  readonly status: "failed";
  readonly index: number;
  readonly correlationId?: string;
  readonly role: RoleId;
  readonly task: string;
  readonly error: string;
}

export type AgentParallelStartRunResult =
  | AgentParallelStartSuccess
  | AgentParallelStartFailure;

export interface AgentParallelStartResult {
  readonly status: "started" | "partial_failure";
  readonly batchId: string;
  readonly concurrency: number;
  readonly runs: readonly AgentParallelStartRunResult[];
}

export interface AgentStatusManyRun {
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
}

export interface AgentStatusManyRequest {
  readonly runs: readonly AgentStatusManyRun[];
  readonly concurrency: number;
}

export interface AgentStatusManyOk {
  readonly status: "ok";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly run: RunSidecar;
}

export interface AgentStatusManyFailed {
  readonly status: "failed";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly error: string;
}

export interface AgentStatusManyRecovered {
  readonly status: "state_corrupt";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly recovery: unknown;
}

export type AgentStatusManyItem =
  | AgentStatusManyOk
  | AgentStatusManyFailed
  | AgentStatusManyRecovered;

export interface AgentStatusManyResult {
  readonly status: "ok" | "partial_failure";
  readonly runs: readonly AgentStatusManyItem[];
}

export interface AgentTeamSummaryRunRequest {
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
}

export interface AgentTeamSummaryRequest {
  readonly runs: readonly AgentTeamSummaryRunRequest[];
  readonly concurrency: number;
}

export type AgentTeamSummaryOperationalState =
  | "running"
  | "awaitingInput"
  | "windingDown"
  | "terminal";

export interface AgentTeamSummaryGroups {
  readonly running: readonly string[];
  readonly awaitingInput: readonly string[];
  readonly windingDown: readonly string[];
  readonly terminal: readonly string[];
  readonly failed: readonly string[];
  readonly detached: readonly string[];
  readonly cleanupBlocked: readonly string[];
  readonly retainedWorktree: readonly string[];
}

export interface AgentTeamSummaryMailboxEvidence {
  readonly path: string;
  readonly count: number;
  readonly lastSequence?: number;
}

export interface AgentTeamSummaryEvidence {
  readonly sidecarPath: string;
  readonly mailboxes: Record<MailboxKind, AgentTeamSummaryMailboxEvidence>;
  readonly logPath?: string;
  readonly transcriptPath?: string;
  readonly workspaceDiffPath?: string;
  readonly workspaceStatus?: readonly string[];
  readonly evidencePaths?: readonly string[];
  readonly changedFiles?: readonly string[];
  readonly verdict?: ParsedVerdict;
}

export interface AgentTeamSummaryRunState {
  readonly runId: string;
  readonly role: RoleId;
  readonly provider: string;
  readonly status: RunStatus;
  readonly operationalState: AgentTeamSummaryOperationalState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly detached: boolean;
  readonly retainedWorktree: boolean;
  readonly cleanupBlocked: boolean;
  readonly detachedAt?: string;
  readonly sourceCwd?: string;
  readonly executionCwd?: string;
  readonly workspaceBranchName?: string;
  readonly workspaceBaseRef?: string;
  readonly workspaceIsolation?: "git-worktree";
  readonly workspaceRetention?: "retain-until-integrated";
  readonly workspaceCleanup?: "retained" | "removed";
  readonly workspaceStatus?: readonly string[];
  readonly awaitingInputSince?: string;
  readonly pendingOutboxRequest?: AgentOutboxRequestEvidence;
  readonly outboxRequestIds?: readonly string[];
  readonly warnings?: readonly string[];
}

export interface AgentTeamSummaryOk {
  readonly status: "ok";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly run: AgentTeamSummaryRunState;
  readonly evidence: AgentTeamSummaryEvidence;
}

export interface AgentTeamSummaryFailed {
  readonly status: "failed";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly error: string;
}

export interface AgentTeamSummaryRecovered {
  readonly status: "state_corrupt";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly recovery: unknown;
}

export type AgentTeamSummaryRunResult =
  | AgentTeamSummaryOk
  | AgentTeamSummaryFailed
  | AgentTeamSummaryRecovered;

export interface AgentTeamSummaryResult {
  readonly status: "ok" | "partial_failure";
  readonly groups: AgentTeamSummaryGroups;
  readonly runs: readonly AgentTeamSummaryRunResult[];
}

export interface AgentTeamRunRef {
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
}

export interface AgentTeamRecord {
  readonly teamId: string;
  readonly name?: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runs: readonly AgentTeamRunRef[];
  readonly evidencePath: string;
}

export interface AgentTeamCreateRequest {
  readonly cwd: string;
  readonly name?: string;
  readonly description?: string;
  readonly runs: readonly AgentTeamRunRef[];
}

export interface AgentTeamCreateResult {
  readonly status: "created";
  readonly team: AgentTeamRecord;
}

export interface AgentTeamGetRequest {
  readonly cwd: string;
  readonly teamId: string;
}

export interface AgentTeamGetResult {
  readonly status: "ok";
  readonly team: AgentTeamRecord;
}

export interface AgentTeamListResult {
  readonly status: "ok";
  readonly teams: readonly AgentTeamRecord[];
}

export interface AgentMessageManyItemRequest {
  readonly runId: string;
  readonly cwd: string;
  readonly message: string;
  readonly messageType?: string;
  readonly correlationId?: string;
}

export interface AgentMessageManyRequest {
  readonly messages: readonly AgentMessageManyItemRequest[];
  readonly concurrency: number;
}

export interface AgentMessageManyOk {
  readonly status: "ok";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly result: AgentMessageResult;
}

export interface AgentMessageManyFailed {
  readonly status: "failed";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly error: string;
}

export interface AgentMessageManyRecovered {
  readonly status: "state_corrupt";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly recovery: unknown;
}

export type AgentMessageManyItem =
  | AgentMessageManyOk
  | AgentMessageManyFailed
  | AgentMessageManyRecovered;

export interface AgentMessageManyResult {
  readonly status: "ok" | "partial_failure";
  readonly messages: readonly AgentMessageManyItem[];
}

export interface AgentWindDownManyRun {
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
}

export interface AgentWindDownManyRequest {
  readonly runs: readonly AgentWindDownManyRun[];
  readonly concurrency: number;
}

export interface AgentWindDownManyOk {
  readonly status: "ok";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly result: AgentControlResult;
}

export interface AgentWindDownManyFailed {
  readonly status: "failed";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly error: string;
}

export interface AgentWindDownManyRecovered {
  readonly status: "state_corrupt";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly recovery: unknown;
}

export type AgentWindDownManyItem =
  | AgentWindDownManyOk
  | AgentWindDownManyFailed
  | AgentWindDownManyRecovered;

export interface AgentWindDownManyResult {
  readonly status: "ok" | "partial_failure";
  readonly runs: readonly AgentWindDownManyItem[];
}

export interface AgentCancelManyRun {
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
}

export interface AgentCancelManyRequest {
  readonly runs: readonly AgentCancelManyRun[];
  readonly concurrency: number;
}

export interface AgentCancelManyOk {
  readonly status: "ok";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly result: AgentControlResult;
}

export interface AgentCancelManyFailed {
  readonly status: "failed";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly error: string;
}

export interface AgentCancelManyRecovered {
  readonly status: "state_corrupt";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly recovery: unknown;
}

export type AgentCancelManyItem =
  | AgentCancelManyOk
  | AgentCancelManyFailed
  | AgentCancelManyRecovered;

export interface AgentCancelManyResult {
  readonly status: "ok" | "partial_failure";
  readonly runs: readonly AgentCancelManyItem[];
}

export interface AgentControlResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly sidecarPath: string;
  readonly message: string;
  readonly detached?: boolean;
  readonly detachedAt?: string;
}

export interface AgentCleanupRequest {
  readonly runId: string;
  readonly cwd: string;
  readonly force: boolean;
}

export interface AgentCleanupResult {
  readonly runId: string;
  readonly status: "removed" | "blocked" | "failed";
  readonly sidecarPath: string;
  readonly message: string;
  readonly workspaceCleanup?: "retained" | "removed";
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
  readonly workspaceBranchName?: string;
  readonly workspaceBaseRef?: string;
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
  readonly detachedAt?: string;
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
