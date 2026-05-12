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

OpenAI-compatible providers are disabled by default and never inferred from environment variables. To use the foundation adapter for synchronous read-only dispatch, opt in explicitly with provider-scoped endpoint/model/auth-env config and only the capabilities the endpoint can actually satisfy:

```json
{
  "providers": {
    "openaiCompatible": {
      "enabled": true,
      "baseUrl": "https://provider.example/v1",
      "model": "review-model",
      "apiKeyEnv": "PROVIDER_API_KEY",
      "displayName": "Review Model",
      "capabilities": {
        "structuredOutput": true,
        "longContext": false,
        "reasoning": false
      }
    }
  }
}
```

The foundation adapter does not support background sessions, live stdin, resume, cancellation, edits, tools, or workspace isolation.

Ollama Cloud profiles are an explicit OpenAI-compatible profile layer. They are also disabled by default and can represent Kimi/GLM-style read-only review models without adding provider-specific MCP tools:

```json
{
  "providers": {
    "ollamaCloud": {
      "enabled": true,
      "profiles": [
        {
          "id": "kimi-k2.6",
          "baseUrl": "https://ollama.example/v1",
          "model": "kimi-k2.6",
          "apiKeyEnv": "KIMI_API_KEY",
          "displayName": "Kimi K2.6",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": false
          }
        },
        {
          "id": "glm-5.1",
          "baseUrl": "https://ollama.example/v1",
          "model": "glm-5.1",
          "apiKeyEnv": "GLM_API_KEY",
          "displayName": "GLM 5.1",
          "capabilities": {
            "structuredOutput": true,
            "longContext": false,
            "reasoning": false
          }
        }
      ]
    }
  }
}
```

Profile provider ids use `ollama-cloud:<profile-id>`, for example `ollama-cloud:kimi-k2.6`. Profiles support synchronous read-only dispatch only; run live smoke separately before making any real-provider readiness, model-quality, or long-context claims.

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
8. Use `agent_team_cancel_many` only for explicit operator-driven cancellation.
9. Review evidence and retained implementation worktrees.
10. Use `agent_team_cleanup` only after review.

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

## Provider Adapter Development

Before adding a new provider adapter, add a fixture-backed suite with `describeProviderRuntimeConformance` from `tests/providers/conformance/runtime-conformance.ts`. The harness proves provider runtime mechanics, routing capability gates, health shape, session handles, resume metadata, cancellation hooks, and structured result boundaries without live-provider calls or quality claims.

The OpenAI-compatible foundation adapter is the generic base for future explicit profiles such as Ollama Cloud, Gemini-compatible gateways, or other OpenAI-compatible endpoints. Profiles should be added without changing the public MCP schema and without claiming edit/session/long-context behavior until a provider-specific milestone proves it.

## Release Gate

Every integrated change should pass:

```bash
npm run ci
```

`npm run ci` runs typecheck, tests, build, and packaged stdio smoke in that order.
