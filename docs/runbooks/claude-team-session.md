# Claude Team Session Runbook

This runbook shows how to operate an Agent Team MCP session from Codex with Claude Code CLI subscription OAuth as the primary v1 transport. It uses only public MCP tools and durable `.agent-team/` evidence. It does not require prior chat history.

## Safety Model

- Codex remains the orchestrator, reviewer, integrator, and final authority.
- The MCP server is the control-plane boundary.
- Each agent run is individually addressable by run id.
- Sidecars, logs, transcripts, mailboxes, verdicts, workspace diffs, changed files, and recovery records are evidence.
- Implementation agents work in a retained implementation worktree and require human/Codex review before cleanup.
- Live provider use is an opt-in live smoke and is not part of CI.

## Fixture-Safe Verification

Run these before changing installation or docs examples:

```bash
npm run build
npm run smoke:mcp-stdio
npm run ci
```

These commands are CI-safe. They verify package/runtime wiring and fixture behavior without starting a live Claude session.

## MCP Configuration Check

The packaged MCP entrypoint is:

```json
{
  "mcpServers": {
    "agent-team": {
      "command": "node",
      "args": ["./dist/index.js"]
    }
  }
}
```

Build before using that entrypoint:

```bash
npm run build
```

## Doctor Preflight

Before any live dispatch, call `agent_team_doctor` for the workspace:

```json
{
  "cwd": "/absolute/path/to/workspace"
}
```

Proceed only when doctor reports the workspace, package runtime, provider routing, policy posture, and Claude Code CLI subscription OAuth posture are ready. If doctor reports a failure, fix that issue first. Do not route around the preflight with a different billing or transport path.

Workspace policy can restrict role starts, provider selectors, write-capable starts, retained worktree roots, and live-smoke posture through `.agent-team/config.json`:

```json
{
  "policy": {
    "allowedRoles": ["planner", "code-reviewer"],
    "allowedProviderSelectors": ["claude-code-cli"],
    "allowWriteMode": false,
    "allowedWorktreeRoots": [],
    "liveSmokeEnabled": false,
    "auditEnabled": true
  }
}
```

When `auditEnabled` is true, dispatch and lifecycle start decisions write sanitized records to `.agent-team/audit/events.jsonl` before provider execution. Treat those records as operator evidence for allow/block decisions, not as transcripts.

## Opt-In Live Smoke

This section is the opt-in live smoke. It is not part of CI because it uses local subscription credentials and may start external provider processes.

Use a small, disposable workspace task first. Keep the requested roles read-only unless you intentionally enable isolated implementation mode in `.agent-team/config.json`.

## Start A Team

Use `agent_team_start_parallel` to start a bounded team:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "concurrency": 3,
  "runs": [
    {
      "role": "planner",
      "task": "Review the requested change and identify the safest implementation slices.",
      "correlationId": "plan"
    },
    {
      "role": "debugger",
      "task": "Inspect likely failure modes and list concrete verification commands.",
      "correlationId": "debug"
    },
    {
      "role": "test-designer",
      "task": "Design focused regression tests for the requested change.",
      "correlationId": "tests"
    }
  ]
}
```

Record the returned run ids. Every control call still uses run ids directly.

## Create A Team Record

Use `agent_team_create_team` when you want a durable index for the related run ids:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "name": "Roadmap Review Team",
  "description": "Planner, debugger, and test-designer review for one bounded change.",
  "runs": [
    { "runId": "run_planner", "correlationId": "plan" },
    { "runId": "run_debugger", "correlationId": "debug" },
    { "runId": "run_tests", "correlationId": "tests" }
  ]
}
```

Team records live under `.agent-team/teams/` and contain grouping metadata only. Per-run sidecars remain authoritative for status, verdicts, cleanup state, and evidence paths.

Later, use `agent_team_get_team` or `agent_team_list_teams` to recover the run refs:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "teamId": "team_example"
}
```

## Inspect Status

Use the team record's `runs` array with `agent_team_status_many` for per-run status:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "runs": [
    { "runId": "run_planner", "correlationId": "plan" },
    { "runId": "run_debugger", "correlationId": "debug" },
    { "runId": "run_tests", "correlationId": "tests" }
  ]
}
```

Status results show durable sidecar state. Treat `awaiting-input` as a request for operator input, not as a failure.

## Open The Team Dashboard

