# Claude Team Session Runbook

This runbook shows how to operate an Agent Team MCP session from Codex with Claude Code CLI subscription OAuth and Ollama-native Claude Code profiles behind the same provider-neutral lifecycle. It uses only public MCP tools and durable `.agent-team/` evidence. It does not require prior chat history.

## Safety Model

- Codex remains the orchestrator, reviewer, integrator, and final authority.
- The MCP server is the control-plane boundary.
- Each agent run is individually addressable by run id.
- Sidecars, logs, transcripts, mailboxes, verdicts, workspace diffs, changed files, and recovery records are evidence.
- Implementation agents work in a retained implementation worktree and require human/Codex review before cleanup.
- Live provider use is an opt-in live smoke and is not part of CI.

## Codex Operator Boundary

Operate Agent Team directly through public MCP tools from Codex. Harnesses and dogfood scripts are regression and live-proof tools only; they prove installability, provider wiring, and workflow fixtures, but they are not the orchestration path for user work.

The plugin ships `skills/codex-agent-team-orchestrator/SKILL.md` to keep Codex aligned on direct MCP orchestration: doctor, workflow creation, planning consensus, bounded slice starts, mailbox steering, slice review, integration queue, Codex-owned manual integration, final evidence recording, reporting, and cleanup.

## Fixture-Safe Verification

Run these before changing installation or docs examples:

```bash
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:workflow-orchestrator
npm run smoke:package
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:claude-models -- --dry-run
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:gemini
npm run ci
```

These commands are CI-safe. They verify package/runtime wiring and fixture behavior without starting a live Claude session.

`npm run install:check` emits an absolute MCP config and ordered install checks. It does not call providers, read credentials, or start live runs.

For native Codex plugin installs, the package `.mcp.json` must keep `"cwd": "."` and `"startup_timeout_sec": 120` on the `agent-team` stdio server. Codex resolves that cwd to the installed plugin cache root, which lets the relative `./scripts/start-mcp.sh` launcher work from any workspace, and the startup timeout gives a clean install enough time for the wrapper's one-time dependency install and build.

`npm run smoke:workflow-orchestrator` is the fixture-safe packaged MCP proof for the L11 workflow loop. It creates a disposable git workspace, calls public workflow tools through `dist/index.js`, records degraded Opus evidence without blocking, verifies `completionStatus` stays incomplete before final gate evidence, verifies it becomes `complete` after integration evidence, and removes the fixture. It does not call providers, use API keys, or make model-quality/provider capability claims.

