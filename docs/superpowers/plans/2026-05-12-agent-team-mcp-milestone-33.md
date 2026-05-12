# Agent Team MCP Milestone 33 Provider Adapter Conformance Harness Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable provider runtime conformance harness so every future adapter proves descriptor, health, lifecycle, structured-output, and unsupported-capability behavior before it can be trusted by the provider-neutral control plane.

**Architecture:** M33 adds test infrastructure around the existing `AgentProviderRuntime` contract rather than introducing a new provider or MCP tool. A reusable test helper under `tests/providers/conformance/` will exercise runtime descriptors, health checks, print output, background session handles, resume metadata, cancellation handles, snapshot shape, and router fail-closed behavior using fixture runtimes only. The harness remains test-owned and provider-neutral; production runtime contracts stay in `src/providers/runtime.ts` and `src/providers/types.ts`.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing provider runtime interfaces, existing provider router, fixture provider runtimes, no live model calls.

---

## Scope

**Files:**

- Create: `tests/providers/conformance/runtime-conformance.ts`
- Create: `tests/providers/conformance/runtime-conformance.test.ts`
- Modify: `tests/providers/runtime.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-33.md`

**Non-goals:**

- Do not add OpenAI-compatible, Ollama, Gemini, Grok, or any other non-Claude provider adapter.
- Do not change public MCP schemas, tool names, or tool metadata.
- Do not change Claude Code CLI subscription OAuth as the primary v1 transport.
- Do not add API-key fallback, endpoint fallback, or inferred provider selection.
- Do not run live Claude or non-Claude provider calls in CI.
- Do not make model-quality, benchmark, long-context, reasoning, or provider-comparison claims.
- Do not move provider-specific implementation details into MCP schemas or core lifecycle.
- Do not weaken `slice-implementer` isolated-worktree and explicit cleanup semantics.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for new behavior.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are explicitly selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Provider adapters: descriptor shape, conservative capabilities, health result shape, command/endpoint/auth/model diagnostics shape, unsupported capability failures, no `bypassPermissions`.
- Provider routing: unsupported role/capability rejection, requested provider mismatch, write-mode disabled, write-mode enabled without capable provider.
- Auth posture: subscription OAuth descriptors remain explicit; API fallback behavior is not inferred.
- Failure behavior: conformance fixtures prove unsupported capability failures without starting provider sessions.
- Lifecycle safety: session handles expose durable snapshot metadata, done status, cancellation functions, stdin support, transcript/log pointers, and resume session propagation.
- Documentation: roadmap/changelog/README describe the harness without claiming provider quality.
- Boundary scan: provider-specific leakage, fallback, benchmark/model-quality claims, and process-kill shortcuts are reviewed.

Live provider smoke is not required for M33 because the harness proves adapter mechanics with fixture runtimes only. Live smoke becomes required later before claiming non-Claude provider readiness or model quality.

## Success Criteria

- A reusable `describeProviderRuntimeConformance` helper exists under `tests/providers/conformance/runtime-conformance.ts`.
- The helper validates:
  - descriptor id/display/auth/capability shape
  - conservative capability declaration with no duplicate capabilities
  - health check result ids/status/messages/details shape
  - `inspectEnvironment` warning shape
  - `runPrint` structured output boundaries without parsing or judging model quality
  - `startSession` handle shape, snapshot shape, done status, stdin support, transcript/log pointers, and recent activity shape
  - resume propagation when `sessionId` is provided
  - cancellation mechanics through `kill()` and `forceKill()`
  - fail-closed routing when a descriptor lacks required role capabilities
- A fixture runtime test suite proves the helper runs against a conforming runtime and would catch missing mechanics.
- Existing provider registry tests prove bundled runtimes remain listable and Claude Code CLI remains subscription OAuth.
- README or changelog tells future adapter authors to add the conformance suite before adapter-specific tests.
- Roadmap marks M33 complete and keeps M34 as the next milestone.
- No public MCP schema or runtime behavior changes.
- No API-key fallback, heuristic/mock LLM model-quality claim, benchmark claim, provider-specific public schema, or live-provider CI path is introduced.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Reusable Conformance Helper Red Proof

**Files:**

- Create: `tests/providers/conformance/runtime-conformance.test.ts`

- [x] **Step 1: Write failing fixture conformance tests**

Create `tests/providers/conformance/runtime-conformance.test.ts` that imports `describeProviderRuntimeConformance` and defines:

- a conforming fixture runtime with:
  - descriptor id `fixture-runtime`
  - auth mode `oauth`
  - capabilities `["structuredOutput", "tools", "sessionResume", "cancellation"]`
  - health checks for `fixture-cli` and `fixture-auth`
  - `inspectEnvironment` returning one warning from a fixture env value
  - `runPrint` returning `ok`, `sessionId`, `text`, `stdout`, `stderr`, and `exitCode`
  - `startSession` returning a handle with `snapshot()`, `kill()`, `forceKill()`, optional `writeStdin()`, transcript/log paths, and done status
