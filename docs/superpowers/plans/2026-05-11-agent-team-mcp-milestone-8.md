# Agent Team MCP Milestone 8 In-Flight Control Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `agent_team_message` and `agent_team_wind_down` honest first-class live-control surfaces while preserving durable mailbox fallback and retained implementation evidence.

**Architecture:** Keep Codex as the communication hub. `agent_team_message` will always append a serialized inbox record first, then deliver that record to an attached provider stdin only when the active provider handle explicitly supports stdin; otherwise it reports that the message is recorded for resume. `agent_team_wind_down` will close normal input for the run, send a provider-neutral final-summary request when possible, record event evidence, wait only for a bounded grace window, and leave terminal verdict/evidence harvesting to the existing completion observer when the provider settles.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing lifecycle/mailbox/run-store modules, Claude Code CLI stream-json background handle.

---

## File Structure

- Modify `src/providers/types.ts`: add explicit stdin support metadata to provider session handles.
- Modify `src/providers/claude-code-cli/background.ts`: report stdin support and return live-control write success.
- Modify `src/core/types.ts`: extend message result status and sidecar wind-down/input fields.
- Modify `src/core/lifecycle.ts`: deliver live messages when supported, reject new normal input during wind-down/cancellation, add bounded wind-down wait, and record delivery events.
- Modify `tests/providers/claude-code-cli/background.test.ts`: cover stdin support metadata and write behavior.
- Modify `tests/core/lifecycle.test.ts`: cover live message delivery, fallback recording, input closure after wind-down, and wind-down grace behavior.
- Modify `tests/mcp/tools.test.ts`: cover the expanded message result shape without changing tool names.

## Success Criteria

- `agent_team_message` appends to inbox before any live delivery attempt.
- Active runs with stdin-capable handles receive a structured JSONL message referencing the persisted mailbox record.
- The message result reports `delivered_live` only when provider stdin delivery was attempted successfully.
- Active runs without stdin-capable handles return `recorded_for_resume` and do not claim live delivery.
- Completed runs still support mailbox recording for future `agent_team_reply`.
- Runs in `winding-down`, `cancelling`, `cancelled`, `failed`, or `expired` reject normal `agent_team_message` input.
- `agent_team_wind_down` appends control, transitions to `winding-down`, marks normal input closed, and writes a final-summary request to stdin when supported.
- `agent_team_wind_down` waits only up to a configurable grace window and returns the terminal sidecar status if the provider settles inside that window.
- If wind-down times out, status remains `winding-down` with a durable warning/event; no process is hard-killed.
- Existing completion/failure/cancellation harvesting for implementation worktrees remains intact.
- No API-key fallback, model-quality heuristic, benchmark mock, new provider, or automatic worktree deletion is introduced.
- `npm run typecheck`, `npm test`, and `npm run build` pass before merge.

## Task 1: Provider Handle Live-Input Contract

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/providers/claude-code-cli/background.ts`
- Test: `tests/providers/claude-code-cli/background.test.ts`

- [x] **Step 1: Write failing provider handle tests**

Add tests proving:

- Claude background handles expose `supportsStdin: true` when child stdin exists.
- `writeStdin` returns `true` and writes the payload when stdin is writable.
- `writeStdin` returns `false` when stdin is unavailable or destroyed.

Run:

```bash
npm test -- tests/providers/claude-code-cli/background.test.ts
```

Expected: FAIL because `supportsStdin` is not in the provider handle contract and `writeStdin` currently returns void.

- [x] **Step 2: Implement handle contract**

Update `ProviderSessionHandle`:

```ts
readonly supportsStdin: boolean;
writeStdin?(data: string): boolean;
```

In Claude background sessions:

- `supportsStdin` is `child.stdin !== null`.
- `writeStdin` returns `false` if stdin is missing or destroyed.
- otherwise write the payload and return the boolean from `child.stdin.write(data)`.

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/background.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/providers/types.ts src/providers/claude-code-cli/background.ts tests/providers/claude-code-cli/background.test.ts
git commit -m "feat: expose provider stdin support"
```

