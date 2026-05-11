# Agent Team MCP Milestone 13 Outbox Awaiting-Input Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent-to-Codex in-flight communication first-class by adding durable outbox records, explicit awaiting-input transitions, and status evidence for agent clarification or approval requests.

**Architecture:** Codex remains the communication hub. Providers must not infer questions from free-form model text. Instead, a provider session may surface explicit structured requests through its snapshot, the lifecycle manager persists those requests to `outbox.jsonl`, and the run sidecar transitions from `running` to `awaiting-input`. `agent_team_status` exposes the latest pending request evidence through the sidecar, and `agent_team_message` appends the human/Codex reply to `inbox.jsonl`, live-delivers it when supported, and transitions the sidecar back to `running` after the reply is recorded. This preserves provider neutrality: lifecycle consumes a generic `ProviderOutboxRequest`, while Claude-specific parsing remains in the Claude adapter.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, append-only JSONL mailboxes, provider session snapshots, existing lifecycle registry and MCP tool handlers.

---

## File Structure

- Modify `src/providers/types.ts`: add provider-neutral `ProviderOutboxRequest` and expose pending outbox requests on `ProviderSessionSnapshot`.
- Modify `src/providers/claude-code-cli/stream-parser.ts`: parse only explicit structured outbox request events; do not use free-form text heuristics.
- Modify `src/providers/claude-code-cli/background.ts`: surface parser outbox requests through live snapshots.
- Modify `src/core/types.ts`: add sidecar fields for latest pending outbox request evidence and extend message result details if needed.
- Modify `src/core/state/mailbox-store.ts`: add `appendOutboxRecord` for shared durable outbox writes.
- Modify `src/core/lifecycle.ts`: reconcile pending outbox requests during status/message flows, transition `running -> awaiting-input`, append outbox records once, and transition back to `running` after `agent_team_message`.
- Modify `tests/core/state/mailbox-store.test.ts`: cover typed outbox append helper.
- Modify `tests/providers/claude-code-cli/stream-parser.test.ts` and `tests/providers/claude-code-cli/background.test.ts`: cover explicit outbox request parsing/snapshot surfacing.
- Modify `tests/core/lifecycle.test.ts`: cover awaiting-input transitions, idempotent outbox persistence, status exposure, and reply-to-running behavior.
- Modify `tests/mcp/tools.test.ts`: cover status returning outbox evidence and message clearing awaiting-input through lifecycle injection.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `appendOutboxRecord` writes serialized `outbox.jsonl` records with the same sequencing, hashing, and locking behavior as other mailbox kinds.
- Providers expose pending agent requests through a provider-neutral snapshot field.
- Claude adapter recognizes only explicit structured outbox request events, not heuristic free-form question detection.
- Lifecycle reconciliation appends each provider request to `outbox.jsonl` exactly once.
- A running sidecar transitions to `awaiting-input` when a pending outbox request is observed.
- `agent_team_status` includes latest pending outbox request evidence on the returned sidecar.
- `agent_team_message` records the reply in `inbox.jsonl`, live-delivers when possible, and moves `awaiting-input -> running` after the reply is recorded.
- Terminal, cancelling, and winding-down runs do not accept new normal replies.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, direct provider-to-provider messaging, or automatic workspace cleanup is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Durable Outbox Primitive

**Files:**
- Modify: `src/core/state/mailbox-store.ts`
- Modify: `tests/core/state/mailbox-store.test.ts`

- [x] **Step 1: Write failing outbox helper test**

Add a focused test proving `appendOutboxRecord` appends to `outbox.jsonl` with the supplied role, provider, message type, correlation id, content hash, and payload.

Run:

```bash
npm test -- tests/core/state/mailbox-store.test.ts
```

Expected: FAIL because the typed helper does not exist.

- [x] **Step 2: Implement helper**

