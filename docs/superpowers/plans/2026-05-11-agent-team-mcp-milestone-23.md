# Agent Team MCP Milestone 23 Detached Run Reconciliation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make restarted/orphaned nonterminal runs durable, explicit, and control-safe instead of only returning ephemeral detached warnings.

**Architecture:** The lifecycle manager owns state transitions and may lose live provider handles when the MCP server restarts. M23 adds provider-neutral detached reconciliation: status persists detached metadata and a single event, cancel records intent without pretending to kill anything, and wind-down closes normal input while preserving evidence and the honest “no active handle” warning. This does not reattach to unknown processes or kill by pid; safe provider resume remains through existing `agent_team_reply` session-id flows.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, provider-neutral lifecycle manager, atomic sidecar transitions, JSONL mailbox events.

---

## File Structure

- Modify `src/core/types.ts`: add durable detached metadata fields to `RunSidecar`.
- Modify `src/core/lifecycle.ts`: add idempotent detached reconciliation and use it from status, cancel, and wind-down.
- Modify `tests/core/lifecycle.test.ts`: cover durable detached reconciliation, cancel intent, and detached wind-down behavior.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `agent_team_status` / `AgentLifecycleManager.getStatus` persists `detached: true` and `detachedAt` for nonterminal sidecars with no active handle.
- Detached reconciliation appends exactly one `detached_handle_missing` event per run.
- Repeated status calls do not duplicate detached warnings or detached events.
- Detached cancellation appends `cancel_requested`, returns an honest “no active process handle” message, preserves nonterminal status, and keeps `detached: true`.
- Detached wind-down appends `wind_down_requested`, marks `inputClosed: true`, keeps `detached: true`, and does not claim provider finalization.
- Terminal runs are not marked detached.
- No attempt is made to kill, reattach to, or infer the state of an unknown provider process.
- Sidecars, mailboxes, verdicts, status, wind-down, and cleanup remain first-class.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, provider runtime implementation, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Durable Detached Status Reconciliation

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Write failing detached status reconciliation tests**

Add tests proving:

- a running sidecar with no active handle is persisted with `detached: true` and `detachedAt`
- status returns the persisted detached metadata
- `events.jsonl` receives exactly one `detached_handle_missing` record
- a second status call does not append a second detached event or duplicate warnings
- terminal sidecars are not marked detached

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because detached status is currently returned ephemerally and no detached event is written.

- [ ] **Step 2: Implement detached reconciliation helper**

In `src/core/types.ts`, add:

```ts
readonly detachedAt?: string;
```

to `RunSidecar`.

In `src/core/lifecycle.ts`, add a private helper:

```ts
private async reconcileDetachedRun(
  workspaceRoot: string,
  sidecar: RunSidecar
): Promise<RunSidecar>
```

The helper should:

- return terminal sidecars unchanged
- add `detached: true`, `detachedAt`, `updatedAt`, and one warning when missing
- preserve existing detached metadata when already present
- append one `detached_handle_missing` event only when the sidecar was not already detached
- use `transitionRunSidecar` for durable sidecar updates

Update `getStatus` so a nonterminal sidecar with no active handle returns the reconciled sidecar.

- [ ] **Step 3: Run focused lifecycle tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: persist detached run reconciliation"
```

## Task 2: Detached Control Semantics

**Files:**
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Write failing detached control tests**

Add tests proving:

- `cancelRun` on a detached nonterminal sidecar persists detached metadata and appends `cancel_requested`
- detached cancel does not transition to `cancelled`
- `windDownRun` on a detached nonterminal sidecar persists detached metadata, sets `status: "winding-down"`, sets `inputClosed: true`, and appends `wind_down_requested`
- detached wind-down appends no provider live-delivery or grace-elapsed event because no live handle exists

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because cancel currently records intent without durable detached metadata and wind-down warning is not normalized through detached reconciliation.

- [ ] **Step 2: Use detached reconciliation in cancel and wind-down**

In `src/core/lifecycle.ts`:

- call `reconcileDetachedRun` before returning from the no-active-handle branch in `cancelRun`
- in `windDownRun`, when no active handle exists, transition to `winding-down` with `inputClosed: true`, then call detached reconciliation on that sidecar before returning
- keep the existing control mailbox records
- do not call `kill`, `forceKill`, or provider stdin when no active handle exists

- [ ] **Step 3: Run focused lifecycle tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: reconcile detached run controls"
```

## Task 3: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

Expected: PASS.

- [ ] **Step 3: Review boundary and safety invariants**

Run:

```bash
rg "detached|detachedAt|detached_handle_missing|cancel_requested|wind_down_requested" src/core tests/core tests/mcp docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-23.md
rg "allowApiKeyFallback|benchmark|embedding|mock LLM|bypassPermissions|pid|process.kill" src/providers src/core tests/providers tests/core
```

Expected: detached reconciliation stays provider-neutral; no process-pid reattachment, non-Claude runtime, API fallback, benchmark, embedding, mock LLM, or bypass-permission runtime path is introduced.

- [ ] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-23.md
git commit -m "docs: mark detached run reconciliation milestone complete"
```
