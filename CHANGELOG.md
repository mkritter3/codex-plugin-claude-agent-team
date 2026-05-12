# Changelog

All notable changes to this private local plugin are recorded here.

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
- Added the Claude team session runbook and packaging hardening docs.

## Versioning Policy

- Patch versions cover documentation, tests, packaging metadata, and internal fixes that preserve public MCP behavior.
- Minor versions cover MCP tool surface changes, provider compatibility changes, config shape changes, and state layout changes.
- Major versions cover incompatible MCP schemas, state migrations, or lifecycle contract changes.
- Each release note must call out MCP tool surface changes, provider compatibility, config changes, state layout changes, and migration notes.
- `npm run ci` is the release gate before tagging or distributing an installable revision.
