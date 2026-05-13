# Codex Plugin Claude Agent Team

Provider-neutral Agent Team MCP plugin for Codex. The plugin lets Codex start, inspect, message, wind down, and clean up durable external agent runs while Codex remains the orchestrator and final integration authority.

Claude Code CLI subscription OAuth is the primary v1 transport. The core stays provider-neutral so other providers can plug into the same roles, lifecycle, mailbox, verdict, status, cleanup, and evidence contracts. The MCP server is host-agnostic at the protocol boundary; Codex-specific plugin packaging is one host shell, not the provider model.

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
npm run smoke:workflow-orchestrator
npm run smoke:package
npm run smoke:claude-live -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:claude-models -- --dry-run
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

Per-request `provider` selectors take precedence over role pins, role pins take precedence over `providerOrder`, and every selection still has to satisfy the role's required capabilities. `providerOrder` is a preference, not a hard pin: if a preferred provider is in an active cooldown window, routing can fall through to the next capable provider while doctor records the degraded evidence. Multi-provider second opinions should be started as multiple explicit runs; routing policy does not synthesize provider rankings or preference judgments.

Claude Code CLI model profiles let a workspace expose explicit subscription-OAuth aliases while keeping execution on the same Claude Code CLI transport. The common aliases are intentionally unpinned so Claude Code resolves them to its current configured defaults:

```json
{
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
  }
}
```

Profile provider ids use `claude-code-cli:<profile-id>`, for example `claude-code-cli:opus`. They use `authMode: "subscription-oauth"` and do not introduce API-key env handling. Write capabilities remain withheld unless an exact profile is explicitly marked `writeValidated: true` and the workspace has isolated write mode enabled.

For the default Claude team shape, pin planning, architecture, senior review, and other high-complexity read-only roles to Opus. Route search-style reconnaissance, documentation lookup, and low-risk fact-gathering tasks to Haiku. Pin implementation and bounded execution roles to a write-validated Sonnet profile. The model aliases stay deliberately unversioned so Claude Code resolves `opus`, `haiku`, and `sonnet` to the latest subscription-backed aliases available in the installed CLI.

```json
{
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
    "allowedProviderSelectors": ["model:opus", "model:haiku", "model:sonnet"]
  }
}
```

Treat Opus as the high-reasoning brain for ambiguous architecture, planning consensus, product-risk review, security/performance review, and final sign-off. Treat Haiku as the fast search lane for bounded repo/document reconnaissance and information gathering. Treat Sonnet as the default execution worker for isolated implementation slices. A request-level provider selector can still override these pins when Codex intentionally probes another provider or assigns a specialty worker, and every route still has to pass capability and write-validation checks.

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

Ollama Claude Code profiles are an explicit Anthropic-compatible profile layer for routing Claude Code through Ollama-compatible endpoints while keeping the same lifecycle, mailbox, status, wind-down, cancellation, dashboard, summary, and cleanup contracts. They are disabled by default. The supported Cloud path uses Ollama's direct Anthropic-compatible endpoint at `https://ollama.com`, so a local Ollama daemon or Ollama CLI is not required. Configure `providers.ollamaClaudeCode` with one shared API-key environment variable, usually `OLLAMA_API_KEY`, plus non-secret model profiles:

```json
{
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
  }
}
```

Profile provider ids use `ollama-claude-code:<profile-id>`, for example `ollama-claude-code:kimi-k2.6`. At launch time the adapter builds a scoped provider env for that run only: `ANTHROPIC_BASE_URL` is set to `https://ollama.com`, `ANTHROPIC_AUTH_TOKEN` carries the configured Ollama token, `ANTHROPIC_API_KEY` is intentionally blank for Claude Code compatibility, and `OLLAMA_API_KEY` remains available as the single secret source. This scoped provider env is not applied to the normal `claude-code-cli` provider, so Claude Code CLI subscription OAuth keeps its fail-closed auth posture.

Write-capable capabilities such as edits and workspace isolation are withheld unless a profile explicitly sets `writeValidated: true` and declares those capabilities. Treat that as an operator proof gate, not a model-quality claim. Run opt-in live validation before using any Ollama Claude Code profile for implementation work, and keep no provider ranking or comparative readiness claim in reports.

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
      "model": "gemini-3-pro-preview",
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

Gemini CLI is a separate auth-backed provider for local Google sign-in/OAuth usage. It is disabled by default and intentionally distinct from the API-key `gemini` adapter:

```json
{
  "providers": {
    "geminiCli": {
      "enabled": true,
      "executable": "gemini",
      "model": "gemini-3-pro-preview",
      "displayName": "Gemini CLI",
      "projectEnv": "GOOGLE_CLOUD_PROJECT",
      "writeValidated": false,
      "capabilities": {
        "structuredOutput": true,
        "longContext": true,
        "reasoning": true,
        "tools": false,
        "sessionResume": false,
        "cancellation": false,
        "edits": false,
        "workspaceIsolation": false
      }
    }
  },
  "policy": {
    "allowedProviderSelectors": ["gemini-cli", "family:gemini-cli"]
  }
}
```

`gemini-cli` uses `authMode: "oauth"` and does not require or infer `GEMINI_API_KEY`. Install and sign in to Gemini CLI first, then run `agent_team_doctor`; some Google Workspace or Code Assist setups may also require the configured project env. The adapter supports read-only dispatch by default. It advertises autonomous worker capabilities only when `writeValidated: true` and `tools`, `sessionResume`, `cancellation`, `edits`, and `workspaceIsolation` are explicitly enabled after a live isolated-write proof.

For UI/UX and frontend work, prefer explicit role pins rather than hidden router behavior:

```json
{
  "routing": {
    "rolePins": {
      "ui-ux-designer": "gemini-cli",
      "ux-product-critic": "gemini-cli",
      "frontend-engineer": "gemini-cli"
    }
  }
}
```

Gemini CLI implementation runs use retained isolated worktrees and `--approval-mode auto_edit`; read-only runs use `--approval-mode plan`. The plugin never uses Gemini CLI `--yolo`. If Gemini returns rate limits, timeouts, or provider-unavailable errors, provider health cooldowns cause normal default/family routing to avoid it temporarily while exact `gemini-cli` requests remain explicit probes.

Codex CLI is an explicit subscription-backed provider for local Codex login usage. It is disabled by default and separate from Codex as the host/orchestrator: host Codex remains the senior engineer and integration authority, while `codex-cli` can be routed as a normal agent-team worker.

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

Keep `writeValidated: false`, `allowWriteMode: false`, and empty write capabilities until the exact local Codex CLI executable and model have passed an opt-in isolated-write proof in a disposable workspace. After that proof, Codex CLI can be assigned planning, review, implementation, UI, backend, or test-hardening roles through the same provider-neutral routing and slice DAG as Claude, Gemini CLI, Ollama, and other adapters.

Codex CLI read-only dispatch uses `codex exec --sandbox read-only` with the configured model and workspace. Isolated write dispatch uses `--sandbox workspace-write` only after the provider has `writeValidated: true` and explicitly declares tools, edits, session resume, cancellation, and workspace isolation. The adapter never uses `--dangerously-bypass-approvals-and-sandbox`. It reports `authMode: "subscription-oauth"` and removes `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, and `OPENAI_PROJECT` from provider launches so local Codex CLI login remains the auth boundary.

Latest live Codex CLI read-only provider proof evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-codex-cli-provider-proof.md`.

## Opt-In Codex CLI Write Validation Smoke

Use this proof before enabling Codex CLI as a write-capable `slice-implementer` in normal workspaces. It creates a disposable git fixture with a tiny Node test project, enables `writeValidated: true` only inside that fixture, starts a `slice-implementer`, verifies code, tests, and a proof file changed only in the isolated execution worktree, confirms the worker log mentions `npm test`, independently runs `npm test` in the execution worktree, records dashboard and summary evidence, and removes the retained worktree through `agent_team_cleanup`.

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

Provider health is recorded under `.agent-team/providers/health.json`. Transient failures such as rate limits, timeouts, or provider-unavailable responses mark the provider degraded for a cooldown window with evidence paths and failure counts. During cooldown, default and family/provider-order routing avoids that provider; explicit provider requests remain explicit probes and record their own evidence. This is operational reliability memory, not a model evaluation or provider ranking claim.

## Auth And Doctor

Before starting live runs, call `agent_team_doctor` for the target workspace. Doctor checks host readiness, package/runtime shape, writable state, git/worktree readiness when needed, provider health, auth posture, policy posture, and role routing.

Do not route around doctor failures. Claude Code CLI subscription OAuth remains the intended v1 path.

## Opt-In Live Claude Smoke

The optional live smoke exercises the packaged MCP stdio entrypoint and public tools against Claude Code CLI subscription OAuth. It is not part of CI, makes no provider ranking or comparative capability claim, and emits a sanitized report with direct proof, run ids, statuses, evidence paths, summary groups, and dashboard counts instead of private prompts or provider implementation details.

