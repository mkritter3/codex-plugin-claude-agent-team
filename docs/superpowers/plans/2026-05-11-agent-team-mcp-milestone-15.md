# Agent Team MCP Milestone 15 State Archive And Log Rotation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make state corruption, concurrent sidecar writes, outbox reconciliation, and oversized provider logs fail closed without losing evidence.

**Architecture:** Keep state hardening in provider-neutral `src/core/state` modules. Sidecar transitions need a per-run lock so cancel, wind-down, completion, and status reconciliation do not overwrite each other. Low-level readers should still throw typed `StateCorruptionError`, but now include machine-readable file metadata so callers can archive the corrupt artifact. Add shared archive helpers that move corrupt files under `.agent-team/archive/` with a reason sidecar. Lifecycle outbox reconciliation must run under the sidecar lock so one provider request yields one outbox record and one durable `outboxRequestIds` entry even when status calls race. Log rotation belongs in a reusable core log writer used by the Claude background adapter; the provider adapter should not hand-roll size checks. Rotation must preserve old bytes with numeric suffixes and keep current logs bounded.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, atomic JSON helpers, append-only JSONL mailboxes, provider-neutral state archive helpers, bounded append log writer.

---

## File Structure

- Modify `src/core/errors.ts`: add path/kind metadata to `StateCorruptionError` without breaking existing `toThrow(StateCorruptionError)` tests.
- Modify `src/core/state/run-store.ts`: add a reusable per-run sidecar lock and serialize transitions.
- Modify `src/core/lifecycle.ts`: make outbox reconciliation atomic/idempotent under the sidecar lock.
- Modify `src/core/state/atomic-json.ts`: throw `StateCorruptionError` with path and `json` kind.
- Modify `src/core/state/mailbox-store.ts`: throw `StateCorruptionError` with path and `jsonl` kind.
- Create `src/core/state/archive.ts`: archive corrupt state files into `.agent-team/archive/` and write a small reason record.
- Create `src/core/logs.ts`: shared bounded append helper with max bytes and rotation count.
- Modify `src/providers/claude-code-cli/background.ts`: use the shared bounded log writer for transcript/log writes.
- Modify `tests/core/lifecycle.test.ts`: cover concurrent outbox reconciliation idempotence.
- Modify `tests/core/state/run-store.test.ts`: cover sidecar corruption metadata through `readRunSidecar`.
- Modify `tests/core/state/mailbox-store.test.ts`: cover mailbox corruption metadata.
- Add `tests/core/state/archive.test.ts`: cover corrupt file archival and reason records.
- Add `tests/core/logs.test.ts`: cover bounded append rotation.
- Modify `tests/providers/claude-code-cli/background.test.ts`: cover background log rotation through injected limits.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `StateCorruptionError` carries the corrupt file path and state kind while preserving existing typed error behavior.
- Sidecar transitions are serialized per run.
- Concurrent outbox reconciliation appends exactly one outbox record for one provider request.
- Corrupt sidecar JSON and corrupt mailbox JSONL tests assert path/kind metadata.
- Shared archive helper moves corrupt files under `.agent-team/archive/` and writes a reason JSON record.
- Archive paths never overwrite prior archived files.
- Shared bounded log writer rotates logs when appending would exceed the max byte budget.
- Claude background session writes raw transcript/log data through the shared bounded writer.
- Background log rotation is configurable in tests and defaults to a conservative production cap.
- No mailbox sequencing, sidecar status, verdict parsing, wind-down, or cleanup behavior regresses.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific state archive logic, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Sidecar Locking And Outbox Idempotence

**Files:**
- Modify: `src/core/state/run-store.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/state/run-store.test.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Write failing concurrency tests**

Add tests proving:

- concurrent `transitionRunSidecar` calls for the same run serialize rather than losing updates
- concurrent `getStatus` calls observing the same provider outbox request append exactly one `outbox.jsonl` record
- the sidecar `outboxRequestIds` contains exactly one request id after the race

Run:

```bash
npm test -- tests/core/state/run-store.test.ts tests/core/lifecycle.test.ts
```

Expected: FAIL because sidecar transitions are not locked and outbox reconciliation appends before the durable idempotence marker is protected.

- [ ] **Step 2: Implement sidecar locking and atomic outbox reconciliation**

Add a provider-neutral per-run lock helper in `run-store.ts`, use it inside `transitionRunSidecar`, and expose it for lifecycle code that must combine mailbox append plus sidecar update under one lock.

Update lifecycle outbox reconciliation to:

- acquire the run lock
- re-read the sidecar
- skip if the request id is already recorded
- append the outbox record
- write the sidecar with `awaiting-input`, request evidence, and request id

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/state/run-store.test.ts tests/core/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/state/run-store.ts src/core/lifecycle.ts tests/core/state/run-store.test.ts tests/core/lifecycle.test.ts
git commit -m "feat: serialize sidecar state transitions"
```

