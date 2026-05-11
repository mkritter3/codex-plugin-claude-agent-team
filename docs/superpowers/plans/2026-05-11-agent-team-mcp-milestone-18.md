# Agent Team MCP Milestone 18 State Corruption Recovery Surfacing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface corrupt sidecar and mailbox state through MCP as explicit recovery results instead of uncaught tool failures.

**Architecture:** Keep recovery provider-neutral under `src/core/state`. M15 added `StateCorruptionError` metadata and `archiveCorruptStateFile`; M18 wires those pieces into MCP lifecycle tools. When a lifecycle tool hits corrupt JSON or JSONL state, the tool should archive the corrupt file, return a structured `state_corrupt` result requiring user intervention, and avoid claiming cancellation, wind-down, cleanup, reply, or status success. The recovery path must not invent role/provider data, must not delete worktrees, and must not mutate unrelated state. If a corruption error lacks path/kind metadata, the tool should still fail closed with `state_corrupt` but report that no archive was possible.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP tool handlers, provider-neutral state archive helpers, typed state corruption errors.

---

## File Structure

- Create `src/core/state/recovery.ts`: convert `StateCorruptionError` into a structured recovery result and archive corrupt artifacts when metadata is available.
- Modify `src/mcp/tools.ts`: wrap lifecycle-backed tool execution in recovery handling for start, status, message, reply, cancel, wind-down, and cleanup.
- Add `tests/core/state/recovery.test.ts`: cover archived and unarchived corruption recovery results.
- Modify `tests/mcp/tools.test.ts`: cover corrupt sidecar status and corrupt mailbox reply recovery through MCP.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- Corrupt run sidecar JSON read through `agent_team_status` returns `status: "state_corrupt"` rather than throwing.
- Corrupt mailbox JSONL read through `agent_team_reply` returns `status: "state_corrupt"` rather than throwing.
- Corrupt files with path/kind metadata are moved under `.agent-team/archive/` with a reason JSON record.
- Recovery results include `runId`, `kind`, `originalPath`, `archivePath`, `reasonPath`, `archivedAt`, `recovery`, and `interventionRequired`.
- Corruption errors without path/kind metadata return a fail-closed unarchived recovery result.
- Normal validation errors still return `validation_error` and are not archived.
- Non-corruption runtime errors keep their existing behavior and are not swallowed.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific recovery logic, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Provider-Neutral Recovery Helper

**Files:**
- Create: `src/core/state/recovery.ts`
- Add: `tests/core/state/recovery.test.ts`

- [x] **Step 1: Write failing recovery helper tests**

Add tests proving:

- a `StateCorruptionError` with path/kind archives the corrupt file and returns `status: "state_corrupt"`
- the recovery result includes archive metadata and `interventionRequired: true`
- a `StateCorruptionError` without path/kind returns `recovery: "unarchived"` and does not throw

Run:

```bash
npm test -- tests/core/state/recovery.test.ts
```

Expected: FAIL because the recovery helper does not exist.

- [x] **Step 2: Implement recovery helper**

Create `recoverStateCorruption(input)` in `src/core/state/recovery.ts`.

The helper should:

- accept `workspaceRoot`, optional `runId`, a `StateCorruptionError`, optional `operation`, and optional `now`
- call `archiveCorruptStateFile` only when both `path` and `kind` are present
- return a plain JSON-serializable result with `status: "state_corrupt"`
- include a clear message that user intervention is required

- [x] **Step 3: Run focused recovery tests**

Run:

```bash
npm test -- tests/core/state/recovery.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/state/recovery.ts tests/core/state/recovery.test.ts
git commit -m "feat: recover corrupt state artifacts"
```

## Task 2: MCP Lifecycle Recovery Surfacing

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [x] **Step 1: Write failing MCP recovery tests**

Add tests proving:

- `agent_team_status` on corrupt run sidecar archives the sidecar and returns `state_corrupt`
- `agent_team_reply` on corrupt inbox mailbox archives the mailbox and returns `state_corrupt`
- validation errors still return `validation_error` without attempting archive
- non-corruption errors still reject

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL because MCP tools currently allow `StateCorruptionError` to escape.

- [x] **Step 2: Wire recovery into MCP lifecycle tools**

Add a small wrapper in `src/mcp/tools.ts` around lifecycle-backed operations.

Apply it to:

- `agent_team_status`
- `agent_team_start`
- `agent_team_message`
- `agent_team_reply`
- `agent_team_cancel`
- `agent_team_wind_down`
- `agent_team_cleanup`

Do not wrap `agent_team_list_roles`, `agent_team_list_providers`, or validation failures.

- [x] **Step 3: Run focused MCP tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: surface state corruption through mcp"
```

## Task 3: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/state/recovery.test.ts tests/mcp/tools.test.ts
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

- [x] **Step 3: Review provider-neutral boundaries**

Run:

```bash
rg "recoverStateCorruption|state_corrupt|archiveCorruptStateFile" src tests
rg "CLAUDE|claude|Claude" src/core/state/recovery.ts src/mcp/tools.ts
```

Expected: recovery remains provider-neutral and Claude-specific code is not touched.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-18.md
git commit -m "docs: mark state recovery milestone complete"
```
