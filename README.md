# Codex Plugin Claude Agent Team

Provider-neutral Agent Team MCP plugin for Codex. The plugin lets Codex start, inspect, message, wind down, and clean up durable external agent runs while Codex remains the orchestrator and final integration authority.

Claude Code CLI subscription OAuth remains the mature v1 transport, and the default routing preference now puts Ollama-native Claude Code profiles first for read-oriented planning and review when local Ollama plus Claude Code are ready. The core stays provider-neutral so other providers can plug into the same roles, lifecycle, mailbox, verdict, status, cleanup, and evidence contracts. The MCP server is host-agnostic at the protocol boundary; Codex-specific plugin packaging is one host shell, not the provider model.

## Choose the coordinator and decision makers independently

The active session can stay on Sol, Terra, Luna or Astra. Configure each workflow with `agent_team_configure_orchestration`, then use `agent_team_prepare_assignments` to route native Codex models and external provider profiles together. A runtime-confirmed matching active model/effort handles planning once without spawning a duplicate. Implementation can override its model per slice, including active Astra for visual work. Reviews use an independent execution.

A sole selected reviewer has authority. A panel requires every selected member to approve the same artifact; the coordinator cannot override dissent, missing votes or a round limit. New `authority` evidence is required on existing planning/review tools for configured workflows. Native completion evidence enters the existing review and integration queue through `agent_team_record_native_implementation`. External approvals reference actual completed Agent Team runs; native identities and artifact digests are reported by the host.

See the [orchestration guide](skills/codex-agent-team-orchestrator/references/orchestration.md) for a native Astra/Sol example, mixed panels, exact role and model overrides, caching discipline, and the optional AGY driver for Gemini. The MCP server prepares native assignments; Codex's native agent tools execute them. Existing workflows without an orchestration policy keep their legacy behavior.

## Safety Model

- MCP is the public product boundary.
- Every run has a durable sidecar, mailbox records, logs, transcript paths, verdicts, and cleanup metadata.
- `slice-implementer` writes only in a retained isolated worktree.
- Codex reviews and integrates implementation diffs.
- Cleanup is explicit through `agent_team_cleanup`.
- Live provider usage is an opt-in live smoke and is not part of CI.

The server runs locally over stdio using the host's filesystem permissions and provider authentication. Git worktrees separate changes for review; they are not an operating-system sandbox. Use trusted workspaces and keep provider credentials and `.agent-team/` runtime data out of version control. Native vote identities are attested by the coordinating host, not independently authenticated by this MCP server.

## Codex-Orchestrated Product Path

The product path is direct MCP orchestration from Codex, not a harness. Codex should run `agent_team_doctor`, create the workflow, record planning consensus, start bounded slices, steer agents through mailboxes, review slice evidence, integrate approved retained worktree diffs, record integration verification, and clean up only after evidence is saved.

Dogfood and live-smoke scripts are regression and live-proof tools. They are useful for proving packaging, provider wiring, and edge cases, but they are not the user-facing way to operate an agent team.

The packaged plugin ships `skills/codex-agent-team-orchestrator/SKILL.md` so a loaded Codex session has direct operating instructions for this workflow.

## Prerequisites

- Node.js 22 or newer.
- npm.
- Git.
- Claude Code CLI installed and authenticated with Claude Code CLI subscription OAuth.
- A workspace where `.agent-team/` state can be written.

## Native Codex Install

Install `codex-plugin-claude-agent-team` from the `local-plugins` marketplace in Codex's plugin browser. For a personal marketplace, place its manifest at `../.agents/plugins/marketplace.json` relative to this checkout and point its local source at `./codex-plugin-claude-agent-team`.

After install, run `/reload-plugins` or start a fresh Codex session. Then ask Codex to use Agent Team and call `agent_team_doctor` followed by `agent_team_list_providers` in the target workspace. If those tools are missing after reload, the plugin has not been loaded by the host; run `npm run install:check` and `npm run verify:distribution` from this plugin checkout to check package and marketplace metadata.

Do not run `codex mcp add`; the plugin ships its MCP server through `.codex-plugin/plugin.json` and `.mcp.json`. Manual MCP config is diagnostic output for hosts that do not yet support plugins.

## Local Installation

From this repository:

```bash
npm run install:check
npm run verify:distribution
npm run smoke:mcp-stdio
npm run smoke:workflow-orchestrator
npm run smoke:package
npm run smoke:claude-live -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:claude-models -- --dry-run
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:gemini
```

