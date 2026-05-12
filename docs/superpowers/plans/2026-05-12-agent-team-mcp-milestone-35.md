# Agent Team MCP Milestone 35 Ollama Cloud Profiles Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit Ollama Cloud model profiles, backed by the OpenAI-compatible foundation, so Codex can route read-only review, planning, debugging, and second-opinion roles to configured Kimi/GLM-style endpoints without changing public MCP schemas.

**Architecture:** M35 keeps provider profiles as provider-adapter configuration, not new MCP tools. `providers.ollamaCloud.profiles[]` produces provider descriptors such as `ollama-cloud:kimi-k2.6` and `ollama-cloud:glm-5.1`, while the existing OpenAI-compatible runtime executes the selected profile through provider-neutral dispatch and doctor flows. Runtime inputs carry the selected provider id so one runtime can resolve the correct explicit endpoint/model/auth-env profile and fail closed when a profile is incomplete or lacks required capabilities.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing OpenAI-compatible runtime, injected fetch fixtures, provider-neutral router/doctor/dispatch, no live provider calls in CI.

---

## Scope

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/dispatch.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Modify: `src/doctor.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/providers/runtime.ts`
- Modify: `src/providers/types.ts`
- Create: `src/providers/ollama-cloud/config.ts`
- Modify: `src/providers/openai-compatible/config.ts`
- Modify: `src/providers/openai-compatible/runtime.ts`
- Create: `tests/providers/ollama-cloud/config.test.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/providers/openai-compatible/runtime.test.ts`
- Modify: `tests/providers/runtime.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-35.md`

**Non-goals:**

- Do not add live Ollama Cloud CI, model-quality claims, benchmark claims, or long-context-quality claims.
- Do not hardcode default Ollama endpoint, model, or auth env as an implicit fallback.
- Do not add provider-specific MCP tools, schemas, prompt fields, or public tool metadata.
- Do not claim tools, edits, session resume, cancellation, workspace isolation, or background lifecycle support for Ollama Cloud profiles.
- Do not change Claude Code CLI subscription OAuth as the primary v1 transport.
- Do not introduce API-key fallback from Claude subscription mode.
- Do not add Gemini, Grok, provider policy, or multi-provider routing preference logic.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for new behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Provider adapter/profile: disabled unless explicitly configured, conservative capability descriptors, missing endpoint/auth/model health checks, unsupported capability routing failures, fixture transport mechanics only.
- Provider routing: requested provider mismatch, profile missing required role capability, slice implementer rejection, incomplete profile unavailable.
- Auth posture: provider-scoped API-key env names are explicit and do not trigger Claude subscription fallback.
- Failure behavior: profile-specific missing env/HTTP/malformed response failures write normal sidecar/log evidence.
- Lifecycle safety: Ollama Cloud profiles do not advertise session resume or cancellation and cannot enter background lifecycle starts.
- Documentation: docs explain opt-in live smoke and avoid model-quality or provider-comparison claims.
- Boundary scan: provider-specific public schema leakage, fallback language, benchmark/model-quality claims, and hidden prompt exposure are reviewed.

Live provider smoke is not required for M35 because this milestone proves profile mechanics using injected transports only. Live smoke becomes required before claiming a specific Ollama Cloud model is ready, better, faster, long-context capable in practice, or suitable for any model-quality use.

## Success Criteria

- `AgentTeamConfig` supports `providers.ollamaCloud.enabled` and explicit `profiles[]`.
- Each profile requires an explicit profile `id`, `baseUrl`, `model`, and `apiKeyEnv`; no values are inferred from environment variables or Claude config.
- `listProviders({ config })` emits one provider descriptor per configured Ollama Cloud profile with ids in the form `ollama-cloud:<profile-id>`.
- Ollama Cloud profile descriptors expose only declared read-only capabilities supported by the OpenAI-compatible foundation: `structuredOutput`, optional `longContext`, and optional `reasoning`.
- Unsupported capability claims such as tools, edits, session resume, cancellation, workspace isolation, or parallel dispatch fail closed during config parsing.
- Incomplete profiles are visible to doctor as unavailable descriptors but cannot route roles.
- `requireProviderRuntime("ollama-cloud:<profile-id>")` resolves to the OpenAI-compatible runtime without changing the public MCP schema.
- Dispatch passes the selected provider id into the runtime, and the runtime resolves the matching Ollama Cloud profile endpoint/model/auth env from config.
- Doctor reports profile-specific config/auth readiness with provider-owned check ids and no secret values.
- Profile-scoped API keys do not trigger Claude auth-precedence failures.
- Lifecycle start/reply remains fail-closed because Ollama profiles do not advertise session/cancellation capabilities.
- README/changelog/roadmap document the profile behavior and limitations.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Red Tests For Explicit Profile Config And Routing

**Files:**

- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Create: `tests/providers/ollama-cloud/config.test.ts`
- Modify: `tests/providers/runtime.test.ts`

- [ ] **Step 1: Write failing config/profile tests**

Cover:

