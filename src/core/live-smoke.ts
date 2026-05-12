export const CLAUDE_LIVE_SMOKE_PROVIDER = "claude-code-cli";
export const CLAUDE_LIVE_SMOKE_AUTH_MODE = "subscription-oauth";

export const CLAUDE_LIVE_SMOKE_TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_start_parallel",
  "agent_team_status_many",
  "agent_team_dashboard",
  "agent_team_summary",
  "agent_team_message_many",
  "agent_team_wind_down_many",
  "agent_team_status_many"
] as const;

export interface ClaudeLiveSmokePlannedRun {
  readonly role: "planner" | "code-reviewer";
  readonly provider: typeof CLAUDE_LIVE_SMOKE_PROVIDER;
  readonly correlationId: "live-planner" | "live-reviewer";
}

export interface ClaudeLiveSmokeDryRunReport {
  readonly status: "dry_run";
  readonly liveProviderUse: false;
  readonly workspaceRoot: string;
  readonly provider: typeof CLAUDE_LIVE_SMOKE_PROVIDER;
  readonly authMode: typeof CLAUDE_LIVE_SMOKE_AUTH_MODE;
  readonly toolFlow: typeof CLAUDE_LIVE_SMOKE_TOOL_FLOW;
  readonly requiredConfirmation: "--confirm-live-provider-use";
  readonly policyRequirement: "policy.liveSmokeEnabled must be true";
  readonly plannedRuns: readonly ClaudeLiveSmokePlannedRun[];
  readonly knownLimitations: readonly string[];
}

export const CLAUDE_LIVE_SMOKE_PLANNED_RUNS: readonly ClaudeLiveSmokePlannedRun[] = [
  {
    role: "planner",
    provider: CLAUDE_LIVE_SMOKE_PROVIDER,
    correlationId: "live-planner"
  },
  {
    role: "code-reviewer",
    provider: CLAUDE_LIVE_SMOKE_PROVIDER,
    correlationId: "live-reviewer"
  }
];

export const CLAUDE_LIVE_SMOKE_KNOWN_LIMITATIONS = [
  "This smoke proves transport and lifecycle mechanics only; it makes no provider ranking, comparative capability, or long-context claim.",
  "Live provider use is operator-triggered and is not part of CI.",
  "Only read-only roles are planned; implementation worktrees and cleanup are not exercised."
] as const;

export function buildClaudeLiveSmokeDryRunReport(input: {
  readonly workspaceRoot: string;
}): ClaudeLiveSmokeDryRunReport {
  return {
    status: "dry_run",
    liveProviderUse: false,
    workspaceRoot: input.workspaceRoot,
    provider: CLAUDE_LIVE_SMOKE_PROVIDER,
    authMode: CLAUDE_LIVE_SMOKE_AUTH_MODE,
    toolFlow: CLAUDE_LIVE_SMOKE_TOOL_FLOW,
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement: "policy.liveSmokeEnabled must be true",
    plannedRuns: CLAUDE_LIVE_SMOKE_PLANNED_RUNS,
    knownLimitations: CLAUDE_LIVE_SMOKE_KNOWN_LIMITATIONS
  };
}
