# Agent Team MCP Milestone 48 Ollama Claude Code Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit Ollama Claude Code profiles so configured Ollama Cloud models can use the existing Claude Code lifecycle without weakening subscription-first Claude behavior.

**Architecture:** Add a new `ollama-claude-code:<profile-id>` provider family that reuses the existing Claude Code command runner and background session runner with scoped per-run environment variables. The config stores shared non-secret Ollama settings and per-model profiles, while the actual API key is read once from plugin/MCP environment through `OLLAMA_API_KEY` or a configured env name. Write-capable capabilities stay disabled unless a profile explicitly marks write validation, and public MCP schemas remain provider-neutral.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing Claude Code CLI runner/session lifecycle, provider-neutral router, doctor health checks, `.agent-team/config.json`.

---

## File Structure

- Modify: `src/core/types.ts`
  - Add shared `ollamaClaudeCode` provider config and profile types.
- Modify: `src/core/config.ts`
  - Parse shared Ollama Claude Code settings and profiles with fail-closed validation.
- Create: `src/providers/ollama-claude-code/config.ts`
  - Build provider ids, descriptors, profile resolution, availability warnings, and scoped launch env.
- Create: `src/providers/ollama-claude-code/runtime.ts`
  - Reuse Claude Code print/background session paths with scoped Ollama/Anthropic-compatible env.
- Modify: `src/providers/index.ts`
  - List Ollama Claude Code providers.
- Modify: `src/providers/runtime.ts`
  - Route `ollama-claude-code:*` provider ids to the new runtime.
- Modify: `src/providers/claude-code-cli/types.ts`
  - Allow `model` and provider auth mode to be passed into shared Claude Code helpers.
- Modify: `src/providers/claude-code-cli/commands.ts`
  - Add `--model <model>` support.
- Modify: `src/providers/claude-code-cli/runner.ts`
  - Pass profile models into synchronous Claude Code dispatch.
- Modify: `src/providers/claude-code-cli/background.ts`
  - Accept non-subscription auth mode so scoped Ollama env does not trigger subscription override warnings.
- Modify: `src/doctor.ts`
  - Include sanitized config summary for Ollama Claude Code settings.
- Create: `tests/providers/ollama-claude-code/config.test.ts`
- Create: `tests/providers/ollama-claude-code/runtime.test.ts`
- Modify: `tests/providers/claude-code-cli/commands.test.ts`
- Modify: `tests/providers/claude-code-cli/background.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

## Success Criteria

- `ollama-claude-code:<profile-id>` providers are explicit and never inferred from Claude subscription mode.
- Shared `providers.ollamaClaudeCode.apiKeyEnv` defaults to `OLLAMA_API_KEY`; profiles do not require per-model API key envs.
- Scoped provider env sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `OLLAMA_API_KEY` only for that provider run.
- `claude-code-cli` subscription OAuth continues to fail closed when subscription-overriding env vars are present.
- `ollama-claude-code` profiles reuse dispatch and background lifecycle paths, including sidecars, mailboxes, status, wind-down, cancellation, dashboard, summary, and cleanup.
- `slice-implementer` routing remains unavailable for Ollama Claude Code profiles unless a profile explicitly declares write validation.
- Doctor reports sanitized config, API-key env presence, Claude CLI readiness, and capability posture without printing secrets or provider endpoints.
- Docs explain single API-key setup and opt-in live validation without provider ranking, benchmark, or model-quality claims.

## Task 1: Config And Descriptor Tests

**Files:**
- Create: `tests/providers/ollama-claude-code/config.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Create: `src/providers/ollama-claude-code/config.ts`
- Modify: `src/providers/index.ts`

- [ ] **Step 1: Write failing descriptor/config tests**

