# Agent Team MCP Milestone 50 Claude Model Profile Proof Plan

**Goal:** Prove Claude Code CLI alias-based model profiles can be selected through the Agent Team MCP provider layer while preserving subscription OAuth, provider-neutral routing, and sanitized evidence.

**Architecture:** Add first-class `providers.claudeCodeCli.profiles` config for alias profiles such as `opus`, `sonnet`, and `haiku`. Profile descriptors use dynamic provider ids like `claude-code-cli:opus`, route back to the existing Claude Code CLI runtime, and pass only the selected `model` alias into the shared Claude command path. Add an opt-in packaged MCP smoke that creates a disposable fixture with the three aliases and runs read-only dispatch proof for each.

## Success Criteria

- `claude-code-cli` remains the default subscription-OAuth provider.
- `claude-code-cli:<profile-id>` descriptors are listed only when configured.
- Profile descriptors use `authMode: "subscription-oauth"` and do not introduce API-key env handling.
- Runtime lookup aliases profile ids back to the existing Claude Code CLI runtime.
- Print and background session paths pass the configured alias model to the shared Claude Code CLI command builders.
- Write capabilities remain withheld unless an exact profile is explicitly `writeValidated: true` and workspace isolated write mode is enabled.
- MCP provider listing exposes provider ids, display names, auth mode, capabilities, and model only; it does not expose prompts, secrets, provider internals, or command details.
- `npm run smoke:claude-models` exists, fails closed without `--dry-run` or `--confirm-live-provider-use`, creates a disposable fixture for live proof, and exercises only public packaged MCP tools.
- Passing live proof shows exact alias routing and provider response only; it makes no provider ranking, provider comparison, model-quality, or broad coding-readiness claim.

## Validation

```bash
npm test -- tests/core/config.test.ts tests/providers/claude-code-cli/config.test.ts tests/providers/claude-code-cli/runtime.test.ts tests/providers/runtime.test.ts
npm test -- tests/core/router.test.ts tests/mcp/tools.test.ts tests/live-smoke-claude-model-profiles.test.ts
npm run typecheck
npm test
npm run build
npm run smoke:claude-models -- --dry-run
npm run ci
```

Opt-in live validation:

```bash
npm run build
npm run smoke:claude-models -- --confirm-live-provider-use
```

## Status

Complete. `providers.claudeCodeCli.profiles` now exposes alias-based Claude Code CLI profile descriptors without changing the base `claude-code-cli` provider. Profile ids such as `claude-code-cli:opus`, `claude-code-cli:sonnet`, and `claude-code-cli:haiku` route back to the existing Claude Code CLI runtime, use subscription OAuth, pass only the configured alias model into the shared command path, and do not add API-key env handling.

`npm run smoke:claude-models` now provides a fail-closed dry-run and opt-in live proof over packaged MCP stdio. The script creates a disposable git fixture, configures the three aliases, scrubs subscription-override API-key env vars from its child MCP process, verifies `policy.liveSmokeEnabled`, lists providers, dispatches each profile as read-only, and records dashboard plus summary evidence.

Live validation passed for:

- `claude-code-cli:opus`: `run_20260513062304592_5a1615fba6d6`
- `claude-code-cli:sonnet`: `run_20260513062318474_2a462837f9af`
- `claude-code-cli:haiku`: `run_20260513062411384_0ae2d3662230`

This proves exact alias routing and provider response through the packaged MCP boundary only. It does not claim provider ranking, broad coding readiness, practical long-context behavior, or model-quality results.