For a fresh development or CI checkout, run `npm ci` followed by `npm run ci`; no personal marketplace is required. Distribution verification also checks the sibling marketplace when present. To require that local installation check explicitly, run `npm run verify:distribution -- --require-local-marketplace`.

Codex launches the plugin through `scripts/start-mcp.sh`. On first run, that wrapper installs npm dependencies when `node_modules/` is missing and builds `dist/index.js` when the runtime is missing, while keeping MCP stdout clean. Manual `npm ci` and `npm run build` are still useful for development and CI, but they are not required before a local Codex install can start the server.

For native Codex plugin installs, the bundled `.mcp.json` sets `"cwd": "."` on the `agent-team` server. Codex resolves that relative cwd to the installed plugin root, so `./scripts/start-mcp.sh` works from any user workspace instead of depending on the current session directory. The same config sets `"startup_timeout_sec": 120` so a clean install has enough time for the wrapper's one-time dependency install and build.

The built executable is exposed as the `agent-team-mcp` package bin and points to `"./dist/index.js"`.

`npm run install:check` prints a sanitized install handoff report. It validates package metadata, plugin metadata, local MCP config, the first-run launcher, the first-run lockfile, the runtime build-cache state, and packaged install scripts; it does not call providers, read credentials, or start live runs. The report includes an absolute MCP config only for MCP hosts that do not support Codex plugins:

```json
{
  "mcpServers": {
    "agent-team": {
      "command": "sh",
      "args": ["/absolute/path/to/codex-plugin-claude-agent-team/scripts/start-mcp.sh"],
      "startup_timeout_sec": 120
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
      "command": "sh",
      "args": ["./scripts/start-mcp.sh"],
      "cwd": ".",
      "startup_timeout_sec": 120
    }
  }
}
```

The launcher performs the first-run build before starting the packaged runtime entrypoint.

## Workspace Config

The default posture is local-first and write-capable through retained isolated worktrees. Missing `.agent-team/config.json` means `writeMode.enabled: true`, `requireIsolatedWorktree: true`, unrestricted roles/providers, and audit enabled. Add config only when you want to restrict routing or override defaults:

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

Without a workspace override, the default provider order is `family:ollama-claude-code`, `claude-code-cli`, `family:ollama-cloud`, `gemini-cli`, then `codex-cli`. The default config includes `claude-code-cli:opus` as a read-only senior review profile when Claude Code CLI is available. GLM 5.2 and Kimi K2.7 Code are default write-validated Ollama-native junior workers after their 2026-06-28 packaged MCP proofs; any future unvalidated Ollama profile still falls through to another write-capable provider by capability rather than preference alone.

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

Profile provider ids use `claude-code-cli:<profile-id>`, for example `claude-code-cli:opus`. They use `authMode: "subscription-oauth"` and do not introduce API-key env handling. `claude-code-cli:opus` ships as the default read-only senior review profile; omitting `providers.claudeCodeCli.profiles` inherits that built-in profile, while setting `profiles: []` intentionally disables it. Additional Claude aliases such as Sonnet and Haiku can be configured per workspace. Write capabilities remain withheld unless an exact profile is explicitly marked `writeValidated: true` and the workspace has isolated write mode enabled.

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

Ollama Cloud profiles are auto-listed through the OpenAI-compatible runtime. By default, `ollama-cloud:glm-5.2` and `ollama-cloud:kimi-k2.7-code` use `https://ollama.com/v1` with the shared `OLLAMA_API_KEY` environment variable. These `ollama-cloud:*` providers are the chat-completions route, not the Claude Code harness route. When `OLLAMA_API_KEY` is present, those profiles become available automatically; when it is missing, they stay visible as unavailable providers and do not block other installed CLIs.

You can override the default profile list when you need custom endpoints, model ids, or environment variable names:

```json
{
  "providers": {
    "ollamaCloud": {
      "enabled": true,
      "profiles": [
        {
          "id": "glm-5.2",
          "baseUrl": "https://ollama.example/v1",
          "model": "glm-5.2",
          "apiKeyEnv": "GLM_API_KEY",
          "displayName": "GLM 5.2",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": false
          }
        },
        {
          "id": "kimi-k2.7-code",
          "baseUrl": "https://ollama.example/v1",
          "model": "kimi-k2.7-code",
          "apiKeyEnv": "KIMI_API_KEY",
          "displayName": "Kimi K2.7 Code",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "reasoning": false
          }
        }
      ]
    }
  }
}
```

