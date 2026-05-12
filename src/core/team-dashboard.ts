import type {
  AgentTeamDashboardCounts,
  AgentTeamDashboardIssue,
  AgentTeamDashboardResult,
  AgentTeamDashboardRow,
  AgentTeamDashboardSource,
  AgentTeamSummaryEvidence,
  AgentTeamSummaryOk,
  AgentTeamSummaryResult,
  AgentTeamSummaryRunState
} from "./types.js";

function plural(count: number, singular: string, pluralName = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralName}`;
}

function sourceLabel(source: AgentTeamDashboardSource): string {
  return source.kind === "team" ? `Team ${source.teamId}` : "Runs";
}

function cleanupStatus(
  run: AgentTeamSummaryRunState
): NonNullable<AgentTeamDashboardRow["cleanupStatus"]> {
  if (!run.retainedWorktree && run.workspaceCleanup === undefined) {
    return "not_applicable";
  }
  return run.workspaceCleanup === "removed" ? "removed" : "retained";
}

function latestActivity(
  run: AgentTeamSummaryRunState,
  evidence: AgentTeamSummaryEvidence
): string | undefined {
  const currentSummary = run.currentActivity?.summary;
  if (currentSummary !== undefined && currentSummary.trim().length > 0) {
    return currentSummary;
  }

  const recentSummary = [...(run.recentActivities ?? [])]
    .sort((left, right) => right.timestamp - left.timestamp)
    .find((activity) => activity.summary.trim().length > 0)?.summary;
  if (recentSummary !== undefined) {
    return recentSummary;
  }

  if (run.outputSummary !== undefined && run.outputSummary.trim().length > 0) {
    return run.outputSummary;
  }

  const verdictSummary = evidence.verdict?.summary;
  return verdictSummary === undefined || verdictSummary.trim().length === 0
    ? undefined
    : verdictSummary;
}

function evidencePaths(evidence: AgentTeamSummaryEvidence): readonly string[] {
  return [
    evidence.sidecarPath,
    ...(evidence.logPath === undefined ? [] : [evidence.logPath]),
    ...(evidence.transcriptPath === undefined ? [] : [evidence.transcriptPath]),
    ...(evidence.workspaceDiffPath === undefined ? [] : [evidence.workspaceDiffPath]),
    ...(evidence.evidencePaths ?? [])
  ];
}

function mailboxPaths(evidence: AgentTeamSummaryEvidence): readonly string[] {
  return ["inbox", "outbox", "control", "events"].map(
    (kind) => evidence.mailboxes[kind as keyof typeof evidence.mailboxes].path
  );
}

function okRow(result: AgentTeamSummaryOk): AgentTeamDashboardRow {
  const activity = latestActivity(result.run, result.evidence);
  return {
    status: "ok",
    index: result.index,
    runId: result.runId,
    cwd: result.cwd,
    ...(result.correlationId === undefined ? {} : { correlationId: result.correlationId }),
    role: result.run.role,
    provider: result.run.provider,
    runStatus: result.run.status,
    operationalState: result.run.operationalState,
    updatedAt: result.run.updatedAt,
    ...(result.run.awaitingInputSince === undefined
      ? {}
      : { awaitingInputSince: result.run.awaitingInputSince }),
    ...(activity === undefined ? {} : { latestActivity: activity }),
    pendingQuestion: result.run.pendingOutboxRequest !== undefined,
    retainedWorktree: result.run.retainedWorktree,
    cleanupBlocked: result.run.cleanupBlocked,
    cleanupStatus: cleanupStatus(result.run),
    evidencePaths: evidencePaths(result.evidence),
    mailboxPaths: mailboxPaths(result.evidence),
    ...(result.evidence.workspaceDiffPath === undefined
      ? {}
      : { workspaceDiffPath: result.evidence.workspaceDiffPath }),
    ...(result.evidence.changedFiles === undefined
      ? {}
      : { changedFiles: result.evidence.changedFiles })
  };
}

function rows(summary: AgentTeamSummaryResult): readonly AgentTeamDashboardRow[] {
  return summary.runs.map((result) => {
    if (result.status === "ok") {
      return okRow(result);
    }
    if (result.status === "state_corrupt") {
      return {
        status: "state_corrupt",
        index: result.index,
        runId: result.runId,
        cwd: result.cwd,
        ...(result.correlationId === undefined
          ? {}
          : { correlationId: result.correlationId }),
        recovery: result.recovery
      };
    }
    return {
      status: "failed",
      index: result.index,
      runId: result.runId,
      cwd: result.cwd,
      ...(result.correlationId === undefined ? {} : { correlationId: result.correlationId }),
      error: result.error
    };
  });
}

function counts(summary: AgentTeamSummaryResult): AgentTeamDashboardCounts {
  return {
    total: summary.runs.length,
    running: summary.groups.running.length,
    awaitingInput: summary.groups.awaitingInput.length,
    windingDown: summary.groups.windingDown.length,
    terminal: summary.groups.terminal.length,
    failed:
      summary.groups.failed.length +
      summary.runs.filter((run) => run.status === "failed").length,
    detached: summary.groups.detached.length,
    cleanupBlocked: summary.groups.cleanupBlocked.length,
    retainedWorktree: summary.groups.retainedWorktree.length,
    recovered: summary.runs.filter((run) => run.status === "state_corrupt").length
  };
}

function reportLine(row: AgentTeamDashboardRow): string {
  if (row.status === "failed") {
    return `[${row.index}] ${row.runId} failed error=${row.error ?? "unknown"}`;
  }
  if (row.status === "state_corrupt") {
    return `[${row.index}] ${row.runId} state_corrupt recovery=true`;
  }

  const details = [
    `[${row.index}]`,
    row.runId,
    row.role ?? "unknown-role",
    row.runStatus ?? "unknown-status",
    `question=${row.pendingQuestion === true}`,
    `updated ${row.updatedAt ?? "unknown"}`,
    ...(row.latestActivity === undefined ? [] : [`activity="${row.latestActivity}"`]),
    ...(row.cleanupStatus === undefined ? [] : [`cleanup=${row.cleanupStatus}`]),
    ...(row.evidencePaths?.[0] === undefined ? [] : [`sidecar=${row.evidencePaths[0]}`])
  ];
  return details.join(" ");
}

function report(
  source: AgentTeamDashboardSource,
  dashboardCounts: AgentTeamDashboardCounts,
  dashboardRows: readonly AgentTeamDashboardRow[]
): string {
  const headerParts = [
    `${sourceLabel(source)}: ${plural(dashboardCounts.total, "run")}`,
    `${dashboardCounts.running} running`,
    `${dashboardCounts.awaitingInput} awaiting input`,
    `${plural(dashboardCounts.retainedWorktree, "retained worktree")}`,
    `${dashboardCounts.cleanupBlocked} cleanup blocked`,
    `${dashboardCounts.recovered} recovered`
  ];
  return [headerParts.join(", ") + ".", ...dashboardRows.map(reportLine)].join("\n");
}

function emptyCounts(recovered = 0): AgentTeamDashboardCounts {
  return {
    total: 0,
    running: 0,
    awaitingInput: 0,
    windingDown: 0,
    terminal: 0,
    failed: 0,
    detached: 0,
    cleanupBlocked: 0,
    retainedWorktree: 0,
    recovered
  };
}

function issueReport(
  source: AgentTeamDashboardSource,
  issues: readonly AgentTeamDashboardIssue[]
): string {
  const header = `${sourceLabel(source)}: ${plural(issues.length, "issue")}.`;
  const lines = issues.map((issue, index) => {
    const recovery = issue.recovery as { readonly message?: unknown };
    return `[issue ${index}] ${issue.target} state_corrupt ${String(
      recovery.message ?? "user intervention required"
    )}`;
  });
  return [header, ...lines].join("\n");
}

export function buildAgentTeamDashboard(input: {
  readonly source: AgentTeamDashboardSource;
  readonly summary: AgentTeamSummaryResult;
  readonly generatedAt: string;
}): AgentTeamDashboardResult {
  const dashboardRows = rows(input.summary);
  const dashboardCounts = counts(input.summary);
  return {
    status: input.summary.status,
    source: input.source,
    generatedAt: input.generatedAt,
    counts: dashboardCounts,
    rows: dashboardRows,
    report: report(input.source, dashboardCounts, dashboardRows)
  };
}

export function buildAgentTeamDashboardStateCorrupt(input: {
  readonly source: AgentTeamDashboardSource;
  readonly issue: AgentTeamDashboardIssue;
  readonly generatedAt: string;
}): AgentTeamDashboardResult {
  const issues = [input.issue];
  return {
    status: "partial_failure",
    source: input.source,
    generatedAt: input.generatedAt,
    counts: emptyCounts(issues.length),
    rows: [],
    issues,
    report: issueReport(input.source, issues)
  };
}
