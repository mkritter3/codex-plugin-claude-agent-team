# Agent Team MCP Milestone 29 Batch Cancel Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agent_team_cancel_many` so Codex can explicitly cancel multiple durable agent runs in one bounded MCP call without hiding evidence or deleting retained implementation worktrees.

**Architecture:** `agent_team_cancel_many` is a control-family MCP tool over the existing lifecycle manager. Each child run delegates to `AgentLifecycleManager.cancelRun`, preserving control records, cancellation intent, active-handle cancellation, detached semantics, terminal semantics, sidecars, logs, diffs, and shared state-corruption recovery. The batch helper stays provider-neutral and returns ordered per-run results with partial-failure evidence; it never wind-downs, resumes, messages, cleans up worktrees, deletes evidence, or calls provider-specific process APIs.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP Zod schemas, provider-neutral lifecycle manager, durable control mailboxes, state recovery, packaged stdio smoke.

---

## Scope

**Files:**

- Create: `src/core/cancel-many.ts`
- Create: `tests/core/cancel-many.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Modify: `tests/package-runtime.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-29.md`

**Non-goals:**

- Do not change single-run `agent_team_cancel` semantics.
- Do not use cancellation as a graceful final-summary or wind-down substitute.
- Do not call `windDownRun`, `messageRun`, `replyRun`, `cleanupRunWorkspace`, provider command builders, or provider process APIs from the batch helper.
- Do not delete retained worktrees, logs, sidecars, diffs, transcripts, or mailbox evidence.
- Do not add provider-specific MCP schemas or expose provider implementation details.
- Do not add API-key fallback, benchmark/model-quality claims, live-provider CI, team records, dashboards, or provider adapters.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for new behavior.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are explicitly selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Input validation: non-empty `runs`, object children, non-empty `runId`, non-empty optional `cwd` and `correlationId`, duplicate target rejection, and concurrency bounds.
- MCP handlers: invalid inputs return `validation_error` before lifecycle invocation; unknown tools remain explicit.
- Batch tools: bounded concurrency, ordered results, per-item `index`, run id, cwd, optional correlation id, partial failures, and one-child state corruption recovery.
- Cancellation: each child delegates to lifecycle `cancelRun`; cancellation intent remains durable per run; retained worktrees and evidence are not deleted.
- State durability: sidecars, logs, control records, diffs, transcripts, verdicts, and cleanup metadata remain per-run evidence.
- Lifecycle safety: batch cancel must not wind down, message, reply, cleanup, start, resume, or provider-route.
- Workspace safety: implementation worktrees remain retained until explicit cleanup.
- Public schema: public MCP metadata exposes only `runs`, `cwd`, and `concurrency`; it does not mention internal prompts, provider internals, process ids, or cleanup shortcuts.
- Packaged runtime: stdio smoke against built `dist/index.js` asserts `agent_team_cancel_many` requires `runs`.
- Documentation: user docs distinguish explicit cancellation from graceful wind-down and explicit cleanup.

Live provider smoke is not required for this milestone because M29 adds a provider-neutral lifecycle batch wrapper and can be proven through lifecycle fixtures plus existing durable cancellation tests. Live Claude behavior remains opt-in through the runbook.

## Success Criteria

- `agent_team_cancel_many` appears in `listToolNames()`, MCP metadata, packaged stdio smoke, README workflow docs, and tests.
- Input shape is `{ runs: [{ runId, cwd?, correlationId? }], cwd?, concurrency? }`.
- Top-level `cwd` applies as the default for child cancellations; item-level `cwd` can override it.
- `runs` must be a non-empty array of objects with non-empty `runId` strings.
- Optional `cwd` and `correlationId` values must be non-empty strings.
- `concurrency` must be a positive integer from 1 through 8; default is 8.
- Duplicate `{ cwd, runId }` targets in the same batch are rejected before lifecycle invocation.
- Results preserve input order even when child lifecycle calls resolve out of order.
- Each successful item returns `{ status: "ok", index, runId, cwd, correlationId?, result }`.
- A non-corruption cancellation failure returns `{ status: "failed", index, runId, cwd, correlationId?, error }` without aborting the whole call.
- A `StateCorruptionError` for one run returns `{ status: "state_corrupt", index, runId, cwd, correlationId?, recovery }` using shared recovery with operation `agent_team_cancel_many`.
- Top-level status is `"ok"` only when all items are `ok`; otherwise it is `"partial_failure"`.
- The batch helper calls only lifecycle `cancelRun` for child controls and shared `recoverStateCorruption` for corruption evidence.
- Cancellation does not clean up retained implementation worktrees, remove evidence, synthesize quality claims, or imply graceful finalization.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, provider runtime implementation, process-kill shortcut, or automatic workspace deletion is introduced.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Core Batch Cancel Helper

**Files:**

- Create: `src/core/cancel-many.ts`
- Modify: `src/core/types.ts`
- Create: `tests/core/cancel-many.test.ts`

- [x] **Step 1: Write failing core batch-cancel tests**

Create `tests/core/cancel-many.test.ts` with tests proving:

- `cancelAgentRuns` cancels runs with bounded concurrency and preserves input order when promises resolve out of order.
- child successes include `status`, `index`, `runId`, `cwd`, optional `correlationId`, and lifecycle `result`.
- child non-corruption failures become `failed` items and later runs still cancel.
- child `StateCorruptionError` failures become `state_corrupt` items using `operation: "agent_team_cancel_many"` and later runs still cancel.
- recovery failures become per-run failed items and later runs still cancel.

Run:

```bash
npm test -- tests/core/cancel-many.test.ts
```

Observed: FAIL because `src/core/cancel-many.ts` did not exist yet.

- [x] **Step 2: Add batch-cancel types**

In `src/core/types.ts`, add request/result types matching the existing batch wind-down type shape but named `AgentCancelManyRun`, `AgentCancelManyRequest`, `AgentCancelManyOk`, `AgentCancelManyFailed`, `AgentCancelManyRecovered`, `AgentCancelManyItem`, and `AgentCancelManyResult`.

- [x] **Step 3: Implement bounded batch-cancel helper**

In `src/core/cancel-many.ts`, export:

```ts
export interface CancelManyDependencies {
  readonly cancelRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
  readonly recoverStateCorruption: (input: StateCorruptionRecoveryInput) => Promise<unknown>;
}

