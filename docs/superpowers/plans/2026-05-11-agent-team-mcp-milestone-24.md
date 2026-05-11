# Agent Team MCP Milestone 24 Shared Run Pipeline Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the persistence/finalization split between synchronous `agent_team_dispatch` and the lifecycle run manager by introducing shared run pipeline primitives for sidecar construction, events, raw logs, blocked verdicts, evidence merging, snapshot enrichment, and terminalization.

**Architecture:** `agent_team_dispatch` remains a synchronous read-only tool backed by Claude Code CLI `--print` in v1. The lifecycle manager remains the owner of long-running sidecars, mailboxes, status, replies, wind-down, and cleanup. M24 creates shared provider-neutral primitives used by both paths so future providers and policy gates do not have to satisfy two subtly different state machines. The milestone does not convert synchronous dispatch into background-only operation, add non-Claude runtimes, add API-key fallback, or weaken the sidecar/mailbox/verdict contract.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, provider-neutral core modules, atomic sidecar transitions, JSONL mailbox events.

---

## File Structure

- Add `src/core/run-pipeline.ts`: shared run sidecar/event/log/verdict/snapshot/evidence/finalization helpers.
- Modify `src/core/dispatch.ts`: replace local sidecar/event/log/finalization helpers with shared run pipeline helpers.
- Modify `src/core/lifecycle.ts`: replace local blocked verdict and terminal completion transitions with shared run pipeline helpers.
- Add `tests/core/run-pipeline.test.ts`: direct tests for shared finalization semantics.
- Modify `tests/core/dispatch.test.ts`: prove synchronous dispatch uses the same terminalization/event contract.
- Modify `tests/core/lifecycle.test.ts`: prove lifecycle completion still uses the shared terminalization contract.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `dispatch.ts` no longer owns duplicate raw log, event append, blocked verdict, or terminal sidecar finalization helpers.
- `lifecycle.ts` and `dispatch.ts` both use `blockedVerdict` from the shared pipeline.
- Initial run sidecar construction flows through one shared builder while still allowing dispatch and lifecycle to use different status/event sequences.
- Snapshot enrichment and terminal evidence-path merging flow through shared helpers instead of branch-local spread/set logic.
- Completed, failed, and expired terminal writes flow through one shared finalization helper.
- Shared finalization appends the matching event exactly once per call and preserves deterministic event payloads.
- Shared finalization preserves sidecar evidence paths, transcript/log paths, provider session ids, parsed verdicts, output summaries, cleanup state, and implementation workspace evidence.
- Synchronous dispatch behavior remains externally compatible for MCP callers.
- Lifecycle background completion behavior remains compatible for active, failed, expired, and implementation runs.
- Sidecars, mailboxes, verdicts, status, wind-down, and cleanup remain first-class.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, provider runtime implementation, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Shared Finalization Primitive

**Files:**
- Add: `src/core/run-pipeline.ts`
- Add: `tests/core/run-pipeline.test.ts`

- [x] **Step 1: Write failing shared pipeline tests**

Add tests proving:

- `blockedVerdict` builds the existing BLOCKED verdict shape with optional evidence.
- `writeProviderPrintLog` writes `TEXT`, `STDOUT`, and `STDERR` sections to the canonical run log path.
- `finalizeRunSidecar` transitions an existing running sidecar to `completed`, appends a `completed` event, stores verdict/output summary, and de-duplicates evidence paths.
- `finalizeRunSidecar` transitions an existing running sidecar to `failed`, appends a `failed` event, stores partial cleanup, and preserves provider session metadata when supplied.

Run:

```bash
npm test -- tests/core/run-pipeline.test.ts
```

Expected: FAIL because the shared pipeline module does not exist yet.

- [x] **Step 2: Implement shared pipeline helpers**

In `src/core/run-pipeline.ts`, export:

```ts
blockedVerdict(summary, evidence?)
buildRunSidecar(input)
writeProviderPrintLog(workspaceRoot, runId, result)
appendRunEvent(input)
sidecarWithSnapshot(sidecar, snapshot)
completionEvidencePaths(current, additions)
finalizeRunSidecar(input)
```

