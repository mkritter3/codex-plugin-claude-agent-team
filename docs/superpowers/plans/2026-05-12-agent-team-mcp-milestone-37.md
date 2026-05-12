# Agent Team MCP Milestone 37 Grok Adapter Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly configured Grok provider profile for read-only review and second-opinion roles without changing public MCP schemas.

**Architecture:** M37 treats Grok as a provider-owned profile boundary backed by the existing OpenAI-compatible chat-completions runtime because xAI exposes an OpenAI-compatible `/v1/chat/completions` surface. The core remains provider-neutral: `providers.grok.profiles[]` produces conservative descriptors such as `grok:grok-4.20-reasoning`, router selection stays capability-based, doctor reports Grok-specific config/auth readiness, and runtime dispatch resolves the selected `grok:<profile-id>` provider id into explicit xAI endpoint/model/auth config without silent fallback.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing OpenAI-compatible runtime with fixture transport, provider-neutral router/dispatch/doctor, no live provider calls in CI.

---

## Scope

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Modify: `src/doctor.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/providers/runtime.ts`
- Create: `src/providers/grok/config.ts`
- Modify: `src/providers/openai-compatible/runtime.ts`
- Create: `tests/providers/grok/config.test.ts`
- Modify: `tests/providers/openai-compatible/runtime.test.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/providers/runtime.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-37.md`

**Non-goals:**

- Do not add a new public MCP tool, public provider-specific schema, prompt field, or public metadata.
- Do not add live Grok/xAI CI, model-quality claims, benchmark claims, or provider-comparison claims.
- Do not hardcode a default xAI endpoint, Grok model, or auth env as an implicit fallback.
- Do not infer Grok credentials from Claude, OpenAI-compatible, Ollama Cloud, Gemini, or generic API-key env vars.
- Do not add streaming, Responses API, deferred completions, tools, image input, edits, session resume, cancellation, workspace isolation, or background lifecycle support in M37.
- Do not change Claude Code CLI subscription OAuth as the primary v1 transport.
- Do not add provider selection policy or multi-provider comparison behavior.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for new behavior.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are explicitly selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Provider adapter/profile: disabled unless explicitly configured, conservative capability descriptor, missing endpoint/model/auth health checks, unsupported capability errors, fixture transport mechanics only.
- Provider routing: requested provider mismatch, unsupported role/capability rejection, write-mode disabled for implementation roles, incomplete provider unavailable.
- Auth posture: Grok/xAI API-key env is provider scoped and does not trigger Claude subscription fallback.
- Failure behavior: disabled provider, missing endpoint/model/auth env, unsupported capability, missing matching provider id, HTTP failure, and malformed OpenAI-compatible response fail closed.
- Lifecycle safety: Grok does not advertise session resume or cancellation and cannot enter background lifecycle starts.
- Documentation: docs explain opt-in live smoke and avoid model-quality, provider-comparison, or benchmark claims.
- Boundary scan: provider-specific public schema leakage, fallback language, benchmark/model-quality claims, auth-secret handling, cleanup shortcuts, and hidden prompt exposure are reviewed.

Live provider smoke is not required for M37 because this milestone proves Grok adapter/profile mechanics using injected fixture transport only. Live smoke becomes required before claiming Grok is ready for real workflows, better than another provider, or suitable for any model-quality use.

Official API notes used for adapter shape:

- xAI chat completions are available at `/v1/chat/completions`.
- xAI examples use OpenAI-compatible clients with base URL `https://api.x.ai/v1`.
- xAI examples authenticate with `Authorization: Bearer $XAI_API_KEY`.
- xAI chat completions are stateless unless callers provide prior messages.

## Success Criteria