export async function cancelAgentRuns(
  request: AgentCancelManyRequest,
  deps: CancelManyDependencies
): Promise<AgentCancelManyResult>
```

Implementation requirements:

- allocate a fixed result array with the same length as `request.runs`
- run a worker loop with `Math.min(request.concurrency, request.runs.length)` workers
- each worker claims the next index synchronously before awaiting lifecycle work
- call `deps.cancelRun(run.cwd, run.runId)` for every child
- map successes to `{ status: "ok", index, runId, cwd, correlationId?, result }`
- map `StateCorruptionError` to `{ status: "state_corrupt", index, runId, cwd, correlationId?, recovery }`
- map recovery failures to `{ status: "failed", index, runId, cwd, correlationId?, error: "state recovery failed: ..." }`
- map other thrown errors to `{ status: "failed", index, runId, cwd, correlationId?, error }`
- return top-level `partial_failure` when any item is not `ok`

- [x] **Step 4: Run focused core tests**

Run:

```bash
npm test -- tests/core/cancel-many.test.ts
```

Observed: PASS.

## Task 2: MCP Schema And Handler

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`

- [x] **Step 1: Write failing MCP tests**

Add tests proving:

- invalid `agent_team_cancel_many` inputs return `validation_error` before lifecycle invocation
- valid calls default top-level `cwd`, preserve item-level `cwd`, correlation ids, and ordered results
- lifecycle partial failures stay per-run and do not stop later runs
- one corrupt sidecar is recovered with operation `agent_team_cancel_many`
- `listToolNames()` and MCP metadata include `agent_team_cancel_many` after `agent_team_cancel`

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Observed: FAIL because `agent_team_cancel_many` was unknown and had no metadata.