## Task 2: Live Message Delivery With Durable Fallback

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/lifecycle.ts`
- Test: `tests/core/lifecycle.test.ts`
- Test: `tests/mcp/tools.test.ts`

- [x] **Step 1: Write failing live message tests**

Add tests proving:

- active stdin-capable runs append inbox and write a JSONL payload containing `agent_team_message`, `runId`, `sequence`, `messageType`, and the message payload.
- live-delivered messages append an `events.jsonl` record with `messageType: "message_delivered_live"`.
- active runs without stdin support still append inbox but return `recorded_for_resume`.
- completed runs still append inbox and return `recorded_for_resume`.

Run:

```bash
npm test -- tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: FAIL because `messageRun` only records for resume.

- [x] **Step 2: Implement live delivery**

Extend `AgentMessageResult.status` to:

```ts
"recorded_for_resume" | "delivered_live"
```

In `messageRun`:

- read sidecar
- reject blocked statuses using the message from Task 3
- append inbox record
- if active handle exists and `supportsStdin === true` and `writeStdin` returns true:
  - write one JSONL line:
    ```json
    {"type":"agent_team_message","runId":"...","record":{...}}
    ```
  - append an event `message_delivered_live`
  - return `delivered_live`
- otherwise return `recorded_for_resume`

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/lifecycle.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
git commit -m "feat: deliver live messages when supported"
```

## Task 3: Wind-Down Input Closure And Grace Window

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/lifecycle.ts`
- Test: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing wind-down tests**

Add tests proving:

- `windDownRun` sets sidecar fields `inputClosed: true` and `windDownRequestedAt`.
- after wind-down, `messageRun` rejects normal messages and does not append inbox.
- wind-down writes a JSONL final-summary request when stdin is supported.
- if provider completion settles inside `windDownGraceMs`, `windDownRun` returns terminal `completed`.
- if the grace window expires first, run remains `winding-down`, an event `wind_down_grace_elapsed` is recorded, and the process is not killed.

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because sidecars do not close input and wind-down does not wait.

- [x] **Step 2: Implement wind-down semantics**

Extend `RunSidecar`:

```ts
readonly inputClosed?: boolean;
readonly windDownRequestedAt?: string;
```

Extend lifecycle dependencies:

```ts
readonly windDownGraceMs?: number;
```

In `windDownRun`:

- append `wind_down_requested`
- transition to `winding-down` with `inputClosed: true`, `windDownRequestedAt`, and a warning if no active handle is attached
- when stdin is supported, write:
  ```json
  {"type":"agent_team_wind_down","runId":"...","instruction":"Summarize current state and emit a final verdict if possible."}
  ```
- wait for `Promise.race([active.handle.done, sleep(windDownGraceMs)])`
- if terminal sidecar exists after provider settlement, return it
- otherwise append `wind_down_grace_elapsed` and return `winding-down`
- never hard-kill from wind-down

In `messageRun`, reject when `inputClosed === true` or status is `winding-down`, `cancelling`, `cancelled`, `failed`, or `expired`.

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
git commit -m "feat: close input during wind-down"
```

## Task 4: Verification And Integration

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused Milestone 8 tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/background.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: PASS.

- [x] **Step 3: Review diff**

Run:

```bash
git status --short
git diff --stat main..HEAD
```

Expected: only planned files changed.

- [x] **Step 4: Merge and push**

Fast-forward merge the verified worktree branch into `main`, push, and remove the temporary implementation worktree.

## Completed Implementation Evidence

- Planned on `main` in `221ed52`.
- Implemented in isolated worktree `.worktrees/milestone-8-inflight-control` on branch `codex/milestone-8-inflight-control`.
- Implementation commits:
  - `fe4b56c feat: expose provider stdin support`
  - `7fdc48c feat: deliver live messages when supported`
  - `1945b19 feat: close input during wind-down`
  - `930d3cb fix: handle wind-down completion race`
- Focused verification:
  - `npm test -- tests/providers/claude-code-cli/background.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts`
  - Result: 3 test files passed, 55 tests passed.
- Full verification:
  - `npm run typecheck && npm test && npm run build`
  - Result: typecheck passed, 21 test files passed, 127 tests passed, build passed.