Add `appendOutboxRecord` as the shared wrapper around `appendMailboxRecord(..., "outbox", ...)`.

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/state/mailbox-store.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/state/mailbox-store.ts tests/core/state/mailbox-store.test.ts
git commit -m "feat: add durable outbox mailbox helper"
```

## Task 2: Provider Snapshot Outbox Requests

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/providers/claude-code-cli/stream-parser.ts`
- Modify: `src/providers/claude-code-cli/background.ts`
- Modify: `tests/providers/claude-code-cli/stream-parser.test.ts`
- Modify: `tests/providers/claude-code-cli/background.test.ts`

- [x] **Step 1: Write failing provider parser tests**

Add tests proving:

- explicit `agent_team_outbox_request` stream events are retained in snapshot pending requests
- text that merely contains a question mark is ignored
- background session snapshots include pending outbox requests from the parser

Run:

```bash
npm test -- tests/providers/claude-code-cli/stream-parser.test.ts tests/providers/claude-code-cli/background.test.ts
```

Expected: FAIL because snapshots do not expose outbox requests.

- [x] **Step 2: Add provider-neutral request shape**

Add `ProviderOutboxRequest` with:

- `id`
- `messageType`
- `payload`
- optional `correlationId`
- optional `createdAt`

Expose `pendingOutboxRequests` from `ProviderSessionSnapshot`.

- [x] **Step 3: Implement explicit Claude parsing**

Update the Claude stream parser to accept only explicit structured events. Do not infer requests from prose. Keep malformed events as parser warnings instead of lifecycle requests.

- [x] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/stream-parser.test.ts tests/providers/claude-code-cli/background.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/providers/types.ts src/providers/claude-code-cli/stream-parser.ts src/providers/claude-code-cli/background.ts tests/providers/claude-code-cli/stream-parser.test.ts tests/providers/claude-code-cli/background.test.ts
git commit -m "feat: expose provider outbox requests"
```

## Task 3: Awaiting-Input Lifecycle Reconciliation

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing lifecycle tests**

Add tests proving:

- `getStatus` on an active run with a pending provider outbox request appends one `outbox.jsonl` record and transitions the run to `awaiting-input`
- repeated `getStatus` calls do not duplicate the same request
- returned status includes latest outbox request evidence
- `agent_team_message` on an `awaiting-input` run appends the reply and transitions back to `running`
- terminal/cancelling/winding-down runs still reject normal messages

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because lifecycle does not reconcile provider outbox requests.

- [x] **Step 2: Implement reconciliation**

Add lifecycle logic that:

- reads active handle snapshots in `getStatus` and `messageRun`
- persists unseen pending requests to `outbox.jsonl`
- stores bounded latest request evidence on the sidecar
- transitions `running -> awaiting-input` after request persistence
- transitions `awaiting-input -> running` after a valid message reply is recorded

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: reconcile outbox awaiting input"
```

## Task 4: MCP Surface And Verification

**Files:**
- Modify: `tests/mcp/tools.test.ts`
- Modify only implementation files if MCP coverage finds a boundary gap.

- [x] **Step 1: Add MCP surface tests**

Add tests proving the MCP status handler returns sidecar outbox evidence and the message handler can return the lifecycle result that resumes an `awaiting-input` run.

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS after lifecycle support, or FAIL if the tool result shape hides the evidence.

- [x] **Step 2: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/state/mailbox-store.test.ts tests/providers/claude-code-cli/stream-parser.test.ts tests/providers/claude-code-cli/background.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: PASS.

- [x] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

Expected: PASS.

- [x] **Step 4: Review no-heuristics boundary**

Run:

```bash
rg "question mark|\\?|heuristic|infer" src/providers/claude-code-cli src/core/lifecycle.ts
rg "agent_team_outbox_request|pendingOutboxRequests|awaiting-input" src tests
```

Expected: no free-form question detection or heuristic LLM behavior; explicit structured requests only.

- [x] **Step 5: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-13.md docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-14.md
git commit -m "docs: mark outbox awaiting-input milestone complete"
```