Profile provider ids use `ollama-cloud:<profile-id>`, for example `ollama-cloud:glm-5.2`. Profiles support synchronous read-only dispatch only; run live smoke separately before making any real-provider readiness, provider performance, or long-context claims. Do not use `model:glm-5.2` or `model:kimi-k2.7-code` to choose between Ollama families; when the same model exists in both `ollama-cloud:*` and `ollama-claude-code:*`, the router rejects the ambiguous model selector and requires an exact provider id or family selector.

Ollama Claude Code profiles are the Claude Code harness route for Ollama models while keeping the same lifecycle, mailbox, status, wind-down, cancellation, dashboard, summary, and cleanup contracts. By default, `ollama-claude-code:glm-5.2` and `ollama-claude-code:kimi-k2.7-code` run through Ollama's native Claude Code launcher: `ollama launch claude --model <model> --yes -- <claude args>`. This is the default `launchMode: "ollama-launch"` path, uses the locally authenticated Ollama installation, and does not require `OLLAMA_API_KEY` when `ollama` is already signed in. `agent_team_doctor` verifies the local CLIs and warns that doctor itself is not a live cloud-model proof; rely on explicit opt-in smoke evidence such as the GLM 5.2 and Kimi K2.7 Code proofs recorded below. Override `providers.ollamaClaudeCode` only when you need custom launch mode, endpoints, model ids, or capability declarations:

```json
{
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
          "writeValidated": true,
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true,
            "edits": true,
            "workspaceIsolation": true
          }
        },
        {
          "id": "kimi-k2.7-code",
          "model": "kimi-k2.7-code:cloud",
          "displayName": "Kimi K2.7 Code",
          "writeValidated": true,
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true,
            "edits": true,
            "workspaceIsolation": true
          }
        }
      ]
    }
  }
}
```

Profile provider ids use `ollama-claude-code:<profile-id>`, for example `ollama-claude-code:glm-5.2`. At launch time the adapter creates a scoped local Ollama env for that run only: `ANTHROPIC_BASE_URL` points at the local Ollama server, `ANTHROPIC_AUTH_TOKEN` uses the configured non-secret token value, `ANTHROPIC_API_KEY` is intentionally blank for Claude Code compatibility, and normal Claude Code OAuth plus ambient Anthropic auth variables are stripped. In `ollama-launch` mode the actual process is wrapped with `ollama launch claude --model <profile.model> --yes --`, so Ollama handles local/cloud model auth. `launchMode: "local-anthropic"` keeps the same local env but calls `claude --model <profile.model>` directly. `launchMode: "direct-api"` is the explicit legacy fallback for direct remote Anthropic-compatible access and is the only Ollama Claude Code mode that requires `OLLAMA_API_KEY`; omitted direct-api profiles stay read-only until exact direct-api write validation is proven. This scoped provider env is not applied to the normal `claude-code-cli` provider, so Claude Code CLI subscription OAuth keeps its fail-closed auth posture. Use `ollama-claude-code:*`, not `ollama-cloud:*` or `model:*`, when the goal is to route through the Claude Code harness.

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

Gemini CLI is a separate auth-backed provider for local Google sign-in/OAuth usage. It is auto-configured by default and intentionally distinct from the API-key `gemini` adapter. If `gemini` is not on `PATH`, `agent_team_list_providers` and `agent_team_doctor` report it as unavailable instead of requiring manual activation. `model` is optional; omit it to let the installed Gemini CLI use its own default:

```json
{
  "providers": {
    "geminiCli": {
      "enabled": true,
      "executable": "gemini",
      "displayName": "Gemini CLI",
      "projectEnv": "GOOGLE_CLOUD_PROJECT",
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
  }
}
```

`gemini-cli` uses `authMode: "oauth"` and does not require or infer `GEMINI_API_KEY`. Install and sign in to Gemini CLI first, then run `agent_team_doctor`; some Google Workspace or Code Assist setups may also require the configured project env. Gemini CLI implementation runs use retained isolated worktrees and `--approval-mode auto_edit`; read-only runs use `--approval-mode plan`. The plugin never uses Gemini CLI `--yolo`.

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

If Gemini returns rate limits, timeouts, or provider-unavailable errors, provider health cooldowns cause normal default/family routing to avoid it temporarily while exact `gemini-cli` requests remain explicit probes.

Codex CLI is a subscription-backed provider for local Codex login usage. It is auto-configured by default when `codex` is on `PATH` and remains separate from Codex as the host/orchestrator: host Codex remains the senior engineer and integration authority, while `codex-cli` can be routed as a normal agent-team worker. `model` is optional; omit it to use the installed Codex CLI default.

```json
{
  "providers": {
    "codexCli": {
      "enabled": true,
      "executable": "codex",
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
  }
}
```

