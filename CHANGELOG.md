# Changelog

All notable changes to this private local plugin are recorded here.

## Unreleased

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