Use `agent_team_dashboard` for a read-only dashboard that combines a team record or explicit run refs with compact counts, ordered rows, mailbox pointers, cleanup state, and evidence paths:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "teamId": "team_example"
}
```

You can also pass the same `runs` array used by `agent_team_status_many` when you do not have a saved team record. The dashboard is an operator view only; it does not start, resume, message, cancel, wind down, clean up, or call providers.

If the dashboard encounters corrupt team, sidecar, or mailbox state, it reports `state_corrupt` evidence and leaves the inspected artifact in place for review. Use the dedicated recovery/control tools when you intentionally want state repair or lifecycle mutation.

## Inspect The Team Summary

Use the team record's `runs` array with `agent_team_summary` for the compact team view:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "runs": [
    { "runId": "run_planner", "correlationId": "plan" },
    { "runId": "run_debugger", "correlationId": "debug" },
    { "runId": "run_tests", "correlationId": "tests" }
  ]
}
```

Important groups:

- `running`: work is still active.
- `awaitingInput`: a run is waiting for a mailbox response.
- `windingDown`: graceful finalization was requested.
- `terminal`: the run is completed, cancelled, failed, or expired.
- `failed`: the run reached a failed terminal state.
- `detached`: no live process handle is attached, but durable state remains.
- `retainedWorktree`: an implementation run has retained workspace evidence.
- `cleanupBlocked`: a terminal retained implementation worktree still needs review before cleanup.

## Message Agents In Flight

Use `agent_team_message_many` to provide evidence or direction without resuming sessions one by one:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "messages": [
    {
      "runId": "run_planner",
      "message": "Use the roadmap and L11 quality gate as the source of truth.",
      "messageType": "operator_update",
      "correlationId": "plan-update"
    },
    {
      "runId": "run_tests",
      "message": "Include packaged stdio smoke and state recovery in the verification plan.",
      "messageType": "operator_update",
      "correlationId": "tests-update"
    }
  ]
}
```

The result may be `delivered_live` or `recorded_for_resume`. Both are durable outcomes. A `partial_failure` response keeps per-run evidence and does not imply later items were skipped.

Team records do not message agents by themselves. They only provide run refs that you can place into the existing batch tools.

## Reply To Awaiting Input

If a status or summary result shows `awaiting-input`, inspect the pending outbox request and respond with the single-run reply or message tool as appropriate. Keep the response scoped to the run id that asked the question.

## Wind Down The Team

Use `agent_team_wind_down_many` when the team should wrap up gracefully:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "runs": [
    { "runId": "run_planner", "correlationId": "plan" },
    { "runId": "run_debugger", "correlationId": "debug" },
    { "runId": "run_tests", "correlationId": "tests" }
  ]
}
```

Wind-down is not cancellation. It asks active runs to finalize, preserves evidence, and leaves retained implementation worktrees untouched.

## Review Evidence

After runs are terminal or winding down, inspect evidence paths surfaced by status and summary:

- sidecar path
- log path
- transcript path
- mailbox paths for inbox, outbox, control, and events
- policy audit records under `.agent-team/audit/events.jsonl`
- verdict
- workspace diff path
- changed files
- recovery archive path when a result is `state_corrupt`

If any batch call returns `partial_failure`, inspect each item by `index`, `runId`, `cwd`, and `correlationId`. Later items may still be valid even when one item failed.

## Retained Implementation Worktree Cleanup

Only use `agent_team_cleanup` after Codex or the operator has reviewed the retained implementation worktree and its diff evidence.

```json
{
  "cwd": "/absolute/path/to/workspace",
  "runId": "run_implementer",
  "force": true
}
```

Cleanup is explicit because retained implementation worktree content is review evidence. A cleanup-blocked run should stay blocked until its diff has been inspected and either integrated or rejected.

## Recovery Triage

If a tool result returns `state_corrupt`, use the recovery evidence before continuing:

- `originalPath`: the corrupt state file or mailbox
- `archivePath`: the preserved archive copy
- `kind`: `json` or `jsonl`
- `operation`: the MCP operation that encountered the corruption
- `interventionRequired`: whether the operator must inspect before continuing

Do not overwrite state by hand. Preserve the archive and re-run the relevant read-only status or summary call after repair.

## Practical Session Checklist

1. Run fixture-safe verification with `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci`.
2. Build the package before using the packaged MCP entrypoint.
3. Run `agent_team_doctor` against the target workspace.
4. Start a small team with `agent_team_start_parallel`.
5. Poll with `agent_team_status_many`.
6. Summarize with `agent_team_summary`.
7. Send updates with `agent_team_message_many`.
8. Respond to `awaiting-input` runs.
9. Gracefully finalize with `agent_team_wind_down_many`.
10. Review sidecars, mailboxes, verdicts, logs, transcripts, diffs, changed files, and recovery records.
11. Use `agent_team_cleanup` only after retained implementation worktree review.
