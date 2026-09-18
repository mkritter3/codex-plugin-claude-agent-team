# Changelog

All notable changes to this local plugin are recorded here.

## Unreleased

- Made dispatch, lifecycle, routing, and runtime test fixtures independent of locally installed provider CLIs.

- Refreshed the Codex listing to describe native and cross-provider orchestration, replaced internal workflow jargon with plain-language prompts, and assigned a distinct install version.

- Made distribution verification work from standalone checkouts while retaining optional strict personal-marketplace validation, refreshed compatible dependency fixes, and excluded local environment files from Git.
- Added workflow-specific native/provider orchestration policies, explicit sole-reviewer or unanimous-panel authority, artifact-bound votes, and validation against completed external runs.
- Added native assignment preparation, matching active-session reuse for planning/implementation, per-slice implementation overrides, native completion evidence and independent native review through the existing integration path.
- Replaced the Gemini CLI transport with the canonical `agy` provider and `providers.agy` configuration. AGY uses sandboxed plan/accept-edits modes, JSON result validation, and conversation resumption.
- Migrated saved Gemini CLI selectors/configuration to AGY without carrying over old executable paths or write validation. Legacy sessions require a new AGY run. AGY implementation remains opt-in after a fresh live write proof.
- Added operator guidance for economical model selection, bounded context, session reuse and CLI maintenance. Legacy workflows remain compatible.


## 0.1.5

- Added a native distribution verifier and workspace marketplace guard so the Codex plugin install path, bundled MCP config, package files, first-run docs, and `/reload-plugins` recovery instructions are checked in CI.
- Added a packed cold-install package smoke that extracts the tarball with no `node_modules`, launches through `scripts/start-mcp.sh`, and verifies a real MCP stdio connection.
- Added first-run lockfile validation to install preflight and changed the handoff wording so native Codex plugin install/reload is the primary path while manual MCP config is fallback-only.
- Refreshed lockfiles to patched transitive dependency versions and made `package-lock.json` / `npm-shrinkwrap.json` equality part of distribution verification.

## 0.1.4

- Fixed native Codex plugin MCP startup by adding `cwd: "."` and `startup_timeout_sec: 120` to the bundled `agent-team` stdio server config, then teaching install/package smoke checks to reject relative launchers without a plugin-root cwd or first-run startup budget.
- Added a packed `npm-shrinkwrap.json` so tarball-style clean installs have the lock source required by the first-run `npm ci` launcher.
- Hardened Ollama provider auth isolation: explicit env objects no longer fall back to ambient process env, Ollama Claude Code harness launches scrub Claude OAuth and ambient Anthropic auth values, native local launch mode strips direct API keys, and duplicated `model:*` selectors fail closed instead of silently choosing the wrong Ollama family.
- Auto-listed Ollama Claude Code harness profiles (`ollama-claude-code:glm-5.2` and `ollama-claude-code:kimi-k2.7-code`) through Ollama-native Claude Code launch (`ollama launch claude --model ... --yes -- ...`); the default mode uses local Ollama auth, while explicit `direct-api` mode remains the API-key-gated fallback.
- Marked `ollama-claude-code:glm-5.2` and `ollama-claude-code:kimi-k2.7-code` write-validated after the 2026-06-28 packaged MCP native Ollama write proofs.
- Kept omitted `direct-api` Ollama Claude Code profiles read-only despite native launch write validation, because the 2026-06-28 proofs cover `ollama-launch` only.
- Added `claude-code-cli:opus` as a default read-only senior review profile and documented that built-in subagents are only a fallback when the Agent Team MCP transport is unavailable, not a substitute for plugin workflow proof.
- Changed default provider order to prefer Ollama-native Claude Code for read-oriented routing and exact write-validated Ollama profiles for bounded isolated implementation; unvalidated Ollama profiles still fall through to other write-capable providers.
- Hardened native launcher startup so packaged installs can run without `npm` when `node_modules/` and `dist/` already exist, and fail clearly when Node.js is below 22.
- Changed native Ollama doctor checks to warn that local sign-in/cloud model access requires exact live proof instead of treating CLI presence as a completed model-access proof.
- Changed Codex MCP startup to use `scripts/start-mcp.sh` from `.mcp.json`, so a local plugin install can perform the one-time dependency install/build automatically instead of failing when gitignored `dist/` is absent.
- Updated install preflight and package smoke checks to treat the first-run launcher as the install contract, while still reporting whether the built runtime cache already exists.
- Changed the default workspace posture to isolated-write capable, auto-configured Claude/Gemini/Codex CLI workers. Gemini CLI and Codex CLI no longer require manual `enabled` flags or model pins; installed executables are discovered and missing CLIs are reported as unavailable instead of blocking other providers.
- Auto-listed Ollama Cloud read-only profiles (`glm-5.2` and `kimi-k2.7-code`) against `https://ollama.com/v1`; they become available when `OLLAMA_API_KEY` is present and otherwise remain visible as unavailable without blocking local CLI workers.

## 0.1.2

