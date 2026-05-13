# Agent Team MCP Milestone 62 Gemini CLI And Provider Cooldown Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for runtime and policy behavior. Use superpowers:using-git-worktrees for implementation after this plan is committed.

**Goal:** Add an auth-backed Gemini CLI provider path and shared provider cooldown/degradation policy so Codex can prefer stable providers, steer around flaky providers, and retry degraded providers sparingly with explicit evidence.

**Architecture:** Keep the public MCP surface provider-neutral. Add `gemini-cli` beside the existing API-key `gemini` adapter rather than mutating the existing provider contract. Add shared provider health state under `.agent-team` so transient provider failures such as Ollama `503 rate_limit` become durable routing evidence instead of chat-only memory. Provider health must influence selection only through explicit, explainable policy and must never become benchmark/model-quality ranking.

**Tech Stack:** TypeScript, Vitest, existing provider runtime registry, existing config parser, existing doctor/router/dispatch state paths, Gemini CLI OAuth through the local `gemini` executable.

---

## Scope

In scope:

- Add `gemini-cli` provider config with OAuth/auth-backed semantics.
- Add doctor checks for:
  - `gemini` CLI executable discovery
  - optional Google project env readiness
  - configured model/profile metadata
  - no API-key fallback
- Add a provider runtime that shells through Gemini CLI for read-only `runPrint` dispatch.
- Keep Gemini CLI background sessions, edits, cancellation, and workspace isolation unsupported unless separately proven.
- Add shared provider health state that records degraded providers, reasons, failure counts, timestamps, cooldown windows, and evidence pointers.
- Teach routing/dispatch to avoid degraded providers unless explicitly requested or cooldown allows a probe.
- Record provider degradation for clear transient failure classes such as HTTP `429`, `503`, rate limit, timeout, and provider unavailable.
- Document that Ollama is retried sparingly after instability, with Codex notifying the user when routing is degraded.

Out of scope:

- No Gemini API-key replacement or removal.
- No Gemini write mode.
- No real model-quality, benchmark, long-context, or provider-ranking claims.
- No Grok CLI work.
- No public MCP schema leak of internal prompts, raw provider payloads, CLI command arguments, tokens, or secrets.
- No live Gemini/Ollama smoke unless explicitly confirmed.

## L11 Quality Gates

- [x] TDD red proof is captured for Gemini CLI config/runtime and provider cooldown policy.
- [x] Focused tests cover config parsing, runtime fail-closed behavior, doctor checks, provider health persistence, cooldown routing, and explicit override semantics.
- [x] Typecheck, full tests, build, packaged stdio smoke, workflow smoke, package smoke, invariant scans, and `npm run ci` pass before merge.
- [x] Live provider proof is opt-in only and is not required for fixture-safe implementation.
- [x] Public schemas remain provider-neutral and sanitized.

## Success Criteria

- `gemini-cli` appears as a distinct provider only when explicitly configured.
- `gemini-cli` reports `authMode: "oauth"` and never requests or infers `GEMINI_API_KEY`.
- Doctor can explain missing CLI, missing OAuth/project readiness hints, and configured provider availability without exposing secrets.
- `gemini-cli` read-only dispatch uses the configured CLI executable/model and returns sanitized text/session evidence.
- Unsupported background/edit/session behavior fails closed.
- Provider degradation is durable, evidence-backed, and shared across providers.
- A provider with repeated transient failures is skipped by family/default routing during cooldown.
- An explicitly requested degraded provider is allowed only when policy says explicit probes are allowed, and the result records degraded evidence.
- Ollama `503 rate_limit`-style failures cause cooldown evidence so Codex avoids frequent repeated calls.
- Docs/runbook explain how to enable Gemini CLI OAuth and how degraded provider cooldown works.

## Required Edge Cases

- Existing API-key Gemini provider remains unchanged and distinct from Gemini CLI.
- Missing Gemini CLI executable fails before any provider call.
- Missing Google project env is a warning/hint, not always a hard failure, because OAuth mode can differ by account.
- Provider health state survives process restart through `.agent-team` files.
- Cooldown decisions preserve ordered, per-provider evidence and do not mutate public MCP tool schemas.
- Explicit provider selection never silently falls back to another provider.
- Cooldown is not a model-quality ranking or benchmark.

## File Plan

- Create `src/providers/gemini-cli/config.ts`
- Create `src/providers/gemini-cli/runtime.ts`
- Create `tests/providers/gemini-cli/config.test.ts`
- Create `tests/providers/gemini-cli/runtime.test.ts`
- Create `src/core/state/provider-health-store.ts`
- Create `src/core/provider-health.ts`
- Create `tests/core/state/provider-health-store.test.ts`
- Create `tests/core/provider-health.test.ts`
- Modify `src/core/types.ts`
- Modify `src/core/config.ts`
- Modify `src/providers/index.ts`
- Modify `src/providers/runtime.ts`
- Modify routing/dispatch surfaces only where needed to honor cooldown state.
- Modify doctor checks to include Gemini CLI and provider degradation evidence.
- Modify README/runbook with concise setup and cooldown behavior notes.
- Modify this plan with verification evidence.