Codex CLI read-only dispatch uses `codex exec --sandbox read-only` with the workspace. Isolated write dispatch uses `--sandbox workspace-write` and retained isolated worktrees. The adapter never uses `--dangerously-bypass-approvals-and-sandbox`. It reports `authMode: "subscription-oauth"` and removes `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, and `OPENAI_PROJECT` from provider launches so local Codex CLI login remains the auth boundary.

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

Native Ollama GLM 5.2 and Kimi K2.7 Code write proof evidence, plus historical pre-native Ollama evidence, is recorded in `docs/superpowers/reports/2026-05-13-agent-team-live-ollama-write-proof.md`.

Inspect the plan without provider use:

```bash
npm run smoke:ollama-write -- --dry-run --provider ollama-claude-code:glm-5.2
npm run smoke:ollama-write -- --dry-run --provider ollama-claude-code:kimi-k2.7-code
```

Run the confirmed validation after building the packaged runtime:

```bash
npm run build
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:glm-5.2
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:kimi-k2.7-code
```

The report includes provider ids, run ids, terminal status, changed files, isolated worktree evidence, cleanup status, dashboard counts, summary groups, sidecar/log paths, and known limitations. It does not print prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets. Passing this smoke proves isolated write containment for the selected profile only; it makes no model-quality, ranking, autonomous-implementation, or broad write-readiness claim.

The current default `ollama-claude-code:glm-5.2` and `ollama-claude-code:kimi-k2.7-code` profiles are write-validated by the native proofs recorded in that report. Any additional Ollama Claude Code profile should keep `writeValidated: false` until that exact provider id passes the same disposable-fixture proof through the packaged MCP path.

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

## Opt-In Live Dogfood App

`npm run dogfood:live-app` is the live end-to-end dogfood harness for the Workflow Orchestrator. It creates a disposable static app fixture, enables isolated write mode only inside that fixture, records planning approval and a product-level user decision, starts provider-specific workflow slices with `agent_team_start_slices`, reviews completed slice evidence, performs Codex-owned manual integration by copying only whitelisted files from retained worktrees, runs final fixture `npm test`, records integration evidence, reads workflow report/dashboard/summary, and then cleans up through `agent_team_cleanup`.

Inspect the plan without provider use:

```bash
npm run dogfood:live-app -- --dry-run
```

Run the confirmed dogfood after building the packaged runtime:

```bash
npm run build
env -u ANTHROPIC_API_KEY npm run dogfood:live-app -- --confirm-live-provider-use --timeout-ms 300000 --max-wait-ms 360000
```

The sanitized report uses the `dogfood_app_workflow_only` claim boundary. It can include Claude Opus required-when-available planning evidence, Gemini UI work, Codex implementation/test work, and optional Ollama junior documentation work when an Ollama Claude Code provider is healthy and `--include-optional-ollama` is passed. It is not part of CI and does not print private prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets. Passing the dogfood proves the public workflow/control-plane path can coordinate and integrate real provider-backed app slices in a disposable fixture; it does not compare providers, evaluate model quality, or prove broad product readiness.

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
3. `agent_team_workflow_next`
4. `agent_team_record_user_decision`
5. `agent_team_start_slices`
6. `agent_team_unblock_slice`
7. `agent_team_review_slice`
8. `agent_team_integration_queue`
9. Codex-owned manual integration outside the plugin
10. `agent_team_record_integration`
11. `agent_team_workflow_report`
12. `agent_team_cleanup`

`agent_team_workflow_report` returns `completionStatus` and only reports `complete` after planning is approved, every slice is integrated, and durable passing final gate verification exists for every slice. It also reports blocked, incomplete, ready-to-integrate, missing-evidence, and cleanup-ready rows.

Codex owns technical decisions, integration, review synthesis, and final authority. Users should only be asked CEO/product-level decisions with practical product, trust, cost, user-impact, or release-tradeoff consequences. Cleanup is explicit, and cleanup only after integration evidence is saved.

Run `npm run smoke:workflow-orchestrator` after `npm run build` for a fixture-safe packaged MCP proof of this loop. It creates a disposable git workspace, drives public workflow tools through `dist/index.js`, records degraded Opus evidence without blocking, proves `completionStatus` only becomes `complete` after final gate evidence, and removes the fixture. It does not call providers, does not use API keys, and makes no model-quality or provider capability claim.

Final product-readiness evidence is recorded in `docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`.

## Guided Agent Team Workflow

`agent_team_workflow_next` reads a durable workflow and returns a sanitized next-action plan. It does not start providers, mutate source, merge code, delete worktrees, or claim verification. Codex uses it as the hook layer for a Superpowers-style loop while remaining the senior engineer, reviewer, integrator, and final authority.

`agent_team_record_user_decision` records only product-level or practical-impact decisions from the user: product behavior, trust, cost, release posture, permission posture, or user impact. Routine technical decisions stay with Codex and are recorded as Codex rationale rather than pushed back to the user.

Hook Hierarchy:

1. Brainstorm with the user until product goal, non-goals, success criteria, and practical user effects are clear.
2. Write the plan and run planning consensus.
3. Request user approval for product-level plan effects.
4. Start ready independent slices with bounded concurrency.
5. Record mailbox updates for steering, blockers, and dependency unblocks.
6. Review implementation slices with Codex and senior review.
7. Queue integration in read-only mode.
8. Codex integrates one reviewed slice at a time.
9. Record integration evidence.
10. Run verification gates.
11. Report completion only when final gates are met.
12. Clean up retained worktrees and sidecars only after evidence is saved.

Provider steering is reported truthfully. A run may support `live` steering when an input channel is open, `recorded_for_resume` when mailbox guidance can be used on resume, `follow_up_run` when Codex must launch a corrected follow-up, `cancel_wind_down` when stopping or replacing a worker is the safe path, or `unsupported` when the lifecycle state cannot be steered.

Default routing prefers Ollama-native GLM 5.2 and Kimi K2.7 Code for read-oriented planning and review when doctor shows the local launch path is ready. `claude-code-cli:opus` is the default read-only senior planning, architecture, security, high-complexity review, and sign-off brain when Claude Code CLI is available. GLM 5.2 and Kimi K2.7 Code are default write-validated Ollama-native junior workers for bounded isolated implementation. Sonnet and Codex CLI remain strong autonomous implementation fallbacks in retained isolated worktrees when configured and healthy. Haiku is preferred for search and reconnaissance when configured. Gemini CLI is a full autonomous worker when configured, with default preference for UI, UX, frontend, visual, and browser-flow work.

## Delegation Playbook

The Delegation Playbook is the reusable strategy layer Codex uses before dispatching an agent team. It is advisory and returns `routing_guidance_only`: role and provider preferences, evidence requirements, steering posture, risk controls, and user-escalation categories. It does not start providers, mutate source, merge code, delete worktrees, or make provider-ranking or model-quality claims.

Default playbook preferences:

- Planning, architecture, high-complexity review, security-sensitive decisions, and final senior sign-off: `claude-code-cli:opus`.
- Senior implementation and execution: `claude-code-cli:sonnet` and `codex-cli`.
- Search, reconnaissance, lightweight scans, and summaries: `claude-code-cli:haiku`.
- UI, UX, frontend, visual, product-flow, and browser-oriented work: `gemini-cli` when configured and healthy.
- Junior contained implementation: `ollama-claude-code:glm-5.2` and `ollama-claude-code:kimi-k2.7-code`.

Codex remains the final authority. Junior and UI workers can be autonomous, but write-capable work still requires retained isolated worktrees, bounded write scopes, changed-file evidence, tests run, senior review, and Codex-owned integration before cleanup.

## Workflow Validation

`npm run validate:workflow-fixtures` builds the package and runs deterministic workflow validation fixtures through the packaged validation runner. The report is written to `.agent-team/reports/workflow-fixture-validation.json`, uses the `workflow_mechanics_only` claim boundary, records `liveProviderCalls: 0`, and proves workflow mechanics such as approval gates, blocked dependencies, mailbox evidence, review gates, integration evidence, failed-test evidence, cleanup posture, and public-output sanitization.

`npm run scan:workflow-validation` checks the validation harness and methodology for unsafe public-output claims, raw provider payload terms, private instruction leakage, and secret names.

`npm run validate:workflow-live` is opt-in only. It requires `AGENT_TEAM_LIVE_WORKFLOW_VALIDATE=1` and `AGENT_TEAM_LIVE_WORKFLOW_PROVIDERS=...`, then emits a `provider_transport_capability_only` plan for real provider proof. It is not part of CI and does not run live providers from fixture validation.

Validation methodology is documented in `docs/superpowers/reports/2026-05-13-agent-team-workflow-validation-methodology.md`.

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

`npm run ci` runs typecheck, tests, build, install handoff preflight, native distribution verification, packaged stdio smoke, workflow orchestrator smoke, package dry-run smoke, workflow guidance scan, deterministic workflow fixture validation, and workflow validation scan in that order.
