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
  readonly model?: string;
  readonly authMode?: ProviderAuthMode;
  readonly promptHash?: string;
  readonly outputSummary?: string;
  readonly cleanup?: "complete" | "partial" | "not-needed";
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