- a read-only descriptor fixture that lacks implementation capabilities and must fail `slice-implementer` routing.

Run:

```bash
npm test -- tests/providers/conformance/runtime-conformance.test.ts
```

Observed: FAIL because `tests/providers/conformance/runtime-conformance.ts` did not exist yet.

## Task 2: Implement The Harness

**Files:**

- Create: `tests/providers/conformance/runtime-conformance.ts`
- Modify: `tests/providers/conformance/runtime-conformance.test.ts`

- [x] **Step 1: Add conformance helper API**

Export:

```ts
export interface ProviderRuntimeConformanceFixture {
  readonly name: string;
  readonly runtime: AgentProviderRuntime;
  readonly descriptor: AgentProviderDescriptor;
  readonly unsupportedRoleId?: RoleId;
  readonly supportedRoleId?: RoleId;
  readonly sampleCwd: string;
  readonly sampleWorkspaceRoot: string;
}

export function describeProviderRuntimeConformance(
  fixture: ProviderRuntimeConformanceFixture
): void
```

- [x] **Step 2: Implement conformance assertions**

Inside the helper, define Vitest tests that assert:

- runtime id equals descriptor id
- descriptor has non-empty id/displayName, valid authMode, unique capabilities, boolean availability, and no unknown capabilities
- descriptor for `unsupportedRoleId ?? "slice-implementer"` fails routing when capabilities are missing
- health checks return non-empty ids, status in `pass|warn|fail`, messages, and object details when present
- `inspectEnvironment` returns an array of string warnings
- `runPrint` returns structured fields without requiring or parsing model quality
- `startSession` returns a handle whose snapshot has arrays for warnings, activities, pending outbox requests, and stderr
- resume input propagates through `sessionId`
- `kill()` and `forceKill()` are callable and the done status resolves to an allowed status

- [x] **Step 3: Run focused conformance tests**

Run:

```bash
npm test -- tests/providers/conformance/runtime-conformance.test.ts
```

Observed: PASS.

## Task 3: Registry And Documentation Coverage

**Files:**

- Modify: `tests/providers/runtime.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [x] **Step 1: Add failing registry/docs assertions**

Update `tests/providers/runtime.test.ts` to assert that the conformance helper exists and is referenced as the expected future-adapter gate. Add docs assertions only if an existing docs test already covers the target text; otherwise keep docs proof through focused grep and final scans.

Run:

```bash
npm test -- tests/providers/runtime.test.ts
```

Observed: the helper import guard passed after helper implementation; docs coverage was verified with packaging/runbook tests and invariant scans.

- [x] **Step 2: Update provider registry tests**

Keep runtime registry tests focused on:

- bundled Claude runtime remains listed
- Claude descriptor remains `subscription-oauth`
- missing runtime still fails closed
- conformance helper import is available for future provider tests

- [x] **Step 3: Update README, changelog, and roadmap**

Update:

- `README.md`: add a compact adapter-development note requiring the conformance harness before any new provider adapter.
- `CHANGELOG.md`: add M33 conformance harness coverage to `0.1.0`.
- Roadmap: mark M33 complete in the current baseline and move near-term recommendation to M34.

- [x] **Step 4: Run focused registry/docs tests**

Run:

```bash
npm test -- tests/providers/runtime.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Observed: PASS.

## Task 4: Verification And Integration

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-33.md`

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/providers/conformance/runtime-conformance.test.ts tests/providers/runtime.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Observed: PASS.

- [x] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

Observed: all PASS.

- [x] **Step 3: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers
rg "benchmark|model-quality|mock LLM|embedding|heuristic" src tests docs README.md CHANGELOG.md
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace" src tests docs README.md CHANGELOG.md
rg "provider-specific MCP|internal prompt|hidden instruction|generated agent definition" src tests docs README.md CHANGELOG.md
```

Observed: matches were existing guard tests/docs or the new conformance harness docs/fixtures. No public provider-specific schema, hidden prompt leakage, process-kill shortcut, API fallback, benchmark, or model-quality claim was introduced.

- [x] **Step 4: Mark plan complete and commit**

After all proof is captured, mark the L11 gates and task checkboxes complete in this plan, then commit the implementation branch.

## Verification Evidence

- Baseline before implementation: `npm test` passed with 40 files and 266 tests.
- Red proof: `npm test -- tests/providers/conformance/runtime-conformance.test.ts` failed because `tests/providers/conformance/runtime-conformance.ts` did not exist.
- Focused conformance proof: `npm test -- tests/providers/conformance/runtime-conformance.test.ts` passed with 7 tests.
- Focused milestone proof: `npm test -- tests/providers/conformance/runtime-conformance.test.ts tests/providers/runtime.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` passed with 4 files and 18 tests.
- Full proof: `npm run typecheck && npm test && npm run build && npm run smoke:mcp-stdio` passed with 41 files and 274 tests plus packaged stdio smoke.
- Invariant scans completed for auth posture, permission/bypass boundaries, benchmark/model-quality claims, cleanup/process-kill shortcuts, and prompt/provider-specific schema leakage.