- Added Claude Code plugin packaging (`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`) so the same repo dual-hosts: Codex installs via `.codex-plugin/`, Claude Code installs via `.claude-plugin/`. Same MCP server, same orchestrator skill markdown, both hosts. The MCP runtime is host-agnostic at the protocol boundary as documented; this just adds the second plugin manifest.
- Added `scripts/start-mcp.sh` wrapper that auto-installs `node_modules` and builds `dist/` on first run, since both are gitignored. Wrapper communicates over stdio for MCP and routes setup progress to stderr so it does not corrupt the protocol channel. Subsequent runs `exec node dist/index.js` directly with no overhead.
- Bumped manifest versions to `0.1.2` in `package.json`, `.codex-plugin/plugin.json`, and the new `.claude-plugin/plugin.json` / `marketplace.json`.

## 0.1.1 (pre-Claude-Code-packaging)

- Added MCP runtime reload hardening: `agent_team_doctor` now reports live schema compatibility, install preflight warns about already-running Agent Team MCP servers with sanitized evidence, and the operator docs explain how to recover from stale schemas or `Transport closed` after rebuilds.
- Added explicit Claude Code CLI alias profiles for `opus`, `sonnet`, and `haiku` with subscription-OAuth routing plus an opt-in packaged MCP live proof script for exact model-profile dispatch.
- Added an opt-in Ollama Claude Code write-validation smoke that proves fixture-local isolated implementation, source-workspace containment, dashboard/summary evidence, and cleanup before profiles are treated as write-capable.
- Switched Ollama Claude Code profiles to the direct Ollama Cloud Anthropic-compatible endpoint (`https://ollama.com`) with bare model ids and Claude Code-compatible `ANTHROPIC_AUTH_TOKEN` / blank `ANTHROPIC_API_KEY` scoped env mapping.
- Added explicit Ollama Claude Code profiles with a single `OLLAMA_API_KEY`, scoped Anthropic-compatible environment mapping, conservative write-validation gating, and reuse of the Claude Code lifecycle for configured `ollama-claude-code:<profile-id>` providers.
- Added an opt-in Claude live capability matrix that uses packaged public MCP tools to validate direct dispatch, parallel read-only teams, isolated implementation handoff, mailbox delivery, wind-down, cancellation, team records, dashboard, summary, cleanup, and policy failure evidence; it is not part of CI and makes no provider ranking or model-quality claim.
- Hardened cancellation races so provider interruption caused by an explicit cancel request is recorded as `cancelled`, while genuine provider failure during cancellation remains terminal failure evidence instead of crashing control flow.

## 0.1.0

- Bootstrapped the Agent Team MCP package, plugin manifest, CI, package runtime, and stdio smoke.
- Added provider-neutral roles, capabilities, routing, lifecycle state, sidecars, mailboxes, logs, verdicts, recovery, cleanup, and doctor checks.
- Added Claude Code CLI subscription OAuth as the primary v1 provider adapter.
- Added durable background runs, status, message, reply, cancel, wind-down, cleanup, timeout expiry, detached reconciliation, and retained isolated implementation worktrees.
- Added bounded team tools for start, status, message, summary, cancel, and wind-down.
- Added a provider runtime conformance harness for future adapters.
- Added an explicitly configured OpenAI-compatible provider foundation for synchronous read-only dispatch with provider-scoped auth env checks and fail-closed lifecycle routing.
- Added explicit Ollama Cloud profiles backed by the OpenAI-compatible runtime for configured read-only Kimi/GLM-style dispatch.
- Added an explicitly configured Gemini adapter for synchronous read-only generateContent dispatch with provider-scoped auth env checks.
- Added explicit Grok profiles backed by the OpenAI-compatible runtime for configured read-only chat-completions dispatch with provider-scoped auth env checks.
- Added capability-first provider selection policy with role pins, provider order, neutral request selectors, and doctor routing explanations.
- Added durable team record tools for grouping related run ids without replacing per-run sidecars or lifecycle tools.
- Added `agent_team_dashboard` as a read-only dashboard and evidence report over saved teams or explicit run refs, including non-mutating corrupt-state reporting.
- Added provider-neutral policy and audit controls for role/provider allowlists, write-mode policy, retained worktree roots, doctor posture, and sanitized `.agent-team/audit/events.jsonl` evidence.
- Added config schema and state layout compatibility checks so unsupported future workspace shapes fail closed in doctor and config loading.
- Added `npm run smoke:package` and included it in `npm run ci` to verify dry-run package contents and built MCP entrypoint wiring.
- Added the Claude team session runbook and packaging hardening docs.
- Added an opt-in live Claude team smoke harness with dry-run planning, `policy.liveSmokeEnabled` gating, packaged MCP stdio execution, and sanitized report output; it is not part of CI.
- Added an install handoff preflight that validates the package/runtime surface and emits a sanitized absolute MCP config without provider calls.
- Added an opt-in read-only provider proof smoke harness for explicitly configured non-Claude providers through packaged MCP stdio; it is not part of CI and makes no provider comparison, ranking, score, or long-context claim.
- Hardened the opt-in live Claude smoke so it proves direct packaged-MCP Claude reachability, aligns MCP request timeouts with provider timeouts, reports success only for completed tracked runs, and preserves wind-down or cancellation evidence on bounded failures.

## Versioning Policy

- Patch versions cover documentation, tests, packaging metadata, and internal fixes that preserve public MCP behavior.
- Minor versions cover MCP tool surface changes, provider compatibility changes, config shape changes, and state layout changes.
- Major versions cover incompatible MCP schemas, state migrations, or lifecycle contract changes.
- Each release note must call out MCP tool surface changes, provider compatibility, config changes, state layout changes, and migration notes.
- `npm run ci` is the release gate before tagging or distributing an installable revision.
