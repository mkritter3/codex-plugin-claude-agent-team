# Agent Team MCP Milestone 49 Ollama Write Validation Plan

**Goal:** Prove selected Ollama Claude Code profiles can safely perform isolated implementation writes before any profile is treated as write-capable in normal workspaces.

**Architecture:** Add an opt-in live smoke that creates a disposable git fixture per provider, enables `writeValidated: true` only inside that fixture, starts a `slice-implementer` through packaged MCP stdio, verifies the expected file appears only in the isolated execution worktree, records dashboard and summary evidence, and removes the retained worktree through `agent_team_cleanup`.

## Success Criteria

- `npm run smoke:ollama-write` exists and is excluded from CI.
- The command fails closed unless `--dry-run` or `--confirm-live-provider-use` is supplied.
- Only exact `ollama-claude-code:<profile-id>` selectors are accepted; no family selector or implicit provider routing is allowed for write validation.
- Each live proof uses a disposable git fixture with fixture-local `writeValidated: true`, `writeMode.enabled`, `requireIsolatedWorktree`, `allowWriteMode`, and one allowed worktree root.
- The provider must expose `edits` and `workspaceIsolation` in the fixture before the run starts.
- The run must complete as `slice-implementer`, retain a git worktree, change only `OLLAMA_WRITE_PROOF.txt`, leave the source workspace unmodified, and then clean up the retained worktree.
- The sanitized report includes provider ids, run ids, terminal status, changed files, worktree containment, cleanup status, dashboard counts, summary groups, sidecar/log paths, and known limitations.
- The report never prints prompts, task text, provider endpoints, raw provider payloads, provider session ids, process metadata, command details, environment values, mailbox payloads, or secrets.
- Passing this milestone proves isolated write containment and control-plane behavior only; it makes no benchmark, model-quality, provider-ranking, or broad autonomous-implementation claim.

## Validation

```bash
npm test -- tests/live-smoke-ollama-write-validation.test.ts
npm run typecheck
npm test
npm run build
npm run ci
```

Opt-in live validation:

```bash
npm run build
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:kimi-k2.6
npm run smoke:ollama-write -- --confirm-live-provider-use --provider ollama-claude-code:glm-5.1 --provider ollama-claude-code:deepseek-v4-flash
```

## Status

Complete. `npm run smoke:ollama-write` now provides a fail-closed dry-run and opt-in live write-validation harness for exact `ollama-claude-code:<profile-id>` selectors. The harness creates disposable git fixtures, enables fixture-local write capabilities, validates provider `edits` and `workspaceIsolation` exposure, starts `slice-implementer` through packaged MCP stdio, proves `OLLAMA_WRITE_PROOF.txt` is changed only in the isolated execution worktree, records dashboard and summary evidence, and removes retained worktrees through `agent_team_cleanup`.

Live validation passed for:

- `ollama-claude-code:kimi-k2.6`: `run_20260513060719368_a9dc7d7652ad`
- `ollama-claude-code:glm-5.1`: `run_20260513060751894_0518a2eded68`
- `ollama-claude-code:deepseek-v4-flash`: `run_20260513060816620_3f0f2a16aa21`

This proves isolated write containment and cleanup for these profiles in disposable fixtures only. It does not claim provider ranking, broad autonomous implementation readiness, or practical long-context behavior.