Add tests that assert disabled config lists no providers, enabled config with shared `apiKeyEnv` creates explicit `ollama-claude-code:kimi-k2.6` and `ollama-claude-code:glm-5.1` provider ids, incomplete shared config marks profiles unavailable, and write capabilities are absent unless `writeValidated` is true.

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npm test -- tests/providers/ollama-claude-code/config.test.ts tests/providers/ollama-cloud/config.test.ts
```

Expected: fail because the new provider family does not exist.

- [ ] **Step 3: Implement config and provider descriptors**

Add parsed config under `providers.ollamaClaudeCode`, explicit provider ids, profile resolution, profile warnings, and provider listing.

- [ ] **Step 4: Run focused tests to verify green**

Run:

```bash
npm test -- tests/providers/ollama-claude-code/config.test.ts tests/providers/ollama-cloud/config.test.ts
```

Expected: pass.

## Task 2: Claude Code Scoped Runtime

**Files:**
- Create: `tests/providers/ollama-claude-code/runtime.test.ts`
- Modify: `tests/providers/claude-code-cli/commands.test.ts`
- Modify: `tests/providers/claude-code-cli/background.test.ts`
- Modify: `src/providers/claude-code-cli/types.ts`
- Modify: `src/providers/claude-code-cli/commands.ts`
- Modify: `src/providers/claude-code-cli/runner.ts`
- Modify: `src/providers/claude-code-cli/background.ts`
- Create: `src/providers/ollama-claude-code/runtime.ts`
- Modify: `src/providers/runtime.ts`

- [ ] **Step 1: Write failing runtime tests**

Add tests proving `--model` is sent to Claude Code, scoped env maps one `OLLAMA_API_KEY` to `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `OLLAMA_API_KEY`, missing API key fails closed, and subscription OAuth warnings still apply only to `claude-code-cli`.

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npm test -- tests/providers/ollama-claude-code/runtime.test.ts tests/providers/claude-code-cli/commands.test.ts tests/providers/claude-code-cli/background.test.ts
```

Expected: fail because `--model` and the runtime wrapper are missing.

- [ ] **Step 3: Implement runtime wrapper**

Reuse `runClaudePrint` and `startClaudeBackgroundSession` with scoped env and model. Do not shell out directly or duplicate lifecycle behavior.

- [ ] **Step 4: Run focused tests to verify green**

Run:

```bash
npm test -- tests/providers/ollama-claude-code/runtime.test.ts tests/providers/claude-code-cli/commands.test.ts tests/providers/claude-code-cli/background.test.ts
```

Expected: pass.

## Task 3: Doctor And Routing Coverage

**Files:**
- Modify: `tests/doctor.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `src/doctor.ts`

- [ ] **Step 1: Write failing doctor/routing tests**

Add tests showing doctor reports `ollamaClaudeCode` profile count, sanitized shared env name, missing/present `OLLAMA_API_KEY`, and read-only roles can route to `ollama-claude-code:*` while `slice-implementer` cannot route unless write capabilities are validated.

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npm test -- tests/doctor.test.ts tests/core/router.test.ts
```

Expected: fail on missing doctor provider checks.

- [ ] **Step 3: Implement doctor summary and routing compatibility**

Wire runtime health checks and sanitized config details. Keep endpoint URLs and secret values out of doctor output.

- [ ] **Step 4: Run focused tests to verify green**

Run:

```bash
npm test -- tests/doctor.test.ts tests/core/router.test.ts
```

Expected: pass.

## Task 4: Docs And Roadmap

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [ ] **Step 1: Write failing docs tests**

Require docs to mention `providers.ollamaClaudeCode`, `OLLAMA_API_KEY`, `ollama-claude-code:kimi-k2.6`, `ANTHROPIC_BASE_URL`, scoped provider env, write validation, and no provider ranking/model-quality claim.

- [ ] **Step 2: Run docs tests to verify red**

Run:

```bash
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected: fail until docs are updated.

- [ ] **Step 3: Update docs and roadmap**

Document single API-key setup, profile config, conservative capabilities, live-proof requirements, and mark Milestone 48 complete only after verification.

## Verification Plan

Run before integration:

```bash
npm test -- tests/providers/ollama-claude-code/config.test.ts tests/providers/ollama-cloud/config.test.ts
npm test -- tests/providers/ollama-claude-code/runtime.test.ts tests/providers/claude-code-cli/commands.test.ts tests/providers/claude-code-cli/background.test.ts
npm test -- tests/doctor.test.ts tests/core/router.test.ts
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

Optional operator-run proof after a real Ollama profile and API key are configured:

```bash
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:ollama-claude-code
```

## Self-Review

- Spec coverage: The plan covers explicit profiles, one API-key env, Claude Code lifecycle reuse, scoped env, doctor, write gating, docs, and no model-quality claims.
- Placeholder scan: No TODO/TBD placeholders remain.
- Type consistency: Provider family is consistently named `ollama-claude-code`; config is consistently named `ollamaClaudeCode`.