Final product-readiness evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`.

## MCP Configuration Check

The packaged MCP entrypoint is:

```json
{
  "mcpServers": {
    "agent-team": {
      "command": "sh",
      "args": ["./scripts/start-mcp.sh"],
      "cwd": ".",
      "startup_timeout_sec": 120
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

Before any live dispatch, complete the [workspace compatibility preflight](../../skills/codex-agent-team-orchestrator/references/workspace-configuration.md): inspect and persist known config migrations, check draft workflow targets, then call `agent_team_list_providers` and `agent_team_doctor` with the same target workspace:

```json
{
  "cwd": "/absolute/path/to/workspace"
}
```

Proceed only when doctor reports the workspace, package runtime, provider routing, policy posture, and Claude Code CLI subscription OAuth posture are ready. If doctor reports a failure, fix that issue first. Do not route around the preflight with a different billing or transport path.

Doctor includes an `mcp-runtime` check for the currently running server process. Confirm `mcp-runtime.details.workflowWriteScopeAllowsEmpty` is `true` before direct workflow operations; this proves the live MCP schema accepts read-only workflow slices with `writeScope: []`.

After rebuilding the package, run `/reload-plugins` or restart Codex, then rerun `agent_team_doctor`. If a tool returns `Transport closed`, reload or restart Codex before calling more Agent Team tools. If doctor or direct workflow creation still shows old validation behavior, stop stale Agent Team MCP server processes, reload again, and confirm the new `mcp-runtime` evidence before proceeding.

`npm run install:check` reports `running-mcp-processes` with a sanitized count when existing Agent Team MCP server processes may keep serving old schemas. It intentionally omits PIDs and command lines from the report.

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

For direct Codex operation, `allowedRoles`, `allowedProviderSelectors`, `allowWriteMode`, and `allowedWorktreeRoots` are the important policy boundaries. `policy.liveSmokeEnabled gates live-smoke harnesses` and opt-in proof scripts; normal direct MCP starts are controlled by doctor readiness, provider and role allowlists, write-mode policy, and explicit operator intent through the MCP tools.

`schemaVersion` is optional for old local workspaces and defaults to `1`. If doctor reports an unsupported future config schema, upgrade this plugin before operating that workspace.

When `auditEnabled` is true, dispatch and lifecycle start decisions write sanitized records to `.agent-team/audit/events.jsonl` before provider execution. Treat those records as operator evidence for allow/block decisions, not as transcripts.

## L11 Workflow Orchestrator Loop

Use this workflow when Codex is coordinating a full engineering effort with planning, parallel implementation slices, review, integration, and final completion evidence. It uses public MCP tools only; Codex remains the senior engineer, orchestrator, reviewer, integrator, and final authority.

The public tool sequence is:

1. Complete the workspace compatibility preflight, then run `agent_team_list_providers` and `agent_team_doctor` for the workspace.
2. Create the durable workflow with `agent_team_create_workflow`.
3. Record planning consensus rounds with `agent_team_plan_consensus`.
4. Start ready implementation slices with `agent_team_start_slices`.
5. Send dependency evidence to blocked or waiting slices with `agent_team_unblock_slice`.
6. Review each implementation slice with `agent_team_review_slice`.
7. Build the read-only integration order with `agent_team_integration_queue`.
8. Perform Codex-owned manual integration outside the plugin.
9. Record final gate verification with `agent_team_record_integration`.
10. Read the final completion report with `agent_team_workflow_report`.
11. Use `agent_team_cleanup` only after reviewing retained worktrees and saving integration evidence.

Create the workflow from a product goal, constraints, non-goals, and a slice DAG:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "name": "Checkout Reliability Workflow",
  "goal": {
    "title": "Ship checkout reliability hardening",
    "successCriteria": [
      "User checkout succeeds through retry-safe payment confirmation",
      "Focused and full verification pass before release"
    ],
    "constraints": [
      "Codex owns integration",
      "Implementation agents write only in retained isolated worktrees"
    ],
    "nonGoals": [
      "Provider comparison",
      "Automatic merge"
    ]
  },
  "slices": [
    {
      "sliceId": "slice_tests",
      "title": "Checkout regression tests",
      "state": "ready",
      "ownerRole": "test-hardening-engineer",
      "dependencies": [],
      "writeScope": ["tests/checkout"],
      "acceptanceTests": ["npm test -- tests/checkout"],
      "riskLevel": "medium",
      "requiredReviewers": ["code-reviewer", "test-hardening-engineer"],
      "integrationOrderHint": 1
    },
    {
      "sliceId": "slice_runtime",
      "title": "Checkout runtime fix",
      "state": "blocked",
      "ownerRole": "slice-implementer",
      "dependencies": ["slice_tests"],
      "blockedMode": "deferred-start",
      "blockedBy": ["slice_tests"],
      "writeScope": ["src/checkout"],
      "acceptanceTests": ["npm test -- tests/checkout"],
      "riskLevel": "high",
      "requiredReviewers": ["code-reviewer", "test-hardening-engineer", "security-reviewer"],
      "integrationOrderHint": 2
    }
  ]
}
```

Planning consensus is evidence, not a brainstorming transcript. Use `agent_team_plan_consensus` to record reviewer verdicts, Codex rationale, Opus availability posture, and any CEO/product-level escalation. Routine technical decisions stay with Codex; user escalation is reserved for practical product impact, trust, cost, release posture, or user-facing tradeoffs.

After planning is approved, start slices with bounded concurrency:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "workflowId": "workflow_checkout_reliability",
  "sliceIds": ["slice_tests", "slice_runtime"],
  "concurrency": 2
}
```

Record the `agent_team_start_slices` response before moving on. Each started row includes the slice id plus run evidence such as `runId`, `sidecarPath`, `logPath`, `transcriptPath`, and `mailboxPaths`; these are the durable addresses for status, review, mid-flight steering, and cleanup.

Blocked slices are first-class. When a dependency is ready, call `agent_team_unblock_slice` with dependency evidence, changed files, and evidence paths. Dependent write agents must re-check current source state before editing.

Review is required before integration. Use `agent_team_review_slice` to record implementation evidence, reviewer verdicts, Codex sign-off, Opus review posture when available, and revision or blocker decisions. A slice that needs changes remains `needs-revision` until a later review approves it.

Once slices are approved, call `agent_team_integration_queue`. The queue is read-only: it reports dependency order, conflict risk, focused tests, changed files, retained worktree paths, and review run ids. It does not merge, patch, commit, push, delete branches, or clean retained worktrees.

Codex-owned manual integration happens outside the plugin. Codex reviews one retained worktree diff at a time, applies the chosen integration method, and runs focused tests. After integration, call `agent_team_record_integration` with final gate verification:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "workflowId": "workflow_checkout_reliability",
  "sliceId": "slice_tests",
  "integrationMethod": "manual-patch",
  "summary": "Codex integrated the checkout regression tests.",
  "changedFiles": ["tests/checkout/retry.test.ts"],
  "verification": [
    {
      "command": "npm test -- tests/checkout/retry.test.ts",
      "status": "passed",
      "summary": "Focused checkout tests passed.",
      "evidencePath": "/absolute/path/to/workspace/.agent-team/evidence/slice_tests-focused.log"
    }
  ],
  "evidencePaths": [
    "/absolute/path/to/workspace/.agent-team/evidence/slice_tests-integration.json"
  ],
  "retainedWorktreePath": "/absolute/path/to/workspace/.worktrees/slice_tests",
  "cleanupRecommendation": "eligible-after-evidence-saved"
}
```

The completion report is the final workflow gate:

```json
{
  "cwd": "/absolute/path/to/workspace",
  "workflowId": "workflow_checkout_reliability",
  "includeWorkflow": true
}
```

`agent_team_workflow_report` returns `completionStatus`. It reports `complete` only when planning is approved and every slice is integrated with durable passing final gate verification. It reports `incomplete` for `ready-to-integrate`, `in-progress`, `deferred`, or `missing-evidence` states. It reports `blocked` when any slice is blocked, failed, cancelled, or needs revision. The report also identifies cleanup-ready rows, retained worktree paths, evidence paths, blockers, and missing evidence reasons.

Treat workflow report completion as final integration evidence, not as a raw provider-run status. A completed run can still leave its workflow slice waiting for review, revision, or integration evidence.

Cleanup is explicit and cleanup only after integration evidence is saved. Use `agent_team_cleanup` for a retained implementation worktree after Codex has reviewed the diff, recorded final gate evidence, and no longer needs that worktree as review evidence.

This workflow makes no provider ranking, comparative performance claim, model-quality claim, or real Opus sign-off claim unless a separate opt-in live proof records that evidence. If Opus is unavailable in required-when-available mode, record degraded evidence and notify the user; do not silently block forever.

## Claude Code CLI Model Profiles

Use `providers.claudeCodeCli.profiles` when you want explicit provider ids for Claude Code's subscription-backed aliases. The profile ids stay non-secret and do not add API-key env behavior:

```json
{
  "schemaVersion": 1,
  "providers": {
    "claudeCodeCli": {
      "profiles": [
        {
          "id": "opus",
          "model": "opus",
          "displayName": "Claude Opus",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": true
          }
        },
        {
          "id": "sonnet",
          "model": "sonnet",
          "displayName": "Claude Sonnet",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": true
          }
        },
        {
          "id": "haiku",
          "model": "haiku",
          "displayName": "Claude Haiku",
          "capabilities": {
            "structuredOutput": true
          }
        }
      ]
    }
  },
  "policy": {
    "allowedRoles": ["planner", "code-reviewer"],
    "allowedProviderSelectors": [
      "claude-code-cli:opus",
      "claude-code-cli:sonnet",
      "claude-code-cli:haiku"
    ],
    "allowWriteMode": false,
    "liveSmokeEnabled": false,
    "auditEnabled": true
  }
}
```

Run `npm run smoke:claude-models -- --dry-run` to inspect the packaged MCP proof plan. Run it with `--confirm-live-provider-use` only when you intentionally want live Claude Code CLI calls for the three aliases.

### Recommended Claude Routing

Use Opus as the default high-reasoning lane for planning, architecture, complex debugging, senior review, and final sign-off. Use Haiku as the default search lane for bounded repo/document reconnaissance, documentation lookup, and low-risk fact gathering. Use Sonnet as the default execution lane for implementation slices that need isolated writes. Keep the aliases unpinned so Claude Code resolves `opus`, `haiku`, and `sonnet` to the latest subscription-backed aliases available in the installed CLI.

```json
{
  "schemaVersion": 1,
  "providers": {
    "claudeCodeCli": {
      "profiles": [
        {
          "id": "opus",
          "model": "opus",
          "displayName": "Claude Opus - planning and senior review",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": true
          }
        },
        {
          "id": "haiku",
          "model": "haiku",
          "displayName": "Claude Haiku - search and reconnaissance",
          "capabilities": {
            "structuredOutput": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true
          }
        },
        {
          "id": "sonnet",
          "model": "sonnet",
          "displayName": "Claude Sonnet - isolated execution",
          "writeValidated": true,
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true,
            "edits": true,
            "workspaceIsolation": true
          }
        }
      ]
    }
  },
  "routing": {
    "rolePins": {
      "architect": "model:opus",
      "planner": "model:opus",
      "code-reviewer": "model:opus",
      "debugger": "model:opus",
      "security-reviewer": "model:opus",
      "performance-reviewer": "model:opus",
      "integration-engineer": "model:opus",
      "docs-dx-writer": "model:haiku",
      "frontend-engineer": "model:sonnet",
      "backend-engineer": "model:sonnet",
      "slice-implementer": "model:sonnet"
    },
    "providerOrder": ["model:opus", "model:haiku", "model:sonnet"]
  },
  "policy": {
    "allowedProviderSelectors": ["model:opus", "model:haiku", "model:sonnet"],
    "allowWriteMode": true,
    "auditEnabled": true
  }
}
```

For ad hoc search-style work that does not map cleanly to a pinned role, pass a request-level provider selector such as `model:haiku` or `claude-code-cli:haiku`. This is a routing and capability policy, not comparative model evidence. Request-level provider selectors remain available for deliberate probes or specialty assignments, and write-capable Sonnet execution still requires isolated worktree mode plus `writeValidated: true`.

## State Layout Check

Doctor also inspects `.agent-team/state-layout.json` when present. Missing markers are compatible with layout version `1`; current markers are compatible; future layout versions fail closed; corrupt markers require operator review. Doctor is read-only for this check and does not auto-migrate or repair state.

## Ollama Claude Code Profiles

Use `ollama-claude-code:*` when you want Claude Code to route through Ollama's native Claude Code launcher while preserving the existing Agent Team lifecycle. The default `providers.ollamaClaudeCode` config lists `ollama-claude-code:glm-5.2` and `ollama-claude-code:kimi-k2.7-code`, launched as `ollama launch claude --model <model> --yes -- <claude args>`. This default path uses the locally authenticated Ollama installation and does not require `OLLAMA_API_KEY` when `ollama` is already signed in. Doctor verifies the local `ollama` and `claude` CLIs and warns that cloud model access still needs opt-in live proof for the exact provider id. Use `ollama-cloud:*` only for the OpenAI-compatible chat-completions route, not for Claude Code harness proof. Do not use `model:glm-5.2` or `model:kimi-k2.7-code` to choose between the two Ollama families; duplicated model selectors fail closed so operators must choose an exact provider id or family selector.

```json
{
  "schemaVersion": 1,
  "providers": {
    "ollamaClaudeCode": {
      "enabled": true,
      "launchMode": "ollama-launch",
      "baseUrl": "http://localhost:11434",
      "authToken": "ollama",
      "executable": "ollama",
      "apiKeyEnv": "OLLAMA_API_KEY",
      "profiles": [
        {
          "id": "glm-5.2",
          "model": "glm-5.2:cloud",
          "displayName": "GLM 5.2",
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
          "id": "kimi-k2.7-code",
          "model": "kimi-k2.7-code:cloud",
          "displayName": "Kimi K2.7 Code",
          "writeValidated": false,
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
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

At provider launch, the runtime creates a scoped local Ollama env for that run only: `ANTHROPIC_BASE_URL` points at the local Ollama server, `ANTHROPIC_AUTH_TOKEN` uses the configured non-secret token value, `ANTHROPIC_API_KEY` is intentionally blank for Claude Code compatibility, and `CLAUDE_CODE_OAUTH_TOKEN` plus ambient Anthropic auth values are stripped so the harness run cannot accidentally reuse normal Claude Code subscription auth. In `ollama-launch` mode the actual process is wrapped with `ollama launch claude --model <profile.model> --yes --`, so Ollama handles local/cloud model auth. `launchMode: "local-anthropic"` keeps the same local env but calls `claude --model <profile.model>` directly. `launchMode: "direct-api"` is the explicit legacy fallback for direct remote Anthropic-compatible access and is the only Ollama Claude Code mode that requires `OLLAMA_API_KEY`. The normal `claude-code-cli` provider continues to use Claude Code CLI subscription OAuth and keeps its auth-precedence checks.

Keep `writeValidated` false until a live implementation proof validates edits, isolated worktree containment, mailbox delivery, wind-down, cancellation, cleanup, and source-checkout cleanliness for the exact profile. Enabling write capabilities is an operator proof gate and not a provider ranking, provider comparison, or model-quality claim.

If an Ollama or other provider returns transient failures such as rate limits, `503`, timeouts, or provider-unavailable responses, the plugin records provider health under `.agent-team/providers/health.json`. Default/family routing and `providerOrder` treat that as a cooldown and prefer another capable provider until the cooldown expires. An exact provider request remains an explicit probe, so Codex can still test it deliberately, but it should not repeatedly call a degraded provider during normal orchestration.

The built-in provider order is `family:ollama-claude-code`, `claude-code-cli`, `family:ollama-cloud`, `agy`, then `codex-cli`. This affects only capable providers: read-oriented roles prefer the Ollama-native GLM/Kimi profiles when healthy, while implementation roles fall through unless those exact profiles have passed write validation.

## AGY OAuth Provider

Use `providers.agy` when you want Gemini through local AGY Google sign-in/OAuth rather than API-key `generateContent`. This is separate from `providers.gemini`, which remains the explicit API-key adapter.

```json
{
  "providers": {
    "agy": {
      "enabled": true,
      "executable": "agy",
      "model": "gemini-3.8-flash-high",
      "displayName": "Gemini via AGY",
      "writeValidated": false,
      "capabilities": {
        "structuredOutput": true,
        "longContext": true,
        "reasoning": true,
        "tools": false,
        "sessionResume": true,
        "cancellation": true,
        "edits": false,
        "workspaceIsolation": false
      }
    }
  },
  "policy": {
    "allowedRoles": ["planner", "code-reviewer"],
    "allowedProviderSelectors": ["agy", "family:agy"],
    "allowWriteMode": false,
    "allowedWorktreeRoots": [],
    "liveSmokeEnabled": false,
    "auditEnabled": true
  }
}
```

Install AGY and complete its sign-in flow. `agent_team_doctor` checks the executable; AGY owns authentication and project selection. Confirm model IDs with `agy models`. Read-only dispatch and resumable background sessions are available by default. Enable implementation only after a live AGY isolated-write proof, using `writeValidated: true` with tools, edits and workspace isolation enabled.

Saved `providers.geminiCli` settings and `gemini-cli` selectors migrate to `agy`. Old Gemini CLI write validation is reset, and old sessions require a new AGY run. No old CLI execution fallback remains. Canonical `providers.agy` takes precedence.

For UI/UX review, use explicit role pins. Pin `frontend-engineer` only after AGY write validation:

```json
{
  "routing": {
    "rolePins": {
      "ui-ux-designer": "agy",
      "ux-product-critic": "agy",
      "frontend-engineer": "agy"
    }
  }
}
```

AGY implementation runs use retained isolated worktrees and `--sandbox --mode accept-edits`; read-only runs use `--sandbox --mode plan`. The adapter parses JSON results, resumes with `--conversation`, and keeps permission checks enabled. Denied actions fail the run and retain bounded denied-action evidence. To unblock one, review the evidence and add only a narrow supported AGY `command(prefix)` or `command(regex:...)` rule under the provider's documented precedence; see [AGY CLI permissions](https://antigravity.google/docs/permissions?tab=cli). AGY settings are documented as global, and no project-local scope or per-invocation setting was verified, so do not copy permissions, hooks, or secrets into a worktree and do not weaken sandbox/permission flags. If Gemini returns rate limits, timeouts, or provider-unavailable errors, provider health cooldowns cause normal default/family routing to avoid it temporarily while exact `agy` requests remain explicit probes.

For a workflow implementation continuation, call `agent_team_reply` with both `workflowId` and `sliceId`. The parent run must already belong to that approved slice, retain its exact provider/model and isolated worktree, and have no active descendant. A blocked continuation records its reservation; inspect that child sidecar before retrying. If a retained worktree was removed, start a fresh isolated workflow run and preserve the old evidence rather than attempting session continuation.

## Codex CLI Subscription Provider

Use `providers.codexCli` when you want a separate Codex CLI process to act as a normal agent-team worker through the local Codex subscription login. This is separate from host Codex, which remains the senior engineer, orchestrator, reviewer, integrator, and final authority.

```json
{
  "providers": {
    "codexCli": {
      "enabled": true,
      "executable": "codex",
      "model": "gpt-5.5",
      "displayName": "Codex CLI",
      "writeValidated": true,
      "capabilities": {
        "structuredOutput": true,
        "longContext": true,
        "reasoning": true,
        "tools": true,
        "sessionResume": true,
        "cancellation": true,
        "edits": true,
        "workspaceIsolation": true
      }
    }
  },
  "policy": {
    "allowedRoles": ["planner", "code-reviewer", "slice-implementer", "frontend-engineer", "backend-engineer", "test-hardening-engineer"],
    "allowedProviderSelectors": ["codex-cli"],
    "allowWriteMode": true,
    "allowedWorktreeRoots": ["/absolute/path/to/.agent-team-worktrees"],
    "liveSmokeEnabled": false,
    "auditEnabled": true
  }
}
```

Keep `writeValidated: false`, `allowWriteMode: false`, and empty write capabilities until the exact local Codex CLI executable and model have passed an opt-in isolated-write proof in a disposable workspace. After that proof, `codex-cli` can be assigned planning, review, implementation, UI, backend, or test-hardening roles through normal provider-neutral routing and workflow slices.

Codex CLI read-only dispatch uses `codex exec --sandbox read-only`. Isolated write dispatch uses `--sandbox workspace-write` only after write validation and explicit workspace roots. The adapter never uses `--dangerously-bypass-approvals-and-sandbox`. It reports `authMode: "subscription-oauth"` and removes `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, and `OPENAI_PROJECT` from provider launches so local Codex CLI login remains the auth boundary.

Latest live Codex CLI read-only provider proof evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-codex-cli-provider-proof.md`.

## Opt-In Codex CLI Write Validation

Use this proof before enabling Codex CLI as a write-capable `slice-implementer` in normal workspaces. It creates a disposable git fixture with a tiny Node test project, enables `writeValidated: true` only in that fixture, starts a `slice-implementer`, verifies code, tests, and a proof file changed only in the isolated execution worktree, confirms the worker log mentions `npm test`, independently runs `npm test` in the execution worktree, records dashboard and summary evidence, and removes the retained worktree with `agent_team_cleanup`.

Latest live Codex CLI write proof evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-codex-cli-write-proof.md`.

Dry run:

```bash
npm run smoke:codex-write -- --dry-run --provider codex-cli
```

Confirmed live proof:

```bash
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN npm run smoke:codex-write -- --confirm-live-provider-use --provider codex-cli --timeout-ms 300000
```

The report includes provider id, run id, terminal status, changed files, worktree containment, test execution evidence, cleanup status, dashboard counts, summary groups, sidecar/log paths, and known limitations. It does not print prompts, task text, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets. A passing run proves isolated write containment and in-worktree test execution for `codex-cli` only; it is not a model-quality, ranking, or broad autonomous-implementation claim.

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

Latest live Claude proof evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-claude-provider-proof.md`.

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

Use the canonical worktree root that git will resolve for the source checkout. On macOS, `/tmp` often resolves to `/private/tmp`; if `allowedWorktreeRoots` uses the non-canonical path, the matrix should fail closed with `worktree_root_not_allowed`.

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

Historical pre-native Ollama write proof evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-ollama-write-proof.md`; it does not prove the current `ollama launch claude` defaults.

Inspect without provider use:

```bash
npm run smoke:ollama-write -- --dry-run --provider ollama-claude-code:glm-5.2
```

Run after building:

```bash
npm run build
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:glm-5.2
```

The report includes provider ids, run ids, terminal status, changed files, worktree containment, cleanup status, dashboard counts, summary groups, sidecar/log paths, and known limitations. It does not print prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets. A passing run proves isolated write containment for the selected provider only; it is not a model-quality, ranking, or broad autonomous-implementation claim.

Historical proof evidence for earlier Ollama profiles remains in the report linked above. Current default profiles, including `glm-5.2` and `kimi-k2.7-code`, should stay read-only until each exact provider id passes the same disposable-fixture proof through the packaged MCP path.

## Opt-In AGY Write Validation

Use this proof before enabling AGY as a write-capable `frontend-engineer` in normal workspaces. It creates a disposable git fixture with `index.html`, enables `writeValidated: true` only in that fixture, starts a `frontend-engineer`, verifies the UI file changed only in the isolated execution worktree, records dashboard and summary evidence, and removes the retained worktree with `agent_team_cleanup`.

The historical `docs/superpowers/reports/2026-05-13-agent-team-live-gemini-write-proof.md` covers the retired transport and does not validate AGY. Run a fresh AGY proof before enabling implementation.

Inspect without provider use:

```bash
npm run smoke:agy-write -- --dry-run --provider agy
```

Run after building:

```bash
npm run build
npm run smoke:agy-write -- --confirm-live-provider-use --provider agy --model gemini-3.8-flash-high --timeout-ms 240000
```

The smoke defaults to `gemini-3.8-flash-high`; confirm access with `agy models` or pass `--model` to validate another available model. The report includes provider ids, run ids, terminal status, changed files, worktree containment, cleanup status, dashboard counts, summary groups, sidecar/log paths, and known limitations. It does not print prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets. A passing run proves isolated write containment for `agy` only; it is not a model-quality, ranking, broad frontend-quality, or mid-flight steering claim.

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

Use mid-flight steering while agents are active, but account for the transport result. `delivered_live` means the active run accepted the update; `recorded_for_resume` means the message is saved for a later resumable turn or review cycle and may not affect the current execution.

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

1. Run fixture-safe verification with `npm run build`, `npm run install:check`, `npm run smoke:mcp-stdio`, `npm run smoke:workflow-orchestrator`, `npm run smoke:package`, and `npm run ci`.
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


Retained-worktree ownership is conservative: when provider ownership identity is unknown or ambiguous, recovery stays blocked for an operator to verify the process stopped. There is no TTL expiry, lease stealing, or force bypass.
