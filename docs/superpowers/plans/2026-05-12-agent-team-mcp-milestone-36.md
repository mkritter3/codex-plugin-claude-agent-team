# Agent Team MCP Milestone 36 Gemini Adapter Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicitly configured Gemini adapter for read-only planning, review, debugging, and long-context analysis roles without changing public MCP schemas.

**Architecture:** M36 adds a provider-owned `gemini` adapter boundary rather than treating Gemini as OpenAI-compatible, because Gemini uses the `generateContent` request/response shape and `x-goog-api-key` auth header. The core remains provider-neutral: config produces a conservative `gemini` descriptor, the router selects it only by declared capabilities, dispatch passes the selected provider id into the runtime, and lifecycle/background paths remain fail-closed because Gemini v1 supports synchronous read-only dispatch only.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, Gemini REST `generateContent` fixture transport, provider-neutral router/dispatch/doctor, no live provider calls in CI.

---

## Scope

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Modify: `src/doctor.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/providers/runtime.ts`
- Create: `src/providers/gemini/config.ts`
- Create: `src/providers/gemini/runtime.ts`
- Create: `tests/providers/gemini/config.test.ts`
- Create: `tests/providers/gemini/runtime.test.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/providers/runtime.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-36.md`

**Non-goals:**

- Do not add Gemini public MCP tools, provider-specific schemas, prompt fields, or tool metadata.
- Do not add live Gemini CI, model-quality claims, benchmark claims, or practical long-context-quality claims.
- Do not hardcode a default Gemini endpoint, model, or auth env as an implicit fallback.
- Do not support streaming, Live API, tools, edits, session resume, cancellation, workspace isolation, file upload, multimodal inputs, or background lifecycle in M36.
- Do not infer Gemini credentials from Claude auth, OpenAI-compatible config, Ollama Cloud profiles, or generic API-key env vars.
- Do not change Claude Code CLI subscription OAuth as the primary v1 transport.
- Do not add Grok, provider selection policy, or multi-provider comparison behavior.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for new behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Provider adapter/profile: disabled unless explicitly configured, conservative capability descriptor, missing endpoint/model/auth health checks, unsupported capability errors, fixture transport mechanics only.
- Provider routing: requested provider mismatch, unsupported role/capability rejection, write-mode disabled for implementation roles, incomplete provider unavailable.
- Auth posture: Gemini API-key env is provider scoped and does not trigger Claude subscription fallback.
- Failure behavior: missing env, disabled provider, missing config, HTTP failure, malformed response, empty candidate text, and unknown provider ids fail before hidden side effects.
- Lifecycle safety: Gemini does not advertise session resume or cancellation and cannot enter background lifecycle starts.
- Documentation: docs explain opt-in live smoke and avoid model-quality or provider-comparison claims.
- Boundary scan: provider-specific public schema leakage, fallback language, benchmark/model-quality claims, auth-secret handling, cleanup shortcuts, and hidden prompt exposure are reviewed.

Live provider smoke is not required for M36 because this milestone proves Gemini adapter mechanics with injected fixture transport only. Live smoke becomes required before claiming Gemini is ready for real workflows, better than another provider, long-context capable in practice, or suitable for any model-quality use.

Official API notes used for adapter shape:

- Gemini standard content generation uses REST `generateContent` for non-interactive full responses.
- Requests include API-key auth through `x-goog-api-key`.
- Text prompts use `contents[].parts[].text`.
- Standard responses include generated text under `candidates[].content.parts[].text`.

## Success Criteria

- `AgentTeamConfig` supports `providers.gemini.enabled`, explicit `baseUrl`, `model`, `apiKeyEnv`, optional `displayName`, and declared `capabilities`.
- Gemini is disabled by default and omitted from `listProviders()` unless explicitly enabled.
- The Gemini descriptor uses id `gemini`, auth mode `api-key`, and only read-only capabilities declared by config: `structuredOutput`, optional `longContext`, and optional `reasoning`.
- Unsupported capabilities such as tools, edits, session resume, cancellation, workspace isolation, or parallel dispatch fail closed during config parsing.
- Incomplete enabled Gemini config remains visible to doctor as an unavailable descriptor and cannot route roles.
- `requireProviderRuntime("gemini")` resolves to the Gemini runtime.
- Gemini runtime sends synchronous `generateContent` requests to the explicit endpoint/model using provider-scoped `apiKeyEnv` and `x-goog-api-key`.
- Gemini runtime extracts candidate text from fixture responses and returns normal `ProviderPrintResult` values without quality claims.
- Gemini runtime fails closed for disabled provider, missing endpoint/model/auth env, HTTP failure, malformed JSON shape, and empty candidate text.
- Doctor reports Gemini config/auth readiness with provider-owned check ids and no secret values.
- Gemini API keys do not trigger Claude auth-precedence failures.
- Lifecycle start/reply remains fail-closed because Gemini does not advertise session/cancellation capabilities.
- README/changelog/roadmap document Gemini behavior and limitations.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Red Tests For Gemini Config, Descriptor, And Routing

**Files:**

- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Create: `tests/providers/gemini/config.test.ts`
- Modify: `tests/providers/runtime.test.ts`

- [ ] **Step 1: Write failing config and descriptor tests**

Cover:

- default config keeps `providers.gemini.enabled === false`
- explicit Gemini config parses endpoint/model/auth-env/display-name/capabilities
- unsupported Gemini capabilities reject config
- provider descriptor is absent when Gemini is disabled
- provider descriptor uses id `gemini` when enabled
- incomplete enabled config is listed with `available: false`
- lifecycle registry identity changes when Gemini config changes
- runtime registry includes and resolves the Gemini runtime

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/lifecycle-registry.test.ts tests/providers/gemini/config.test.ts tests/providers/runtime.test.ts
```

Expected red: Gemini config/provider/runtime modules do not exist yet and `providers.gemini` is not parsed.

- [ ] **Step 2: Write failing router tests**

Cover:

- planner routes to requested `gemini` only when `structuredOutput` is declared
- architect/debugger fail unless `longContext` is declared
- slice implementer always rejects Gemini
- incomplete Gemini descriptors cannot route

Run:

```bash
npm test -- tests/core/router.test.ts
```

Expected red: Gemini descriptors do not exist yet.

## Task 2: Gemini Config, Descriptor, Registry, And Doctor Wiring

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Create: `src/providers/gemini/config.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/providers/runtime.ts`
- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [ ] **Step 1: Add provider-neutral Gemini config types**

Add `providers.gemini` with:

- `enabled`
- `baseUrl`
- `model`
- `apiKeyEnv`
- optional `displayName`
- `capabilities.structuredOutput`
- `capabilities.longContext`
- `capabilities.reasoning`

- [ ] **Step 2: Add Gemini parser and descriptor builder**

Create `src/providers/gemini/config.ts` for descriptor helpers. Keep id stable as `gemini`, reject unsupported capabilities, and sanitize warnings so no secrets, internal prompts, or implementation details are exposed.

- [ ] **Step 3: Register the Gemini provider and runtime id**

Add Gemini to provider listing only when enabled, and add the runtime to bundled runtime registration so `requireProviderRuntime("gemini")` works.

- [ ] **Step 4: Add doctor Gemini health visibility**

Doctor must report missing endpoint/model/auth env clearly and must not treat `GEMINI_API_KEY` or any provider-scoped Gemini env as a Claude subscription fallback.

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/lifecycle-registry.test.ts tests/providers/gemini/config.test.ts tests/providers/runtime.test.ts tests/doctor.test.ts
```

## Task 3: Gemini Runtime And Dispatch Evidence

**Files:**

- Create: `src/providers/gemini/runtime.ts`
- Create: `tests/providers/gemini/runtime.test.ts`
- Modify: `tests/core/dispatch.test.ts`

- [ ] **Step 1: Write failing Gemini runtime and dispatch tests**

Cover:

- request URL uses explicit `baseUrl` and encoded `model`
- request uses `x-goog-api-key` from explicit `apiKeyEnv`
- request body uses `contents: [{ role: "user", parts: [{ text: prompt }] }]`
- successful fixture response extracts joined text from `candidates[].content.parts[].text`
- missing auth env fails before network
- disabled provider fails before network
- HTTP failure and malformed/empty candidate response fail closed
- dispatch records normal sidecar/log evidence for Gemini success and failure
- background lifecycle start rejects Gemini through capability routing

Run:

```bash
npm test -- tests/providers/gemini/runtime.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

Expected red: Gemini runtime does not exist yet.

- [ ] **Step 2: Implement Gemini runtime**

Implement `createGeminiRuntime({ config?, fetch? })` and exported `geminiRuntime`. Runtime behavior:

- resolve config from `input.config ?? options.config ?? DEFAULT_AGENT_TEAM_CONFIG`
- fail if `providers.gemini.enabled` is false
- require `structuredOutput`, `baseUrl`, `model`, and `apiKeyEnv`
- read token from `input.env ?? process.env`
- POST to `${baseUrl without trailing slash}/models/${encoded model}:generateContent`
- send `content-type: application/json` and `x-goog-api-key`
- parse `candidates[].content.parts[].text`
- return `sessionId` from `responseId` when present

- [ ] **Step 3: Add conformance coverage**

Use the shared provider runtime conformance helper with a fixture Gemini runtime and descriptor. The conformance fixture must not make live network calls and must not claim provider quality.

Run:

```bash
npm test -- tests/providers/gemini/runtime.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

## Task 4: Docs, Roadmap, And Verification

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-36.md`

- [ ] **Step 1: Update user-facing docs**

Document:

- Claude Code CLI subscription OAuth remains primary v1 transport
- Gemini is explicit config only
- example uses placeholder endpoint/model/auth env without secrets
- Gemini supports synchronous read-only dispatch only
- no edit/session/tool/streaming/live-api support is claimed
- live provider smoke is opt-in before any real-model readiness, long-context, or model-quality claim

- [ ] **Step 2: Update roadmap and changelog**

Mark M36 complete only after proof is captured and move near-term recommendation to M37/M38/M39.

- [ ] **Step 3: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/core/lifecycle-registry.test.ts tests/core/lifecycle.test.ts tests/core/dispatch.test.ts tests/providers/runtime.test.ts tests/providers/gemini/config.test.ts tests/providers/gemini/runtime.test.ts tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts tests/mcp/tools.test.ts
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
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode|gemini|Gemini|openai-compatible|Ollama Cloud" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema" src tests docs README.md CHANGELOG.md
rg "baseUrl|apiKey|apiKeyEnv|x-goog-api-key|Authorization|Bearer|GEMINI" src tests docs README.md CHANGELOG.md
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