- [x] **Step 2: Add public schema**

In `src/mcp/schemas.ts`, add a `cancelManyRunInputSchema` and `cancelManyInputSchema` matching `runs`, `cwd`, and optional `concurrency`, then add metadata:

```ts
agent_team_cancel_many: {
  title: "Cancel Agent Sessions",
  description: "Request cancellation for multiple active or durable runs with bounded concurrency.",
  inputSchema: cancelManyInputSchema
}
```

The description must not mention provider internals, prompts, process ids, cleanup, or wind-down.

- [x] **Step 3: Add parser and handler**

In `src/mcp/tools.ts`:

- import `cancelAgentRuns`
- add `agent_team_cancel_many` after `agent_team_cancel` in `TOOL_NAMES`
- add `AgentCancelManyRequest` and `AgentCancelManyRun` imports
- add `parseCancelManyArgs` mirroring `parseWindDownManyArgs`, with duplicate `{ resolved cwd, runId }` rejection
- handle `agent_team_cancel_many` by calling `cancelAgentRuns(parsed, { cancelRun, recoverStateCorruption })`

Do not call `windDownRun`, `cleanupRunWorkspace`, `messageRun`, `replyRun`, provider APIs, or direct mailbox writers in the batch tool.

- [x] **Step 4: Run focused MCP tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Observed: PASS.

## Task 3: Packaged Runtime And Docs

**Files:**

- Modify: `scripts/smoke-mcp-stdio.mjs`
- Modify: `tests/package-runtime.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [x] **Step 1: Write failing packaged-runtime assertions**

Update `tests/package-runtime.test.ts` to require:

```ts
expect(script).toContain(
  'assertToolRequires(tools.tools, "agent_team_cancel_many", ["runs"])'
);
```

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Observed: FAIL because the smoke script did not assert `agent_team_cancel_many`.

- [x] **Step 2: Add smoke coverage**

In `scripts/smoke-mcp-stdio.mjs`, assert:

```js
assertToolRequires(tools.tools, "agent_team_cancel_many", ["runs"]);
```

- [x] **Step 3: Update docs and roadmap**

Update:

- `README.md` workflow to include explicit `agent_team_cancel_many` for operator-driven cancellation and keep graceful completion on `agent_team_wind_down_many`.
- `CHANGELOG.md` `0.1.0` section to mention batch cancellation support.
- roadmap current baseline and near-term recommendation to show V1 batch cancel is complete and provider adapter conformance is next.

- [x] **Step 4: Run focused package/docs tests**

Run:

```bash
npm test -- tests/package-runtime.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Observed: PASS.

## Task 4: Verification And Integration

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-29.md`

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/cancel-many.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
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
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|agent_team_cancel_many|partial_failure|concurrency|correlationId|StateCorruptionError|recoverStateCorruption" src tests docs README.md CHANGELOG.md
```

Observed: matches were limited to existing config/guard tests/docs and the new provider-neutral batch-cancel implementation/tests/docs. No provider-specific schema, hidden cleanup, prompt leakage, process-kill shortcut, API fallback, benchmark, or model-quality claim was introduced.

- [x] **Step 4: Mark plan complete and commit**

After all proof is captured, mark the L11 gates and task checkboxes complete in this plan, then commit the implementation branch.

## Verification Evidence

- Baseline before implementation: `npm test` passed with 39 files and 258 tests.
- Core red proof: `npm test -- tests/core/cancel-many.test.ts` failed because `src/core/cancel-many.ts` did not exist.
- MCP red proof: `npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts` failed because `agent_team_cancel_many` was unknown and had no metadata.
- Packaged-runtime red proof: `npm test -- tests/package-runtime.test.ts` failed because stdio smoke did not assert `agent_team_cancel_many`.
- Focused green proof: `npm test -- tests/core/cancel-many.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` passed with 6 files and 65 tests.
- Full green proof: `npm run typecheck && npm test && npm run build && npm run smoke:mcp-stdio` passed with 40 files and 266 tests plus packaged stdio smoke.
