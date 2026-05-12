# Agent Team MCP Milestone 34 OpenAI-Compatible Adapter Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic OpenAI-compatible provider foundation that can be explicitly configured for read-only, capability-supported roles without becoming a fallback path from Claude Code CLI subscription OAuth.

**Architecture:** M34 extends the provider-neutral config, descriptor, runtime, doctor, and dispatch seams so a non-Claude adapter can be configured explicitly while staying fail-closed by default. The adapter is disabled unless `.agent-team/config.json` opts it in with endpoint/model/auth-env configuration and explicit capability declarations. The first foundation supports synchronous read-only dispatch through OpenAI-compatible chat completions only; background sessions, edits, tool execution, workspace isolation, cancellation, and resume remain unsupported unless future milestones add real mechanics and tests. Lifecycle start/reply routing must require session/cancellation capabilities so stateless adapters cannot be selected accidentally for long-running runs.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, global `fetch` with injected test transport, existing provider runtime interfaces, existing conformance harness, no live model calls in CI.

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
- Create: `src/providers/openai-compatible/config.ts`
- Create: `src/providers/openai-compatible/runtime.ts`
- Create: `tests/providers/openai-compatible/runtime.test.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/providers/runtime.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-34.md`

**Non-goals:**

- Do not add Ollama Cloud, Kimi, GLM, Gemini, Grok, or provider-specific profiles.
- Do not make OpenAI-compatible providers available from environment variables alone.
- Do not use OpenAI-compatible API keys as a fallback from Claude Code CLI subscription OAuth.
- Do not add provider-specific MCP tools, schemas, prompts, or public tool metadata.
- Do not support edits, tool calls, session resume, background lifecycle, cancellation, or workspace isolation for this adapter.
- Do not run live provider calls in CI.
- Do not make benchmark, model-quality, long-context-quality, or provider-comparison claims.
- Do not parse or judge model output beyond existing verdict parsing boundaries.
- Do not weaken sidecars, mailboxes, status, wind-down, cleanup, recovery, or evidence.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for new behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Provider adapters: descriptor shape, conservative capabilities, health result shape, endpoint/auth/model diagnostics, unsupported capability failures, no `bypassPermissions`.
- Provider routing: disabled provider omission, requested disabled provider rejection, unsupported role/capability rejection, stateless lifecycle routing rejection.
- Auth posture: Claude Code CLI subscription OAuth remains primary; API-key config is explicit and provider-scoped; no env-only fallback.
- Failure behavior: missing endpoint/model/auth env/fetch errors produce sidecar evidence and doctor checks without leaking secrets.
- Batch and lifecycle safety: stateless adapters cannot enter start/reply flows that require session resume or cancellation.
- Documentation: roadmap/changelog/README describe adapter foundation without claiming model quality or provider-specific public schemas.
- Boundary scan: provider-specific leakage, fallback language, benchmark/model-quality claims, and hidden prompt exposure are reviewed.

Live provider smoke is not required for M34 because CI uses injected transports to prove adapter mechanics without making provider readiness or model-quality claims. Live smoke becomes required before announcing a concrete Ollama Cloud/Gemini/Grok profile as usable.

## Success Criteria

- `AgentTeamConfig` supports an explicit `providers.openaiCompatible` section with disabled defaults.
- Config parsing does not infer OpenAI-compatible endpoint/model/auth from environment variables.
- `listProviders({ config })` omits the OpenAI-compatible provider unless it is explicitly enabled.
- When enabled, the descriptor is provider-neutral, API-key scoped, and exposes only configured read-only capabilities supported by this foundation.
- Unsupported capabilities such as tools, edits, session resume, cancellation, and workspace isolation are rejected or ignored fail-closed and covered by tests.
- Doctor reports endpoint/model/auth-env readiness for the configured adapter without treating provider-scoped API keys as Claude subscription fallback.
- Dispatch can pass config into provider selection/runtime execution and can run the OpenAI-compatible adapter through an injected transport in tests.
- Provider runtime `runPrint` sends a minimal chat-completions request, redacts secrets from errors/log surfaces, parses text from supported response shapes, and returns structured failure results on missing config/env/HTTP/JSON errors.
- Lifecycle start/reply selection requires session/cancellation capabilities so stateless adapters cannot be selected for background runs.
- Provider conformance coverage includes the OpenAI-compatible runtime fixture without live network calls.
- README/changelog/roadmap document M34 as complete only after verification.
- No public MCP schema becomes provider-specific.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Red Tests For Explicit Config And Routing

**Files:**

- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/lifecycle.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Modify: `tests/providers/runtime.test.ts`

- [ ] **Step 1: Write failing config tests**

Cover:

- default config keeps `providers.openaiCompatible.enabled === false`
- env variables alone do not enable the adapter
- explicit endpoint/model/auth-env config enables descriptor listing
- unsupported capability declarations fail closed
- config identity includes provider config so lifecycle registry does not reuse stale provider settings

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/lifecycle-registry.test.ts tests/providers/runtime.test.ts
```

Expected red: provider config fields and OpenAI-compatible runtime do not exist yet.

- [ ] **Step 2: Write failing routing/lifecycle tests**

Cover:

- requested OpenAI-compatible provider fails when disabled
- planner can route only when explicit structured-output capability is configured
- architect/debugger require explicit long-context capability
- slice implementer cannot route to OpenAI-compatible foundation
- `agent_team_start`/reply-style lifecycle selection requires session/cancellation capabilities and rejects stateless provider descriptors

Run:

```bash
npm test -- tests/core/router.test.ts tests/core/lifecycle.test.ts
```

Expected red: lifecycle start does not yet require session/cancellation capabilities and provider config does not exist.

## Task 2: Config, Descriptor, Registry, And Doctor Foundation

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/providers/runtime.ts`
- Create: `src/providers/openai-compatible/config.ts`
- Create: `src/providers/openai-compatible/runtime.ts`
- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [ ] **Step 1: Add provider config types and parser**

Add an explicit OpenAI-compatible config shape with:

- `enabled`
- `baseUrl`
- `model`
- `apiKeyEnv`
- `displayName`
- `capabilities.structuredOutput`
- `capabilities.longContext`
- `capabilities.reasoning`

Keep all defaults disabled/empty, validate unsupported capabilities fail closed, and never read env values during config parsing.

- [ ] **Step 2: Add descriptor and runtime registry wiring**

Register the runtime while keeping `listProviders` descriptor output config-dependent:

- default provider list remains Claude-only
- enabled OpenAI-compatible config adds one provider descriptor
- descriptor auth mode is `api-key`
- descriptor capabilities include only explicitly declared foundation-supported capabilities
- descriptor warnings identify unsupported configuration without leaking secrets

- [ ] **Step 3: Add doctor checks**

Pass config into runtime health checks and report:

- disabled adapter has no checks because it is not listed
- missing base URL/model/auth env produces clear provider-owned failures
- configured auth env presence is checked by name only and never emits secret values
- provider-scoped API keys do not trigger Claude `auth-precedence`

Run:

```bash
npm test -- tests/core/config.test.ts tests/providers/runtime.test.ts tests/doctor.test.ts
```

## Task 3: Runtime Dispatch Foundation

**Files:**

- Modify: `src/providers/openai-compatible/runtime.ts`
- Modify: `src/core/dispatch.ts`
- Modify: `src/mcp/tools.ts`
- Create: `tests/providers/openai-compatible/runtime.test.ts`
- Modify: `tests/core/dispatch.test.ts`

- [ ] **Step 1: Write failing runtime transport tests**

Cover:

- missing config/env fails without network
- request URL uses explicit base URL only
- request body contains model and user prompt
- authorization uses the configured env var name
- successful response extracts assistant text
- HTTP failure, JSON failure, and missing text return structured failures with redacted details
- `startSession` fails closed with an inspectable handle because background lifecycle is not supported in M34

Run:

```bash
npm test -- tests/providers/openai-compatible/runtime.test.ts
```

- [ ] **Step 2: Implement `runPrint` with injected transport**

Use global `fetch` by default and an injected transport for tests. Do not add provider-specific public schemas or live CI calls.

- [ ] **Step 3: Thread config through dispatch**

Dispatch must load or receive config, select providers from that config, pass config to runtimes, and preserve sidecar/log evidence for partial failures.

Run:

```bash
npm test -- tests/providers/openai-compatible/runtime.test.ts tests/core/dispatch.test.ts
```

## Task 4: Lifecycle Fail-Closed Session Boundaries

**Files:**

- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Require session capabilities for background starts**

For `AgentLifecycleManager.startRun`, include `sessionResume` and `cancellation` as lifecycle-only extra capabilities before selecting a provider. This preserves Claude behavior and blocks stateless read-only providers from long-running lifecycle tools.

- [ ] **Step 2: Keep reply routing config-aware**

Ensure `replyRun` uses the manager config when listing providers and still requires `sessionResume`.

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

## Task 5: Conformance, Docs, And Verification

**Files:**

- Modify: `tests/providers/conformance/runtime-conformance.test.ts` or add adapter-specific conformance coverage
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-34.md`

- [ ] **Step 1: Add conformance coverage**

Run the existing provider runtime conformance helper against an explicitly configured OpenAI-compatible fixture/runtime with injected transport and only supported read-only capabilities.

- [ ] **Step 2: Update docs**

Document:

- Claude Code CLI subscription OAuth remains primary v1 transport
- OpenAI-compatible adapter is disabled unless explicitly configured
- provider-scoped API-key env vars are not fallback from Claude
- M34 foundation supports synchronous read-only dispatch only
- live provider smoke remains opt-in until concrete profiles are added

- [ ] **Step 3: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/core/lifecycle-registry.test.ts tests/core/lifecycle.test.ts tests/core/dispatch.test.ts tests/providers/runtime.test.ts tests/providers/openai-compatible/runtime.test.ts tests/doctor.test.ts
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
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode|openai-compatible|OpenAI-compatible" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema" src tests docs README.md CHANGELOG.md
rg "baseUrl|apiKey|apiKeyEnv|Authorization|Bearer" src tests docs README.md CHANGELOG.md
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
