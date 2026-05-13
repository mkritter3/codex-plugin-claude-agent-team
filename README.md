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
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
npm run smoke:claude-live -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:gemini
```

The built executable is exposed as the `agent-team-mcp` package bin and points to `"./dist/index.js"`.

`npm run install:check` prints a sanitized install handoff report. It validates package metadata, plugin metadata, local MCP config, the built runtime, and packaged install scripts; it does not call providers, read credentials, or start live runs. The report includes an absolute MCP config that can be added to the Codex MCP client configuration:

```json
{
  "mcpServers": {
    "agent-team": {
      "command": "node",
      "args": ["/absolute/path/to/codex-plugin-claude-agent-team/dist/index.js"]
    }
  }
}
```

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
  "schemaVersion": 1,
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

`schemaVersion` is optional for existing workspaces and defaults to `1`. Future schema versions fail closed in config loading and `agent_team_doctor`; the runtime does not silently downgrade an unsupported config shape.

Provider selection policy is optional and capability-first. Request-level `provider` values and workspace routing config use the same neutral selector strings: exact provider ids such as `claude-code-cli`, families such as `family:grok`, model selectors such as `model:grok-4.20`, or capability selectors such as `capability:reasoning`.

```json
{
  "routing": {
    "rolePins": {
      "architect": "family:grok",
      "code-reviewer": "model:grok-4.20"
    },
    "providerOrder": [
      "family:grok",
      "family:ollama-cloud",
      "claude-code-cli"
    ]
  }
}
```

Per-request `provider` selectors take precedence over role pins, role pins take precedence over `providerOrder`, and every selection still has to satisfy the role's required capabilities. Multi-provider second opinions should be started as multiple explicit runs; routing policy does not synthesize provider rankings or preference judgments.

Policy controls are also optional and provider-neutral. They restrict which roles and providers may start, whether write-capable starts are allowed, where retained worktrees may be created, and whether local live smoke is enabled for operator-run checks:

```json
{
  "policy": {
    "allowedRoles": ["planner", "code-reviewer", "slice-implementer"],
    "allowedProviderSelectors": ["claude-code-cli", "family:grok"],
    "allowWriteMode": true,
    "allowedWorktreeRoots": ["/tmp/.agent-team-worktrees"],
    "liveSmokeEnabled": false,
    "auditEnabled": true
  }
}
```

When `auditEnabled` is true, dispatch and lifecycle start decisions append sanitized JSONL records to `.agent-team/audit/events.jsonl` before provider runtime or session execution. Audit records identify the operation, role, provider, run id, decision, and policy reason; they do not include prompt text, provider session ids, provider command details, mailbox payloads, secrets, process metadata, or environment values.

## State Layout Version

Workspace state currently uses state layout version `1`. `agent_team_doctor` inspects `.agent-team/state-layout.json` when present:

- missing marker: compatible existing workspace
- `{"layoutVersion":1}`: compatible current workspace
- future integer version: incompatible until this runtime is upgraded
- malformed marker: corrupt state requiring operator review

Doctor only reports this posture. It does not auto-migrate, repair, archive, or delete workspace state.

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

Profile provider ids use `ollama-cloud:<profile-id>`, for example `ollama-cloud:kimi-k2.6`. Profiles support synchronous read-only dispatch only; run live smoke separately before making any real-provider readiness, provider performance, or long-context claims.

Grok profiles are another explicit OpenAI-compatible profile layer. They are disabled by default, use provider-scoped auth env names, and route through profile ids such as `grok:grok-4.20-reasoning`:

```json
{
  "providers": {
    "grok": {
      "enabled": true,
      "profiles": [
        {
          "id": "grok-4.20-reasoning",
          "baseUrl": "https://api.x.ai/v1",
          "model": "grok-4.20",
          "apiKeyEnv": "XAI_API_KEY",
          "displayName": "Grok 4.20 Reasoning",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": true
          }
        }
      ]
    }
  }
}
```

Grok profiles support synchronous read-only chat-completions dispatch only. They do not support background sessions, live stdin, resume, cancellation, edits, tools, streaming, Responses API, image input, or workspace isolation in this plugin version. Run live smoke separately before making real-provider readiness, provider performance, provider ranking, or practical long-context claims.

Gemini is a separate explicit adapter because its REST payloads are not OpenAI-compatible. It is disabled by default and supports synchronous read-only dispatch only:

```json
{
  "providers": {
    "gemini": {
      "enabled": true,
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
      "model": "gemini-2.5-flash",
      "apiKeyEnv": "GEMINI_API_KEY",
      "displayName": "Gemini Review",
      "capabilities": {
        "structuredOutput": true,
        "longContext": true,
        "reasoning": false
      }
    }
  }
}
```

Gemini does not support background sessions, live stdin, resume, cancellation, edits, tools, streaming, Live API, file upload, multimodal inputs, or workspace isolation in this plugin version. Run live smoke separately before making real-provider readiness, provider performance, or practical long-context claims.

## Auth And Doctor

Before starting live runs, call `agent_team_doctor` for the target workspace. Doctor checks host readiness, package/runtime shape, writable state, git/worktree readiness when needed, provider health, auth posture, policy posture, and role routing.

Do not route around doctor failures. Claude Code CLI subscription OAuth remains the intended v1 path.

## Opt-In Live Claude Smoke

The optional live smoke exercises the packaged MCP stdio entrypoint and public tools against Claude Code CLI subscription OAuth. It is not part of CI, makes no provider ranking or comparative capability claim, and emits a sanitized report with direct proof, run ids, statuses, evidence paths, summary groups, and dashboard counts instead of private prompts or provider implementation details.

The report is successful only when tracked Claude runs reach `completed`. Intermediate states such as graceful wind-down requests remain nonterminal; if a bounded smoke cannot finish, the harness records wind-down or cancellation evidence and exits non-zero without deleting logs, sidecars, transcripts, or retained worktrees.

Inspect the planned flow without provider use:

```bash
npm run smoke:claude-live -- --dry-run --cwd /absolute/path/to/workspace
```

To permit a real local smoke, the target workspace must opt in with `policy.liveSmokeEnabled`:

```json
{
  "schemaVersion": 1,
  "policy": {
    "allowedRoles": ["planner", "code-reviewer"],
    "allowedProviderSelectors": ["claude-code-cli"],
    "allowWriteMode": false,
    "liveSmokeEnabled": true,
    "auditEnabled": true
  }
}
```

Then run the confirmed smoke after building the packaged runtime:

```bash
npm run build
npm run smoke:claude-live -- --confirm-live-provider-use --cwd /absolute/path/to/workspace
```

## Opt-In Claude Live Capability Matrix

The Claude live capability matrix is the broader pre-provider-expansion validation. It uses the packaged MCP stdio boundary and public tools only, then exercises direct dispatch, bounded parallel read-only starts, an isolated worktree `slice-implementer`, active mailbox delivery, graceful wind-down, explicit cancel, team records, dashboard, summary, cleanup, and a policy failure for a disallowed write root.

It is opt-in, not part of CI, and makes no provider ranking, model-quality, or practical long-context claim. The report is a sanitized control-plane evidence bundle with run ids, roles, provider ids, terminal states, evidence paths, changed files, cleanup states, dashboard counts, summary groups, policy-failure status, and known limitations.

Inspect the planned capability matrix without provider use:

```bash
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
```

Confirmed live execution requires `policy.liveSmokeEnabled` and write-mode policy that permits retained implementation worktrees when `slice-implementer` is included:

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

Then run the confirmed matrix after building the packaged runtime:

```bash
npm run build
npm run smoke:claude-live-matrix -- --confirm-live-provider-use --cwd /absolute/path/to/workspace
```

The matrix preserves sidecars, logs, transcripts, mailboxes, retained worktree evidence, audit records, and cleanup evidence. It does not print private prompts, provider command details, provider session ids, raw provider payloads, environment values, command args, mailbox payloads, or secrets.

## Opt-In Read-Only Provider Proof Smoke

The provider proof smoke exercises explicitly configured non-Claude read-only providers through the packaged MCP stdio entrypoint and public read-only tools. It is not part of CI. It proves explicit read-only provider routing, dispatch evidence, dashboard evidence, and summary evidence only; it makes no provider comparison, ranking, score, or long-context claim.

Inspect the planned flow without provider use:

```bash
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:gemini
```

For a real local proof, the target workspace must explicitly configure the provider, allow the provider selector in policy, and set `policy.liveSmokeEnabled`:

```json
{
  "schemaVersion": 1,
  "policy": {
    "allowedRoles": ["code-reviewer"],
    "allowedProviderSelectors": ["family:gemini"],
    "allowWriteMode": false,
    "liveSmokeEnabled": true,
    "auditEnabled": true
  }
}
```

Then run the confirmed proof after building the packaged runtime:

```bash
npm run build
npm run smoke:providers-live -- --confirm-live-provider-use --cwd /absolute/path/to/workspace --provider family:gemini --concurrency 1
```

The sanitized report includes provider selectors, selected provider ids, auth mode, run ids, run statuses, sidecar/log evidence paths, dashboard counts, summary groups, and known limitations. It does not print private prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, or secrets.

## Basic Workflow

1. Build and smoke the packaged runtime with `npm run build`, `npm run smoke:mcp-stdio`, and `npm run smoke:package`.
2. Run `agent_team_doctor`.
3. Start a bounded team with `agent_team_start_parallel`.
4. Optionally group returned run ids with `agent_team_create_team`.
5. Read the team record later with `agent_team_get_team` or `agent_team_list_teams`.
6. Open the read-only dashboard with `agent_team_dashboard`.
7. Read state with `agent_team_status_many`.
8. Inspect grouped evidence with `agent_team_summary`.
9. Send updates with `agent_team_message_many`.
10. Gracefully finalize with `agent_team_wind_down_many`.
11. Use `agent_team_cancel_many` only for explicit operator-driven cancellation.
12. Review evidence and retained implementation worktrees.
13. Use `agent_team_cleanup` only after review.

For a full operator flow, see `docs/runbooks/claude-team-session.md`.

`agent_team_dashboard` is inspection-only. It reports corrupt state as evidence without archiving inspected artifacts, and all lifecycle actions still go through explicit control tools.

## Evidence

Treat these as first-class records:

- sidecars under `.agent-team/runs/`
- optional team records under `.agent-team/teams/`
- policy audit records under `.agent-team/audit/events.jsonl`
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
- If a team record is stale, use its run refs as an index and trust per-run sidecars for current status, verdicts, cleanup, and evidence.
- If cleanup is blocked, review the retained implementation worktree and diff evidence before calling `agent_team_cleanup`.

## Provider Adapter Development

Before adding a new provider adapter, add a fixture-backed suite with `describeProviderRuntimeConformance` from `tests/providers/conformance/runtime-conformance.ts`. The harness proves provider runtime mechanics, routing capability gates, health shape, session handles, resume metadata, cancellation hooks, and structured result boundaries without live-provider calls or quality claims.

The OpenAI-compatible foundation adapter is the generic base for future explicit profiles such as Ollama Cloud, Grok, Gemini-compatible gateways, or other OpenAI-compatible endpoints. Profiles should be added without changing the public MCP schema and without claiming edit/session/long-context behavior until a provider-specific milestone proves it.

## Release Gate

Every integrated change should pass:

```bash
npm run ci
```

`npm run ci` runs typecheck, tests, build, install handoff preflight, packaged stdio smoke, and package dry-run smoke in that order.
