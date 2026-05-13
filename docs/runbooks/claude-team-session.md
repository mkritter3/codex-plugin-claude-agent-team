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
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:gemini
npm run ci
```

These commands are CI-safe. They verify package/runtime wiring and fixture behavior without starting a live Claude session.

`npm run install:check` emits an absolute MCP config and ordered install checks. It does not call providers, read credentials, or start live runs.

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
npm run install:check
```

Use the `mcpConfig` field from the install handoff report when the Codex client needs absolute paths instead of the repository-relative `.mcp.json`.

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
  "schemaVersion": 1,
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

`schemaVersion` is optional for old local workspaces and defaults to `1`. If doctor reports an unsupported future config schema, upgrade this plugin before operating that workspace.

When `auditEnabled` is true, dispatch and lifecycle start decisions write sanitized records to `.agent-team/audit/events.jsonl` before provider execution. Treat those records as operator evidence for allow/block decisions, not as transcripts.

## State Layout Check

Doctor also inspects `.agent-team/state-layout.json` when present. Missing markers are compatible with layout version `1`; current markers are compatible; future layout versions fail closed; corrupt markers require operator review. Doctor is read-only for this check and does not auto-migrate or repair state.

## Ollama Claude Code Profiles

Use `providers.ollamaClaudeCode` when you want Claude Code to route through Ollama's direct Anthropic-compatible Cloud endpoint while preserving the existing Agent Team lifecycle. The user supplies one plugin-level token, usually `OLLAMA_API_KEY`; profile config stays non-secret and names the endpoint, model, display name, and declared capabilities. The Cloud route uses `https://ollama.com` directly and does not require a local Ollama daemon or Ollama CLI.

```json
{
  "schemaVersion": 1,
  "providers": {
    "ollamaClaudeCode": {
      "enabled": true,
      "baseUrl": "https://ollama.com",
      "apiKeyEnv": "OLLAMA_API_KEY",
      "profiles": [
        {
          "id": "kimi-k2.6",
          "model": "kimi-k2.6",
          "displayName": "Kimi K2.6",
          "writeValidated": false,
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true
          }
        },
        {
          "id": "glm-5.1",
          "model": "glm-5.1",
          "displayName": "GLM 5.1",
          "writeValidated": false,
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true
          }
        },
        {
          "id": "deepseek-v4-flash",
          "model": "deepseek-v4-flash",
          "displayName": "DeepSeek V4 Flash",
          "writeValidated": false,
          "capabilities": {
            "structuredOutput": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true
          }
        }
      ]
    }
  },
  "policy": {
    "allowedRoles": ["planner", "code-reviewer"],
    "allowedProviderSelectors": ["family:ollama-claude-code"],
    "allowWriteMode": false,
    "liveSmokeEnabled": false,
    "auditEnabled": true
  }
}
```

The resulting provider ids are explicit, such as `ollama-claude-code:kimi-k2.6`. At provider launch, the runtime creates a scoped provider env for that run only: `ANTHROPIC_BASE_URL` points at `https://ollama.com`, `ANTHROPIC_AUTH_TOKEN` carries the configured Ollama token, `ANTHROPIC_API_KEY` is intentionally blank for Claude Code compatibility, and `OLLAMA_API_KEY` remains available as the single secret source. The normal `claude-code-cli` provider continues to use Claude Code CLI subscription OAuth and keeps its auth-precedence checks.

Keep `writeValidated` false until a live implementation proof validates edits, isolated worktree containment, mailbox delivery, wind-down, cancellation, cleanup, and source-checkout cleanliness for the exact profile. Enabling write capabilities is an operator proof gate and not a provider ranking, provider comparison, or model-quality claim.

## Opt-In Live Smoke

This section is the opt-in live smoke. It is not part of CI because it uses local subscription credentials and may start external provider processes.

Use a small, disposable workspace task first. Keep the requested roles read-only unless you intentionally enable isolated implementation mode in `.agent-team/config.json`.

Inspect the public MCP tool flow without provider use:

```bash
npm run smoke:claude-live -- --dry-run --cwd /absolute/path/to/workspace
```

For a real local smoke, the target workspace must explicitly set `policy.liveSmokeEnabled`:

```json
{
  "schemaVersion": 1,
  "policy": {
    "allowedRoles": ["planner", "code-reviewer"],
    "allowedProviderSelectors": ["claude-code-cli"],
    "allowWriteMode": false,
    "allowedWorktreeRoots": [],
    "liveSmokeEnabled": true,
    "auditEnabled": true
  }
}
```

Then run the confirmed smoke:

```bash
npm run build
npm run smoke:claude-live -- --confirm-live-provider-use --cwd /absolute/path/to/workspace
```

The smoke uses Claude Code CLI subscription OAuth through the packaged MCP stdio runtime. Its sanitized report includes direct proof, run ids, statuses, evidence paths, summary groups, dashboard counts, message status, wind-down status, cleanup status, and known limitations. It does not print private prompts, provider command details, provider session ids, process metadata, environment values, mailbox payloads, secrets, provider ranking claims, or comparative capability claims.

