const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "expired", "cancelled"]);
const SUCCESSFUL_CLAUDE_LIVE_STATUSES = new Set(["completed"]);
const REQUEST_TIMEOUT_BUFFER_MS = 15_000;

export function runStatus(item) {
  return item?.run?.status ?? item?.status;
}

export function isTerminalRunStatus(status) {
  return typeof status === "string" && TERMINAL_RUN_STATUSES.has(status);
}

export function isClaudeLiveSmokeSuccessfulStatus(status) {
  return typeof status === "string" && SUCCESSFUL_CLAUDE_LIVE_STATUSES.has(status);
}

export function compactStatusRows(statusResult) {
  return (Array.isArray(statusResult?.runs) ? statusResult.runs : []).map((item) => ({
    runId: item?.runId,
    role: item?.run?.role,
    correlationId: item?.correlationId,
    status: runStatus(item),
    verdict: item?.run?.verdict?.verdict,
    sidecarPath: item?.run?.sidecarPath,
    logPath: item?.run?.logPath,
    transcriptPath: item?.run?.transcriptPath,
    evidencePaths: item?.run?.evidencePaths,
    cleanup: item?.run?.cleanup,
    workspaceCleanup: item?.run?.workspaceCleanup
  }));
}

export function hasAllCompletedRuns(statusResult) {
  const rows = compactStatusRows(statusResult);
  return rows.length > 0 && rows.every((row) => isClaudeLiveSmokeSuccessfulStatus(row.status));
}

export function buildLiveSmokeReportStatus(rows) {
  return rows.length > 0 && rows.every((row) => isClaudeLiveSmokeSuccessfulStatus(row.status))
    ? "completed"
    : "failed";
}

export function buildToolRequestOptions(timeoutMs) {
  const boundedTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : REQUEST_TIMEOUT_BUFFER_MS;
  const totalTimeoutMs = boundedTimeoutMs + REQUEST_TIMEOUT_BUFFER_MS;
  return {
    timeout: totalTimeoutMs,
    maxTotalTimeout: totalTimeoutMs,
    resetTimeoutOnProgress: true
  };
}

export function nonTerminalRunRefs(statusResult, fallbackRefs) {
  const statusByRunId = new Map();
  for (const item of Array.isArray(statusResult?.runs) ? statusResult.runs : []) {
    if (typeof item?.runId === "string") {
      statusByRunId.set(item.runId, runStatus(item));
    }
  }
  return fallbackRefs.filter((ref) => {
    const status = statusByRunId.get(ref.runId);
    return !isTerminalRunStatus(status);
  });
}
