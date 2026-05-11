# Agent Team MCP Milestone 20 Durable Timeout Expiry Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make durable `timeoutMs` requests enforce a real provider runtime budget and terminalize timed-out runs as `expired` with preserved state evidence.

**Architecture:** Keep timeout semantics provider-neutral in the runtime contract and lifecycle state machine. MCP already validates `timeoutMs`; M20 passes that budget through durable lifecycle start/reply calls into provider sessions, lets provider handles report `expired`, and maps that provider outcome to terminal sidecar state without treating it as a normal crash. The Claude adapter enforces the budget by terminating the spawned CLI process and resolving the session as expired, while preserving logs, transcripts, sidecars, mailboxes, verdicts, wind-down, cleanup, and subscription OAuth behavior.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, provider runtime contracts, Claude Code CLI background session runner, lifecycle state transitions.

---

## File Structure

- Modify `src/providers/types.ts`: add `expired` to `ProviderSessionDoneStatus` and add `timeoutMs` to provider start-session input.
- Modify `src/providers/claude-code-cli/background.ts`: enforce `timeoutMs` for spawned Claude background sessions and resolve timed-out handles as `expired`.
- Modify `src/core/lifecycle.ts`: pass durable `timeoutMs` through start and reply sessions, and map expired provider sessions to terminal `expired` sidecars.
- Modify `tests/providers/claude-code-cli/background.test.ts`: cover timeout-triggered process termination and expired session resolution.
- Modify `tests/core/lifecycle.test.ts`: cover start/reply timeout plumbing and expired terminal state.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `agent_team_start` `timeoutMs` reaches the provider start-session input.
- `agent_team_reply` `timeoutMs` reaches resumed provider start-session input.
- Claude background sessions with `timeoutMs` terminate the child process when the budget elapses.
- Timed-out Claude background handles resolve with provider done status `expired`.
- Lifecycle completion maps provider `expired` to run sidecar status `expired`, not `failed`.
- Expired runs preserve sidecar/log/transcript evidence and write an `expired` lifecycle event.
- Existing cancellation, wind-down, cleanup, mailbox, verdict, role policy, generated Claude agents, and state-corruption recovery behavior remains unchanged.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Provider Runtime Timeout Contract

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing lifecycle timeout plumbing tests**

Add tests proving:

- `AgentLifecycleManager.startRun({ timeoutMs })` passes `timeoutMs` into `startSession`
- `AgentLifecycleManager.replyRun({ timeoutMs })` passes `timeoutMs` into the resumed `startSession`

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because durable lifecycle calls currently drop `timeoutMs`.

- [x] **Step 2: Add provider start timeout contract**

Update `ProviderStartSessionInput` in `src/providers/types.ts` with:

```ts
readonly timeoutMs?: number;
```

Do not add provider-specific fields to MCP schemas or core role definitions.

- [x] **Step 3: Pass timeout through lifecycle starts**

In `src/core/lifecycle.ts`:

- pass `request.timeoutMs` into the initial provider start-session input when present
- pass `request.timeoutMs` into reply/resume provider start-session input when present
- preserve existing role id, execution policy, permission mode, session id, env, and worktree behavior

- [x] **Step 4: Run focused plumbing tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/providers/types.ts src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: pass durable timeout budgets"
```

## Task 2: Claude Background Timeout Enforcement

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/providers/claude-code-cli/background.ts`
- Modify: `tests/providers/claude-code-cli/background.test.ts`

- [x] **Step 1: Write failing Claude timeout tests**

Add tests proving:

- `startClaudeBackgroundSession({ timeoutMs: 1 })` terminates the spawned process when the budget elapses
- after timeout termination, `handle.done` resolves to `expired`
- normal child close before the timeout clears the budget and still resolves existing statuses

Run:

```bash
npm test -- tests/providers/claude-code-cli/background.test.ts
```

Expected: FAIL because Claude background sessions currently ignore `timeoutMs`.

- [x] **Step 2: Add expired provider status**

Update `ProviderSessionDoneStatus` in `src/providers/types.ts` to include:

```ts
| "expired"
```

- [x] **Step 3: Enforce Claude timeout**

In `src/providers/claude-code-cli/background.ts`:

- accept optional `timeoutMs` on `StartClaudeBackgroundSessionInput`
- schedule a timer only when `timeoutMs` is present
- on timeout, append a concise timeout line to the run log, terminate the spawned process, and mark the session as timed out
- when the child closes after timeout, resolve `handle.done` as `expired`
- clear the timeout on any child close or error
- preserve auth inspection, generated agents, role policy, resume, stream parsing, log rotation, stdin, cancellation, and no-bare behavior

- [x] **Step 4: Run focused Claude timeout tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/background.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/providers/types.ts src/providers/claude-code-cli/background.ts tests/providers/claude-code-cli/background.test.ts
git commit -m "feat: expire claude background timeouts"
```

## Task 3: Lifecycle Expired Terminal State

**Files:**
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing expired terminal tests**

Add a test proving:

- when an active provider handle resolves with `expired`, the durable sidecar transitions to status `expired`
- the expired sidecar keeps evidence paths from the provider snapshot
- an `expired` event is appended to `events.jsonl`
- the blocked verdict summary mentions expiration instead of a generic crash

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because lifecycle currently maps non-completed provider outcomes to `failed`.

- [x] **Step 2: Map provider expired to run expired**

In `completeRun`:

- branch on `status === "expired"` before generic failure handling
- write sidecar status `expired`
- set `cleanup: "partial"`
- include snapshot log/transcript evidence
- set a blocked verdict summary such as `Provider session expired after timeout.`
- append an `expired` event with the provider status

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
git commit -m "feat: terminalize expired sessions"
```

## Task 4: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts tests/providers/claude-code-cli/background.test.ts tests/mcp/tools.test.ts
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
rg "timeoutMs|expired" src tests docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-20.md
rg "allowApiKeyFallback|benchmark|embedding|mock LLM|bypassPermissions" src/core src/providers tests/core tests/providers
```

Expected: timeout and expiry stay in provider-neutral contracts plus provider adapter enforcement. Existing fail-closed auth and bypass-permission guards remain unchanged; no benchmark, embedding, mock LLM, API fallback, or provider-specific MCP schema is introduced.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-20.md
git commit -m "docs: mark durable timeout milestone complete"
```