## Task 1: Gemini CLI Config And Runtime

**Files:**

- Create `tests/providers/gemini-cli/config.test.ts`
- Create `tests/providers/gemini-cli/runtime.test.ts`
- Create `src/providers/gemini-cli/config.ts`
- Create `src/providers/gemini-cli/runtime.ts`
- Modify `src/core/types.ts`
- Modify `src/core/config.ts`
- Modify `src/providers/index.ts`
- Modify `src/providers/runtime.ts`

- [x] **Step 1: Write failing tests**

Require:

- disabled by default
- explicit `providers.geminiCli.enabled`
- descriptor `id: "gemini-cli"` and `authMode: "oauth"`
- no `apiKeyEnv`
- configured model/display name
- CLI executable missing fail-closed
- read-only run shells through injected runner with sanitized output
- startSession unsupported and fail-closed

- [x] **Step 2: Implement minimal provider**

Add the config parser, descriptor, runtime registration, and command invocation through an injected runner so tests do not call Gemini live.

## Task 2: Provider Health Cooldown

**Files:**

- Create `tests/core/state/provider-health-store.test.ts`
- Create `tests/core/provider-health.test.ts`
- Create `src/core/state/provider-health-store.ts`
- Create `src/core/provider-health.ts`
- Modify routing/dispatch surfaces as needed.

- [x] **Step 1: Write failing tests**

Require:

- transient failures classify as degradations
- provider health records include reason, failure count, cooldown-until, and evidence paths
- cooldown state persists and reloads
- family/default routing skips degraded providers
- explicit provider selection remains explicit and records degraded evidence
- cooldown expiry allows a probe

- [x] **Step 2: Implement shared provider health**

Keep the module provider-neutral. Do not encode Ollama-specific routing except through generic transient failure classification.

## Task 3: Doctor, Docs, And Verification

**Files:**

- Modify doctor checks
- Modify README/runbook
- Modify this plan

- [x] **Step 1: Add doctor/reporting tests**

Require doctor to show Gemini CLI readiness and provider degradation without secrets or raw payloads.

- [x] **Step 2: Update docs**

Add concise setup guidance:

- install/login to Gemini CLI
- configure `providers.geminiCli`
- optional Google project env
- provider cooldown behavior and Ollama retry sparing

- [x] **Step 3: Verification**

Run:

- `npm test -- tests/providers/gemini-cli/config.test.ts tests/providers/gemini-cli/runtime.test.ts tests/core/state/provider-health-store.test.ts tests/core/provider-health.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:mcp-stdio`
- `npm run smoke:workflow-orchestrator`
- `npm run smoke:package`
- invariant scans for leaked secrets/provider payloads/internal prompts/provider ranking claims
- `npm run ci`
- `git diff --check`

## Verification Evidence

Implementation evidence so far:

- TDD red: `npm test -- tests/providers/gemini-cli/config.test.ts tests/providers/gemini-cli/runtime.test.ts` failed because `src/providers/gemini-cli/*` did not exist.
- TDD red: `npm test -- tests/core/provider-health.test.ts tests/core/state/provider-health-store.test.ts` failed because shared provider health modules did not exist.
- TDD red: `npm test -- tests/core/dispatch.test.ts -t "transient provider failures"` failed because dispatch did not persist provider cooldown evidence.
- TDD red: `npm test -- tests/doctor.test.ts -t "Gemini CLI OAuth|provider cooldown"` failed until doctor reported Gemini CLI readiness and provider health evidence.
- Focused green: `npm test -- tests/providers/gemini-cli/config.test.ts tests/providers/gemini-cli/runtime.test.ts tests/core/provider-health.test.ts tests/core/state/provider-health-store.test.ts tests/core/dispatch.test.ts tests/providers/runtime.test.ts tests/core/config.test.ts tests/core/router.test.ts` passed 92 tests across 8 files.
- Expanded focused green: `npm test -- tests/providers/gemini-cli/config.test.ts tests/providers/gemini-cli/runtime.test.ts tests/core/provider-health.test.ts tests/core/state/provider-health-store.test.ts tests/core/dispatch.test.ts tests/providers/runtime.test.ts tests/core/config.test.ts tests/core/router.test.ts tests/doctor.test.ts` passed 128 tests across 9 files.
- `npm run typecheck` passed.
- `npm test` passed 593 tests across 81 files.
- `npm run build` passed.
- `npm run smoke:mcp-stdio` passed.
- `npm run smoke:workflow-orchestrator` passed with fixture-only execution, ordered public tool flow, blocked/unblocked probe, final completion evidence, `liveProviderUse: false`, and fixture cleanup.
- `npm run smoke:package` passed.
- Docs-facing invariant scan passed for internal prompt, hidden instruction, raw provider payload, provider session id, token assignment, process metadata, quality-score, model-quality comparison, provider-ranking, and API-key fallback patterns.
- `git diff --check` passed.
- `npm run ci` passed.
- No live Gemini/Ollama proof was run for this milestone; Gemini CLI and provider cooldown behavior are fixture-safe implementation claims only until opt-in live proof is requested.
