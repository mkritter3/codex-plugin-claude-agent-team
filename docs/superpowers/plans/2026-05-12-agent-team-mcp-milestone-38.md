# Agent Team MCP Milestone 38 Provider Selection Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add capability-first provider selection policy so Codex can request provider ids, provider families, model preferences, or capability preferences safely while preserving fail-closed routing.

**Architecture:** M38 keeps public MCP schemas provider-neutral by preserving the existing `provider` string field and teaching the core router to interpret it as a provider selector. Workspace config adds `routing.rolePins` and `routing.providerOrder`, both expressed as the same selector strings. The router remains the single selection authority, returns structured explanations for selection/rejection, and no path downgrades a role to a provider that lacks required capabilities.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing provider descriptors, provider-neutral router/dispatch/lifecycle/doctor, no live provider calls.

---

## Scope

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/router.ts`
- Modify: `src/core/dispatch.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Modify: `src/doctor.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-38.md`

**Non-goals:**

- Do not add a new MCP tool or provider-specific public schema.
- Do not add automatic multi-provider comparison, ranking, verdict aggregation, benchmark behavior, or model-quality claims.
- Do not add live provider smoke or live CI.
- Do not infer API-key fallback or endpoint config from provider policy.
- Do not make non-Claude providers eligible for background sessions or implementation roles unless their descriptors already prove the required capabilities.
- Do not change Claude Code CLI subscription OAuth as the primary v1 transport.

## Selector Contract

Provider selector strings are intentionally small and provider-neutral:

- Exact provider id: `claude-code-cli`, `gemini`, `grok:grok-4.20-reasoning`, `ollama-cloud:kimi-k2.6`, or any configured provider id.
- Provider family: `family:grok`, `family:ollama-cloud`, `family:claude-code-cli`, `family:gemini`, or another non-empty provider id prefix before `:`.
- Model preference: `model:grok-4.20` matches descriptors whose `model` field is exactly `grok-4.20`.
- Capability preference: `capability:reasoning` matches descriptors that advertise the selected capability.

Selector matching only narrows candidate ordering. Role required capabilities and requested `extraCapabilities` are always checked first-class before a provider can be selected.

Workspace config shape:

```json
{
  "routing": {
    "rolePins": {
      "architect": "family:grok",
      "code-reviewer": "model:grok-4.20"
    },
    "providerOrder": [
      "family:grok",
      "family:ollama-cloud",
      "claude-code-cli"
    ]
  }
}
```

Per-request `provider` uses the same selector string and takes precedence over `routing.rolePins`. If neither request nor role pin is provided, `routing.providerOrder` influences the order among capable providers.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for new behavior.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are explicitly selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Provider routing: unsupported role/capability rejection, requested provider mismatch, write-mode disabled, write-mode enabled without capable provider, provider selection explanation.
- Input validation: empty routing selectors, invalid role pin keys, invalid capability selectors, non-string selector array items.
- MCP handlers: public schema keeps `provider` as a neutral selector string and validation remains generic.
- Auth posture: routing policy never enables API-key fallback and does not alter subscription OAuth handling.
- Documentation: docs explain provider selectors and explicitly avoid provider-quality or benchmark claims.
- Boundary scan: provider-specific public schema leakage, fallback language, benchmark/model-quality claims, auth-secret handling, cleanup shortcuts, and hidden prompt exposure are reviewed.

Live provider smoke is not required for M38 because the milestone changes selection policy only. Fixture descriptors and existing provider adapters prove routing mechanics without claiming real provider quality.

## Success Criteria