The smoke exits `0` only when tracked Claude runs reach `completed`. Graceful wind-down states are useful evidence, but they are not successful completion. If the bounded wait expires, the harness asks remaining runs to wind down, records cancellation intent for lingering nonterminal runs, emits a sanitized failed report, and preserves sidecars, logs, transcripts, and retained worktrees for inspection.

## Opt-In Claude Live Capability Matrix

Run the capability matrix before treating the Claude-backed control plane as ready for write-capable provider expansion. It is not part of CI, uses public packaged MCP tools only, and validates control-plane behavior rather than provider quality.

Inspect the planned flow without provider use:

```bash
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
```

For a real local matrix, the workspace policy must allow live smoke, the Claude provider selector, and isolated worktree creation for `slice-implementer`:

```json
{
  "schemaVersion": 1,
  "writeMode": {
    "enabled": true,
    "requireIsolatedWorktree": true
  },
  "policy": {
    "allowedRoles": ["planner", "code-reviewer", "slice-implementer"],
    "allowedProviderSelectors": ["claude-code-cli"],
    "allowWriteMode": true,
    "allowedWorktreeRoots": ["/absolute/path/to/.agent-team-worktrees"],
    "liveSmokeEnabled": true,
    "auditEnabled": true
  }
}
```

Then run the confirmed matrix:

```bash
npm run build
npm run smoke:claude-live-matrix -- --confirm-live-provider-use --cwd /absolute/path/to/workspace
```

The matrix covers direct dispatch, bounded read-only parallel starts, active mailbox delivery, graceful wind-down, explicit cancel, isolated worktree implementation, retained diff handoff, team record creation, dashboard, summary, cleanup, and policy failure for a disallowed write root. Its sanitized report includes run ids, roles, provider ids, terminal states, evidence paths, changed files, cleanup states, dashboard counts, summary groups, policy-failure status, and known limitations. It does not print prompts, provider command details, provider session ids, raw provider payloads, environment values, command args, mailbox payloads, secrets, or no provider ranking evidence.

## Opt-In Read-Only Provider Proof Smoke

Use this proof only for explicitly configured non-Claude read-only providers. It is not part of CI and does not replace the Claude Code CLI subscription OAuth v1 path. It proves explicit read-only provider routing, dispatch evidence, dashboard evidence, and summary evidence only; it makes no provider comparison, ranking, score, or long-context claim.

Inspect the public MCP flow without provider use:

```bash
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:gemini
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:ollama-claude-code
```

For a real local proof, configure the provider and policy first:

```json
{
  "schemaVersion": 1,
  "policy": {
    "allowedRoles": ["code-reviewer"],
    "allowedProviderSelectors": ["family:gemini"],
    "allowWriteMode": false,
    "allowedWorktreeRoots": [],
    "liveSmokeEnabled": true,
    "auditEnabled": true
  }
}
```

Then run the confirmed proof:

```bash
npm run build
npm run smoke:providers-live -- --confirm-live-provider-use --cwd /absolute/path/to/workspace --provider family:gemini --concurrency 1
```

The provider proof uses packaged MCP stdio plus `agent_team_doctor`, `agent_team_list_providers`, `agent_team_dispatch`, `agent_team_dashboard`, and `agent_team_summary`. Its sanitized report includes provider selectors, selected provider ids, auth mode, run ids, sidecar/log paths, dashboard counts, summary groups, and known limitations. It does not print prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets.

## Opt-In Ollama Write Validation

Use this proof before enabling write-capable Ollama Claude Code profiles in normal workspaces. It creates a disposable git fixture for each exact `ollama-claude-code:<profile-id>` selector, enables `writeValidated: true` only in that fixture, starts a `slice-implementer`, verifies `OLLAMA_WRITE_PROOF.txt` exists only in the isolated execution worktree, records dashboard and summary evidence, and removes the retained worktree with `agent_team_cleanup`.

Inspect without provider use:

```bash
npm run smoke:ollama-write -- --dry-run --provider ollama-claude-code:kimi-k2.6
```

Run after building:

```bash
npm run build
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:kimi-k2.6
```

The report includes provider ids, run ids, terminal status, changed files, worktree containment, cleanup status, dashboard counts, summary groups, sidecar/log paths, and known limitations. It does not print prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets. A passing run proves isolated write containment for the selected provider only; it is not a model-quality, ranking, or broad autonomous-implementation claim.

In this repository, `kimi-k2.6`, `glm-5.1`, and `deepseek-v4-flash` have passed this disposable-fixture write validation through the packaged MCP path. Keep any other Ollama Claude Code profile read-only until it passes the same proof.

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

1. Run fixture-safe verification with `npm run build`, `npm run install:check`, `npm run smoke:mcp-stdio`, `npm run smoke:package`, and `npm run ci`.
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