Latest live Claude proof evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-claude-provider-proof.md`.

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

Use the canonical worktree root that git will resolve for the source checkout. On macOS, `/tmp` often resolves to `/private/tmp`; if `allowedWorktreeRoots` uses the non-canonical path, the matrix should fail closed with `worktree_root_not_allowed`.

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
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:ollama-claude-code
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

## Opt-In Ollama Write Validation Smoke

The Ollama write validation smoke is the proof gate before any `ollama-claude-code:<profile-id>` should be enabled for normal isolated implementation work. It creates a disposable git fixture per selected provider, enables `writeValidated: true` only inside that fixture, starts a `slice-implementer`, verifies the expected file appears only in the isolated worktree, records dashboard and summary evidence, and removes the retained worktree through `agent_team_cleanup`.

Latest live Ollama write proof evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-ollama-write-proof.md`.

Inspect the plan without provider use:

```bash
npm run smoke:ollama-write -- --dry-run --provider ollama-claude-code:kimi-k2.6
```

Run the confirmed validation after building the packaged runtime:

```bash
npm run build
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:kimi-k2.6
```

The report includes provider ids, run ids, terminal status, changed files, isolated worktree evidence, cleanup status, dashboard counts, summary groups, sidecar/log paths, and known limitations. It does not print prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets. Passing this smoke proves isolated write containment for the selected profile only; it makes no model-quality, ranking, autonomous-implementation, or broad write-readiness claim.

In this repository, `kimi-k2.6`, `glm-5.1`, and `deepseek-v4-flash` have passed this disposable-fixture write validation through the packaged MCP path. Other profiles should keep `writeValidated: false` until they pass the same proof.

## Opt-In Gemini CLI Write Validation Smoke

Use this proof before enabling Gemini CLI as a write-capable `frontend-engineer` in normal workspaces. It creates a disposable git fixture with `index.html`, enables `writeValidated: true` only inside that fixture, starts a `frontend-engineer`, verifies the UI file changed only in the isolated worktree, records dashboard and summary evidence, and removes the retained worktree through `agent_team_cleanup`.

Latest live Gemini CLI write proof evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-gemini-write-proof.md`.

Inspect the plan without provider use:

```bash
npm run smoke:gemini-write -- --dry-run --provider gemini-cli
```

Run the confirmed validation after building the packaged runtime:

```bash
npm run build
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN GEMINI_CLI_TRUST_WORKSPACE=true npm run smoke:gemini-write -- --confirm-live-provider-use --provider gemini-cli --model gemini-3-flash-preview --timeout-ms 240000
```

The smoke defaults to `gemini-3-flash-preview` because Pro preview capacity can be transiently exhausted; pass `--model gemini-3.1-pro-preview` or another Gemini CLI model only when you intentionally want to validate that exact model. The report includes provider ids, run ids, terminal status, changed files, isolated worktree evidence, cleanup status, dashboard counts, summary groups, sidecar/log paths, and known limitations. It does not print prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets. Passing this smoke proves isolated write containment for `gemini-cli` only; it makes no model-quality, ranking, broad frontend-quality, or mid-flight steering claim.

## Basic Workflow

1. Build and smoke the packaged runtime with `npm run build`, `npm run smoke:mcp-stdio`, `npm run smoke:workflow-orchestrator`, and `npm run smoke:package`.
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

## Workflow Orchestrator

For a complete L11 engineering workflow, use the workflow orchestrator tools in the operator runbook: `docs/runbooks/claude-team-session.md`.

The public workflow loop is:

1. `agent_team_create_workflow`
2. `agent_team_plan_consensus`
3. `agent_team_start_slices`
4. `agent_team_unblock_slice`
5. `agent_team_review_slice`
6. `agent_team_integration_queue`
7. Codex-owned manual integration outside the plugin
8. `agent_team_record_integration`
9. `agent_team_workflow_report`
10. `agent_team_cleanup`

`agent_team_workflow_report` returns `completionStatus` and only reports `complete` after planning is approved, every slice is integrated, and durable passing final gate verification exists for every slice. It also reports blocked, incomplete, ready-to-integrate, missing-evidence, and cleanup-ready rows.

Codex owns technical decisions, integration, review synthesis, and final authority. Users should only be asked CEO/product-level decisions with practical product, trust, cost, user-impact, or release-tradeoff consequences. Cleanup is explicit, and cleanup only after integration evidence is saved.

Run `npm run smoke:workflow-orchestrator` after `npm run build` for a fixture-safe packaged MCP proof of this loop. It creates a disposable git workspace, drives public workflow tools through `dist/index.js`, records degraded Opus evidence without blocking, proves `completionStatus` only becomes `complete` after final gate evidence, and removes the fixture. It does not call providers, does not use API keys, and makes no model-quality or provider capability claim.

Final product-readiness evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`.

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
