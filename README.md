# Codex Plugin Claude Agent Team

Provider-neutral Agent Team MCP plugin for Codex. The plugin lets Codex start, inspect, message, wind down, and clean up durable external agent runs while Codex remains the orchestrator and final integration authority.

Claude Code CLI subscription OAuth is the primary v1 transport. The core stays provider-neutral so future providers can plug into the same roles, lifecycle, mailbox, verdict, status, cleanup, and evidence contracts.

## Safety Model

- MCP is the public product boundary.
- Every run has a durable sidecar, mailbox records, logs, transcript paths, verdicts, and cleanup metadata.
- `slice-implementer` writes only in a retained isolated worktree.
- Codex reviews and integrates implementation diffs.
- Cleanup is explicit through `agent_team_cleanup`.
- Live provider usage is an opt-in live smoke and is not part of CI.

## Prerequisites

- Node.js 22 or newer.
- npm.
- Git.
- Claude Code CLI installed and authenticated with Claude Code CLI subscription OAuth.
- A workspace where `.agent-team/` state can be written.

## Local Installation

From this private repository:

```bash
npm ci
npm run build
npm run smoke:mcp-stdio
```

The built executable is exposed as the `agent-team-mcp` package bin and points to `"./dist/index.js"`.

## MCP Configuration

The repo ships `.mcp.json` for local use:

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

Run `npm run build` before using this packaged runtime entrypoint.

## Workspace Config

The default posture is read-only. Isolated implementation runs require explicit workspace config in `.agent-team/config.json`:

```json
{
  "writeMode": {
    "enabled": true,
    "requireIsolatedWorktree": true
  },
  "auth": {
    "allowApiKeyFallback": false
  }
}
```

Keep `requireIsolatedWorktree` enabled for write-capable roles. Retained implementation worktrees are review evidence until explicit cleanup.

## Auth And Doctor

Before starting live runs, call `agent_team_doctor` for the target workspace. Doctor checks host readiness, package/runtime shape, writable state, git/worktree readiness when needed, provider health, auth posture, and role routing.

Do not route around doctor failures. Claude Code CLI subscription OAuth remains the intended v1 path.

## Basic Workflow

1. Build and smoke the packaged runtime with `npm run build` and `npm run smoke:mcp-stdio`.
2. Run `agent_team_doctor`.
3. Start a bounded team with `agent_team_start_parallel`.
4. Read state with `agent_team_status_many`.
5. Inspect grouped evidence with `agent_team_summary`.
6. Send updates with `agent_team_message_many`.
7. Gracefully finalize with `agent_team_wind_down_many`.
8. Review evidence and retained implementation worktrees.
9. Use `agent_team_cleanup` only after review.

For a full operator flow, see `docs/runbooks/claude-team-session.md`.

## Evidence

Treat these as first-class records:

- sidecars under `.agent-team/runs/`
- JSONL mailboxes under `.agent-team/mailboxes/`
- logs and transcripts
- parsed verdicts
- workspace diff paths
- changed files
- recovery archive paths from `state_corrupt` results

## Troubleshooting

- Run `npm run ci` to reproduce the full local release gate.
- If MCP launch fails, run `npm run build` and `npm run smoke:mcp-stdio`.
- If live runs fail preflight, run `agent_team_doctor` and address the reported readiness item.
- If a result is `partial_failure`, inspect each per-run item by `index`, `runId`, `cwd`, and `correlationId`.
- If a result is `state_corrupt`, preserve the archive path and repair state before continuing.
- If cleanup is blocked, review the retained implementation worktree and diff evidence before calling `agent_team_cleanup`.

## Release Gate

Every integrated change should pass:

```bash
npm run ci
```

`npm run ci` runs typecheck, tests, build, and packaged stdio smoke in that order.