`finalizeRunSidecar` should:

- use `transitionRunSidecar`
- update `status`, `updatedAt`, `outputSummary`, `verdict`, and `cleanup`
- merge `evidencePaths` with new evidence, `logPath`, and `transcriptPath` using set semantics
- preserve optional snapshot fields supplied by the caller
- append one matching mailbox event after the sidecar transition
- remain provider-neutral and independent of provider runtime APIs

- [x] **Step 3: Run focused shared pipeline tests**

Run:

```bash
npm test -- tests/core/run-pipeline.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/run-pipeline.ts tests/core/run-pipeline.test.ts
git commit -m "feat: add shared run pipeline finalization"
```

## Task 2: Route Synchronous Dispatch Through Shared Pipeline

**Files:**
- Modify: `src/core/dispatch.ts`
- Modify: `tests/core/dispatch.test.ts`

- [x] **Step 1: Write failing dispatch pipeline tests**

Add or tighten tests proving:

- successful synchronous dispatch emits the same terminal event payload as `finalizeRunSidecar`
- failed synchronous dispatch stores `cleanup: "partial"` through shared finalization
- auth-precedence and unsupported-role failures still write sidecars, verdicts, and failed events without invoking a provider

Run:

```bash
npm test -- tests/core/dispatch.test.ts
```

Expected: FAIL because dispatch still owns a local terminalization path that does not set shared cleanup semantics.

- [x] **Step 2: Replace local dispatch helpers**

In `src/core/dispatch.ts`:

- remove local `blockedVerdict`, `writeRawLog`, and `appendEvent`
- import shared helpers from `run-pipeline.ts`
- write the initial sidecar once before terminalization whenever possible
- use `finalizeRunSidecar` for successful provider results, failed provider results, unsupported-role failures, and auth-precedence failures
- keep MCP response shape unchanged

- [x] **Step 3: Run focused dispatch tests**

Run:

```bash
npm test -- tests/core/dispatch.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/dispatch.ts tests/core/dispatch.test.ts
git commit -m "feat: route dispatch through shared run pipeline"
```

## Task 3: Route Lifecycle Completion Through Shared Pipeline

**Files:**
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing lifecycle pipeline tests**

Add or tighten tests proving:

- active lifecycle completion appends terminal events through shared finalization without losing transcript/log evidence
- expired lifecycle completion stores the shared BLOCKED verdict and partial cleanup
- implementation-run completion preserves workspace diff evidence while using shared terminalization

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because lifecycle still owns duplicate terminal transitions.

- [x] **Step 2: Replace local lifecycle completion helpers**

In `src/core/lifecycle.ts`:

- remove local `blockedVerdict`
- import `blockedVerdict` and `finalizeRunSidecar`
- use shared finalization inside `completeRun` for `completed`, `expired`, and other non-completed terminal outcomes
- keep detached reconciliation, cancel, wind-down, reply, and cleanup semantics unchanged

- [x] **Step 3: Run focused lifecycle tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: route lifecycle completion through shared run pipeline"
```

## Task 4: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/run-pipeline.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

Expected: PASS.

- [x] **Step 3: Review boundary and safety invariants**

Run:

```bash
rg "blockedVerdict|finalizeRunSidecar|writeProviderPrintLog|appendRunEvent|cleanup: \"partial\"|cleanup: \"complete\"" src/core tests/core docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-24.md
rg "allowApiKeyFallback|benchmark|embedding|mock LLM|bypassPermissions|process.kill|ANTHROPIC_API_KEY" src/providers src/core tests/providers tests/core
```

Expected: run finalization is shared, provider-neutral, and does not introduce non-Claude runtimes, API fallback, benchmark, embedding, mock LLM, bypass-permission, or process-kill paths.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-24.md
git commit -m "docs: mark shared run pipeline milestone complete"
```