- default config keeps `providers.ollamaCloud.enabled === false` and `profiles === []`
- explicit Kimi/GLM profiles parse with endpoint/model/auth-env/capabilities
- unsupported profile capabilities reject config
- duplicate profile ids reject config
- lifecycle registry identity changes when profile config changes
- provider descriptors are absent when Ollama Cloud is disabled
- provider descriptors use `ollama-cloud:<profile-id>` when enabled
- incomplete enabled profiles are listed with `available: false`

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/lifecycle-registry.test.ts tests/providers/ollama-cloud/config.test.ts tests/providers/runtime.test.ts
```

Expected red: Ollama Cloud config and provider profile modules do not exist yet.

- [ ] **Step 2: Write failing router tests**

Cover:

- planner routes to a requested `ollama-cloud:kimi-k2.6` provider only when `structuredOutput` is declared
- architect/debugger fail unless `longContext` is declared
- slice implementer always rejects Ollama Cloud profiles
- missing/incomplete profiles cannot route

Run:

```bash
npm test -- tests/core/router.test.ts
```

Expected red: provider descriptors do not exist yet.

## Task 2: Profile Config, Descriptor, Registry, And Doctor Wiring

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Create: `src/providers/ollama-cloud/config.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/providers/runtime.ts`
- Modify: `src/providers/types.ts`
- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [ ] **Step 1: Add provider-neutral profile config types**

Add `providers.ollamaCloud` with:

- `enabled`
- `profiles[]`
- profile `id`
- profile `baseUrl`
- profile `model`
- profile `apiKeyEnv`
- optional `displayName`
- `capabilities.structuredOutput`
- `capabilities.longContext`
- `capabilities.reasoning`

- [ ] **Step 2: Add profile parser and descriptor builder**

Create `src/providers/ollama-cloud/config.ts` for descriptor/profile helpers. Keep ids stable, reject duplicate profile ids, validate unsupported capabilities fail closed, and sanitize descriptor warnings so no secrets or prompt internals are exposed.

- [ ] **Step 3: Add runtime registry aliasing**

Allow dynamic `ollama-cloud:<profile-id>` provider ids to resolve to the OpenAI-compatible runtime while preserving the bundled runtime list.

- [ ] **Step 4: Add doctor profile health**

Pass selected provider ids into runtime health checks. Doctor must report missing profile endpoint/model/auth env clearly and must not treat `OLLAMA_CLOUD_API_KEY`, `KIMI_API_KEY`, or `GLM_API_KEY` as Claude subscription fallback.

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/lifecycle-registry.test.ts tests/providers/ollama-cloud/config.test.ts tests/providers/runtime.test.ts tests/doctor.test.ts
```

## Task 3: Runtime Profile Resolution And Dispatch

**Files:**

- Modify: `src/providers/types.ts`
- Modify: `src/core/dispatch.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `src/providers/openai-compatible/config.ts`
- Modify: `src/providers/openai-compatible/runtime.ts`
- Modify: `tests/providers/openai-compatible/runtime.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Write failing runtime/dispatch tests**

Cover:

- `ProviderPrintInput.providerId` selects the matching Ollama Cloud profile
- requests use the profile `baseUrl`, `model`, and `apiKeyEnv`
- missing profile auth env fails before network
- missing profile id fails closed
- dispatch records normal sidecar/log evidence for profile successes and failures
- background lifecycle start rejects Ollama Cloud profiles due to missing session/cancellation capabilities

Run:

```bash
npm test -- tests/providers/openai-compatible/runtime.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

- [ ] **Step 2: Implement profile resolution in the OpenAI-compatible runtime**

Resolve the selected endpoint from `input.providerId`:

- `openai-compatible` uses `providers.openaiCompatible`
- `ollama-cloud:<profile-id>` uses the matching `providers.ollamaCloud.profiles[]`
- unknown provider ids fail closed

- [ ] **Step 3: Pass provider ids through dispatch and lifecycle**

Dispatch and lifecycle runtime calls must include the selected provider id so runtime methods and health checks can resolve the correct profile without new public MCP fields.

Run:

```bash
npm test -- tests/providers/openai-compatible/runtime.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

## Task 4: Docs, Roadmap, And Verification

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-35.md`

- [ ] **Step 1: Update user-facing docs**

Document:

- Claude Code CLI subscription OAuth remains primary v1 transport
- Ollama Cloud profiles are explicit config only
- examples for Kimi/GLM-style profiles use placeholder endpoints and env var names without secrets
- profiles support synchronous read-only dispatch only
- no edit/session/tool support is claimed
- live provider smoke is opt-in before any real-model readiness claim

- [ ] **Step 2: Update roadmap and changelog**

Mark M35 complete only after proof is captured and move near-term recommendation to M36/M37/M38.

- [ ] **Step 3: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/core/lifecycle-registry.test.ts tests/core/lifecycle.test.ts tests/core/dispatch.test.ts tests/providers/runtime.test.ts tests/providers/ollama-cloud/config.test.ts tests/providers/openai-compatible/runtime.test.ts tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts tests/mcp/tools.test.ts
```

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

- [ ] **Step 5: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode|ollama-cloud|Ollama Cloud|openai-compatible|OpenAI-compatible" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema" src tests docs README.md CHANGELOG.md
rg "baseUrl|apiKey|apiKeyEnv|Authorization|Bearer|OLLAMA|KIMI|GLM" src tests docs README.md CHANGELOG.md
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace" src tests docs README.md CHANGELOG.md
```

- [ ] **Step 6: Mark plan complete and commit**

After all proof is captured, mark the L11 gates and task checkboxes complete in this plan, then commit the implementation branch.

## Verification Evidence

- Baseline before implementation: pending.
- Red proof: pending.
- Focused milestone proof: pending.
- Full proof: pending.
- Packaged stdio smoke: pending.
- Invariant scans: pending.