## Task 2: Corruption Metadata And Archive Helper

**Files:**
- Modify: `src/core/errors.ts`
- Modify: `src/core/state/atomic-json.ts`
- Modify: `src/core/state/mailbox-store.ts`
- Create: `src/core/state/archive.ts`
- Modify: `tests/core/state/run-store.test.ts`
- Modify: `tests/core/state/mailbox-store.test.ts`
- Create: `tests/core/state/archive.test.ts`

- [ ] **Step 1: Write failing corruption metadata and archive tests**

Add tests proving:

- corrupt sidecar JSON throws `StateCorruptionError` with path and kind `json`
- corrupt mailbox JSONL throws `StateCorruptionError` with path and kind `jsonl`
- `archiveCorruptStateFile` moves a corrupt file into `.agent-team/archive/`
- archive helper writes a reason JSON record including original path, archive path, reason, and timestamp
- repeated archives of the same original file do not overwrite prior archives

Run:

```bash
npm test -- tests/core/state/run-store.test.ts tests/core/state/mailbox-store.test.ts tests/core/state/archive.test.ts
```

Expected: FAIL because errors lack metadata and archive helper does not exist.

- [ ] **Step 2: Implement provider-neutral corruption metadata and archive helper**

Update `StateCorruptionError` to accept metadata and expose:

- `path`
- `kind`

Implement `archiveCorruptStateFile` under `src/core/state/archive.ts` using filesystem rename, unique names, and a companion `.reason.json` file.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/state/run-store.test.ts tests/core/state/mailbox-store.test.ts tests/core/state/archive.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/errors.ts src/core/state/atomic-json.ts src/core/state/mailbox-store.ts src/core/state/archive.ts tests/core/state/run-store.test.ts tests/core/state/mailbox-store.test.ts tests/core/state/archive.test.ts
git commit -m "feat: archive corrupt state artifacts"
```

## Task 3: Shared Bounded Log Writer

**Files:**
- Create: `src/core/logs.ts`
- Create: `tests/core/logs.test.ts`

- [ ] **Step 1: Write failing log rotation tests**

Add tests proving:

- bounded append creates parent directories and writes text
- appending beyond max bytes rotates `run.log` to `run.log.1`
- rotation keeps the active log under the configured cap
- rotation count is bounded and older files shift predictably

Run:

```bash
npm test -- tests/core/logs.test.ts
```

Expected: FAIL because the shared log writer does not exist.

- [ ] **Step 2: Implement bounded append helper**

Create `appendBoundedLog` with options:

- `maxBytes`
- `maxRotatedFiles`

Use byte length rather than character length, create parent directories, and rotate before appending when needed.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/logs.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/logs.ts tests/core/logs.test.ts
git commit -m "feat: add bounded log rotation"
```

## Task 4: Claude Background Log Rotation

**Files:**
- Modify: `src/providers/claude-code-cli/background.ts`
- Modify: `tests/providers/claude-code-cli/background.test.ts`

- [ ] **Step 1: Write failing background rotation test**

Add a test proving Claude background stdout/stderr writes rotate `.agent-team/logs/<run-id>.log` when configured with a small max byte budget.

Run:

```bash
npm test -- tests/providers/claude-code-cli/background.test.ts
```

Expected: FAIL because background writes use unbounded `appendFile`.

- [ ] **Step 2: Wire shared bounded writer**

Update background session dependencies/options to allow small test limits while defaulting production logs to a conservative cap. Use the shared bounded writer for both raw transcript and combined log writes.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/background.test.ts tests/core/logs.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/background.ts tests/providers/claude-code-cli/background.test.ts
git commit -m "feat: rotate claude background logs"
```

## Task 5: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/state/run-store.test.ts tests/core/state/mailbox-store.test.ts tests/core/state/archive.test.ts tests/core/logs.test.ts tests/providers/claude-code-cli/background.test.ts
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

- [ ] **Step 3: Review provider-neutral boundaries**

Run:

```bash
rg "archiveCorruptStateFile|StateCorruptionError|appendBoundedLog" src tests
rg "CLAUDE|claude|Claude" src/core/state src/core/logs.ts
```

Expected: archive/log helpers remain provider-neutral; Claude-specific usage stays in the Claude adapter.

- [ ] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-15.md
git commit -m "docs: mark state hardening milestone complete"
```