- `AgentTeamConfig` supports `providers.grok.enabled` and explicit `profiles[]`.
- Grok is disabled by default and omitted from `listProviders()` unless explicitly enabled.
- Each profile requires explicit profile `id`, `baseUrl`, `model`, and `apiKeyEnv`; no values are inferred from environment variables or Claude config.
- Grok descriptors use ids in the form `grok:<profile-id>`, auth mode `api-key`, and only read-only capabilities declared by config: `structuredOutput`, optional `longContext`, and optional `reasoning`.
- Unsupported capabilities such as tools, edits, session resume, cancellation, workspace isolation, or parallel dispatch fail closed during config parsing.
- Incomplete enabled Grok profiles remain visible to doctor as unavailable descriptors and cannot route roles.
- `requireProviderRuntime("grok:<profile-id>")` resolves to the OpenAI-compatible runtime without adding public MCP schema fields.
- OpenAI-compatible runtime resolves `input.providerId` starts with `grok:` to the matching `providers.grok.profiles[]` endpoint/model/auth-env.
- Grok profile dispatch sends normal OpenAI-compatible chat-completions requests to the explicit endpoint/model using provider-scoped `apiKeyEnv`.
- Grok dispatch success and failure produce normal sidecar/log evidence.
- Doctor reports Grok config/auth readiness with provider-owned check ids and no secret values.
- Grok API keys do not trigger Claude auth-precedence failures.
- Lifecycle start/reply remains fail-closed because Grok does not advertise session/cancellation capabilities.
- README/changelog/roadmap document Grok behavior and limitations.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Red Tests For Grok Config, Descriptor, And Routing

**Files:**

- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Create: `tests/providers/grok/config.test.ts`
- Modify: `tests/providers/runtime.test.ts`

- [x] **Step 1: Write failing config and descriptor tests**

Cover:

- default config keeps `providers.grok.enabled === false` and `profiles === []`
- explicit Grok profiles parse profile id/endpoint/model/auth-env/display-name/capabilities
- unsupported Grok capabilities reject config
- duplicate Grok profile ids reject config
- provider descriptor is absent when Grok is disabled
- provider descriptors use ids in the form `grok:<profile-id>` when enabled
- incomplete enabled profiles are listed with `available: false`
- lifecycle registry identity changes when Grok config changes
- runtime registry aliases `grok:<profile-id>` to the OpenAI-compatible runtime

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/lifecycle-registry.test.ts tests/providers/grok/config.test.ts tests/providers/runtime.test.ts
```

Expected red: Grok config/provider modules do not exist yet and `providers.grok` is not parsed.

- [x] **Step 2: Write failing router tests**

Cover:

- planner routes to requested `grok:grok-4.20-reasoning` only when `structuredOutput` is declared
- architect/debugger fail unless `longContext` is declared
- slice implementer always rejects Grok
- incomplete Grok descriptors cannot route

Run:

```bash
npm test -- tests/core/router.test.ts
```

Expected red: Grok descriptors do not exist yet.

## Task 2: Grok Config, Descriptor, Registry, And Doctor Wiring

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Create: `src/providers/grok/config.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/providers/runtime.ts`
- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [x] **Step 1: Add provider-neutral Grok config types**

Add `providers.grok` with:

- `enabled`
- `profiles[]`
- profile `id`
- profile `baseUrl`
- profile `model`
- profile `apiKeyEnv`
- optional profile `displayName`
- profile `capabilities.structuredOutput`
- profile `capabilities.longContext`
- profile `capabilities.reasoning`

- [x] **Step 2: Add Grok parser and descriptor builder**

Create `src/providers/grok/config.ts` for profile descriptor helpers. Keep ids stable as `grok:<profile-id>`, reject duplicate profile ids and unsupported capabilities, and sanitize warnings so no secrets, internal prompts, provider implementation details, or command internals are exposed.

- [x] **Step 3: Add runtime registry aliasing**

Allow provider ids `grok:<profile-id>` to resolve to the OpenAI-compatible runtime while preserving the bundled runtime list.

- [x] **Step 4: Add doctor Grok health visibility**

Doctor must report missing profile endpoint/model/auth env clearly and must not treat `XAI_API_KEY`, `GROK_API_KEY`, or any provider-scoped Grok env as a Claude subscription fallback.

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/lifecycle-registry.test.ts tests/providers/grok/config.test.ts tests/providers/runtime.test.ts tests/doctor.test.ts
```

## Task 3: OpenAI-Compatible Runtime Grok Resolution And Dispatch

**Files:**

- Modify: `src/providers/openai-compatible/runtime.ts`
- Modify: `tests/providers/openai-compatible/runtime.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing runtime and dispatch tests**

Cover:

- `ProviderPrintInput.providerId === "grok:grok-4.20-reasoning"` selects the matching Grok profile
- requests use the Grok profile `baseUrl`, `model`, and `apiKeyEnv`
- missing Grok auth env fails before network
- disabled Grok provider fails before network
- missing Grok profile id fails closed
- OpenAI-compatible runtime rejects unknown provider ids
- dispatch records normal sidecar/log evidence for Grok success and failure
- background lifecycle start rejects Grok through capability routing

Run:

```bash
npm test -- tests/providers/openai-compatible/runtime.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