- `AgentTeamConfig` includes `routing.rolePins` and `routing.providerOrder`, both disabled by default.
- Config parsing rejects empty selectors, invalid role ids, invalid `capability:<value>` selectors, and non-string order entries.
- Request-level `provider` remains accepted as an exact provider id and also supports `family:`, `model:`, and `capability:` selectors.
- Request-level provider selector takes precedence over role pin policy.
- Role pin selectors take precedence over global provider order.
- Global provider order changes the automatic provider choice only among providers that satisfy required capabilities.
- Capability checks remain mandatory for exact ids, families, model selectors, capability selectors, role pins, and ordered fallbacks.
- Router exposes structured explanations showing required capabilities, selected provider, selector source, candidate matches, and rejection reasons without exposing internal prompts or provider command details.
- Dispatch and lifecycle start use the shared policy path, including role pins and provider order.
- Doctor includes selection explanations in role-routing check details and fails when role pins make a role unroutable.
- Public MCP schema wording describes `provider` as a provider selector without adding provider-specific fields.
- README/changelog/roadmap document selector behavior and limitations.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Red Tests For Config Parsing And Router Explanations

**Files:**

- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`

- [x] **Step 1: Write failing config tests**

Add tests that prove:

- default config includes `routing: { rolePins: {}, providerOrder: [] }`
- valid `routing.rolePins` and `routing.providerOrder` load without changing auth/provider config
- invalid role key such as `writer` rejects config
- empty selector strings reject config
- invalid capability selector such as `capability:telepathy` rejects config
- non-string `providerOrder` items reject config

Run:

```bash
npm test -- tests/core/config.test.ts
```

Expected red: `routing` config does not exist yet and invalid policy is not parsed or rejected.

- [x] **Step 2: Write failing router explanation tests**

Add tests that prove:

- `explainProviderSelection()` selects exact provider ids with `selectorSource: "request"`
- `family:grok` selects a capable Grok profile and rejects incapable Grok profiles with missing capability evidence
- `model:grok-4.20` selects a matching capable profile
- `capability:reasoning` narrows candidates but still rejects missing role capabilities
- request selector wins over a conflicting role pin
- role pin wins over global provider order
- global provider order changes fallback selection only among capable providers
- unavailable providers are reported as rejected and never selected
- `selectProvider()` keeps existing fail-closed throw behavior
- lifecycle registry identity changes when routing policy changes

Run:

```bash
npm test -- tests/core/router.test.ts tests/core/lifecycle-registry.test.ts
```

Expected red: router explanation APIs, selector parsing, and routing policy identity do not exist yet.

## Task 2: Implement Provider Selection Policy Core

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/router.ts`
- Modify: `src/core/lifecycle-registry.ts`

- [x] **Step 1: Add routing policy types**

Add config types:

```ts
export type ProviderSelectorSource = "request" | "role-pin" | "provider-order" | "default";

export interface ProviderRoutingPolicyConfig {
  readonly rolePins: Partial<Record<RoleId, string>>;
  readonly providerOrder: readonly string[];
}
```

Add `routing: ProviderRoutingPolicyConfig` to `AgentTeamConfig`.

- [x] **Step 2: Parse and validate routing config**

Parse `.agent-team/config.json` top-level `routing`. Reject invalid role ids using the existing `RoleId` set. Reject empty selector strings. Reject `capability:<value>` when value is not in `PROVIDER_CAPABILITIES`. Reject non-string array items.

Run:

```bash
npm test -- tests/core/config.test.ts
```

- [x] **Step 3: Add selector-aware explanation API**

Add to `src/core/router.ts`:

- `parseProviderSelector(selector: string)`
- `explainProviderSelection(request: ProviderSelectionRequest): ProviderSelectionExplanation`
- selector matching for exact id, family, model, and capability
- provider-order sorting that preserves original order for unmatched providers
- candidate evidence with provider id, availability, matched selector, missing capabilities, and rejection reason

Keep `selectProvider()` as the throwing wrapper over the explanation API so existing callers and errors remain compatible.

Run:

```bash
npm test -- tests/core/router.test.ts
```

- [x] **Step 4: Include routing policy in lifecycle identity**

Add `config.routing` to `configIdentity()` so lifecycle managers are recreated when role pins or provider order changes.

Run:

```bash
npm test -- tests/core/lifecycle-registry.test.ts
```

## Task 3: Wire Policy Into Dispatch, Lifecycle, Doctor, And MCP Wording

**Files:**