Expected red: OpenAI-compatible runtime does not resolve `grok` provider ids yet.

- [x] **Step 2: Implement Grok endpoint resolution in the OpenAI-compatible runtime**

Resolve selected endpoint from `input.providerId`:

- `openai-compatible` uses `providers.openaiCompatible`
- `ollama-cloud:<profile-id>` uses matching `providers.ollamaCloud.profiles[]`
- `grok:<profile-id>` uses matching `providers.grok.profiles[]`
- unknown provider ids fail closed

- [x] **Step 3: Preserve OpenAI-compatible request shape**

Grok requests must continue to use:

- `POST ${baseUrl}/chat/completions`
- `Authorization: Bearer <provider scoped token>`
- request body `{ model, messages: [{ role: "user", content: prompt }] }`
- response text from `choices[].message.content`

Run:

```bash
npm test -- tests/providers/openai-compatible/runtime.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

## Task 4: Docs, Roadmap, And Verification

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-37.md`

- [x] **Step 1: Update user-facing docs**

Document:

- Claude Code CLI subscription OAuth remains primary v1 transport
- Grok profiles are explicit config only
- examples use placeholder profile ids, endpoints, models, and auth env names without secrets
- Grok supports synchronous read-only dispatch only
- no edit/session/tool/streaming/responses-api/image support is claimed
- live provider smoke is opt-in before any real-model readiness or model-quality claim

- [x] **Step 2: Update roadmap and changelog**

Mark M37 complete only after proof is captured and move near-term recommendation to M38/M39/M40.

- [x] **Step 3: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/core/lifecycle-registry.test.ts tests/core/lifecycle.test.ts tests/core/dispatch.test.ts tests/providers/runtime.test.ts tests/providers/grok/config.test.ts tests/providers/openai-compatible/runtime.test.ts tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts tests/mcp/tools.test.ts
```

- [x] **Step 4: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

- [x] **Step 5: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode|grok|Grok|XAI|xAI|openai-compatible|Ollama Cloud|Gemini" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema" src tests docs README.md CHANGELOG.md
rg "baseUrl|apiKey|apiKeyEnv|Authorization|Bearer|XAI|GROK" src tests docs README.md CHANGELOG.md
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace" src tests docs README.md CHANGELOG.md
```

- [x] **Step 6: Mark plan complete and commit**

After all proof is captured, mark the L11 gates and task checkboxes complete in this plan, then commit the implementation branch.

## Verification Evidence

- Baseline before implementation: `npm test` passed before implementation with 45 test files and 334 tests.
- Red proof: `npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/core/lifecycle-registry.test.ts tests/core/dispatch.test.ts tests/providers/runtime.test.ts tests/providers/grok/config.test.ts tests/providers/openai-compatible/runtime.test.ts tests/doctor.test.ts` failed as expected before implementation on missing `src/providers/grok/config.js`, absent Grok config parsing, absent provider descriptors, absent runtime aliasing, absent lifecycle identity, absent doctor checks, and absent OpenAI-compatible Grok endpoint resolution.
- Focused milestone proof: the same focused command passed after implementation with 8 files and 94 tests. Expanded focused proof also passed with 12 files and 191 tests, including lifecycle, docs, and MCP tool coverage.
- Full proof: `npm run typecheck`, `npm test`, and `npm run build` passed. Full test suite passed with 46 files and 349 tests.
- Packaged stdio smoke: `npm run smoke:mcp-stdio` passed with `MCP stdio smoke passed.`
- CI proof: `npm run ci` passed, including typecheck, full tests, build, and packaged stdio smoke.
- Invariant scans: auth/fallback, permission/bypass, benchmark/model-quality, prompt/schema leakage, endpoint/auth-secret, and cleanup/process-kill scans were run. Matches were expected guardrails, provider-local Grok config/runtime/tests/docs, placeholder endpoint/env examples, or pre-existing Claude/lifecycle cleanup behavior; no public provider-specific MCP schema, Claude API-key fallback, benchmark/model-quality claim, hidden prompt leakage, secret value, or new cleanup/process-kill shortcut was introduced.