- Modify: `src/core/dispatch.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `src/doctor.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/mcp/tools.test.ts`

- [x] **Step 1: Write failing dispatch and lifecycle policy tests**

Cover:

- dispatch with no request selector uses a role pin from config
- dispatch request selector overrides a configured role pin
- lifecycle `startRun()` uses provider order for automatic selection
- lifecycle `startRun()` fails closed when a role pin selects a provider lacking `sessionResume` or `cancellation`

Run:

```bash
npm test -- tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

Expected red: dispatch/lifecycle do not pass routing policy into the router yet.

- [x] **Step 2: Wire shared policy into dispatch and lifecycle**

Pass `config.routing` into `selectProvider()` from:

- `dispatchReadOnlyAgent()`
- `AgentLifecycleManager.startRun()`

Keep role capability and extra lifecycle capability checks unchanged.

Run:

```bash
npm test -- tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

- [x] **Step 3: Write and pass doctor explanation tests**

Doctor should include selection explanation details in each `role-routing:<role>` check. Add tests for:

- default doctor role-routing details include selected provider and candidate evidence
- configured role pin failure marks the role-routing check failed with selector details
- config check details include `routing.rolePins` and `routing.providerOrder` without secrets

Run:

```bash
npm test -- tests/doctor.test.ts
```

- [x] **Step 4: Update MCP schema wording without adding provider-specific fields**

Change the public description for `provider` from "Preferred provider id." to "Preferred provider selector." Add tests that the schemas still expose a string field and do not add provider-family/model-specific object fields.

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

## Task 4: Docs, Roadmap, And Verification

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-38.md`

- [x] **Step 1: Update user-facing docs**

Document:

- provider selectors are exact id, `family:<family>`, `model:<model>`, or `capability:<capability>`
- request-level `provider` takes precedence over role pins
- role pins take precedence over global provider order
- policy remains capability-first and fail-closed
- multi-provider second opinions are modeled as multiple explicit runs, not automatic model comparison
- no model-quality or benchmark claims are made by selection policy

- [x] **Step 2: Update roadmap and changelog**

Mark M38 complete only after proof is captured and move near-term recommendation to M39/M40/M41.

- [x] **Step 3: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/core/lifecycle-registry.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts tests/doctor.test.ts tests/mcp/tools.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
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
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode|routing|rolePins|providerOrder|family:|model:|capability:" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison|ranking" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema" src tests docs README.md CHANGELOG.md
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace" src tests docs README.md CHANGELOG.md
```

- [x] **Step 6: Mark plan complete and commit**

After all proof is captured, mark the L11 gates and task checkboxes complete in this plan, then commit the implementation branch.

## Verification Evidence

- Baseline before implementation: `npm test` passed before implementation in the isolated worktree: 46 files, 349 tests.
- Red proof: added config, router, lifecycle-registry, dispatch, lifecycle, doctor, and MCP schema tests first. They failed because `routing` config did not exist, `explainProviderSelection` did not exist, lifecycle identity ignored routing, dispatch/lifecycle did not pass routing policy, doctor lacked selection explanation details, and public MCP metadata still described `provider` as a provider id. A compatibility regression test for an exact requested provider that exists but is unavailable failed until the throwing wrapper preserved the prior `ProviderNotFoundError` behavior while keeping explanation evidence.
- Focused milestone proof: `npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/core/lifecycle-registry.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts tests/doctor.test.ts tests/mcp/tools.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` passed: 9 files, 177 tests.
- Full proof: `npm run typecheck` passed; `npm test` passed: 46 files, 364 tests; `npm run build` passed.
- Packaged stdio smoke: `npm run smoke:mcp-stdio` passed with `MCP stdio smoke passed.`
- Invariant scans: auth/routing, permission/bypass, model-claim, prompt/schema leakage, and cleanup/process-kill scans were run. Matches were expected config/tests/docs guardrails, provider-local capability/auth descriptors, public README selector examples, existing Claude CLI permission guards, and existing lifecycle cleanup/cancellation paths. No new API-key fallback, public provider-specific MCP schema, hidden prompt exposure, provider ranking result, automatic cleanup shortcut, or process-kill shortcut was introduced by M38.
