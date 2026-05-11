# Agent Team MCP Milestone 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe background read-only session lifecycle control for Claude Code CLI subscription-backed agents, with provider-neutral session handles, guarded sidecars, serialized mailboxes, status, cancel, wind-down, and cleanup.

**Architecture:** Keep synchronous `agent_team_dispatch` on the completed JSON path. Add a separate provider-neutral background lifecycle path modeled after Clawd's proven session-handle shape: spawn a stream-json provider session, track an active handle, persist bounded activity/status diagnostics, and guard all run transitions. MCP tools remain thin delegates; mailbox/control ordering and state transitions become shared infrastructure before live messaging is exposed.

**Tech Stack:** TypeScript, Node.js ESM, `child_process.spawn`, `readline`, existing MCP SDK, Vitest.

---

## Clawd Mining Constraints

- Background sessions need a real handle: `done`, `kill`, `forceKill`, activity rings, stderr rings, optional stdin, and transcript/log paths.
- Stream-json background runs are separate from synchronous JSON dispatch.
- Mailboxes/control writes must be serialized before cancellation, wind-down, or future messages depend on sequence order.
- Run status writes must be transition-aware so late async updates cannot resurrect terminal runs.
- Tool handlers should validate arguments and delegate to shared lifecycle logic.
- `agent_team_message` and `agent_team_reply` remain deferred until provider resume/live-input semantics are proven.

See `docs/research/2026-05-11-the-clawd-code-agent-team-mining.md` for the mining notes and source line references.

## File Structure

- Modify `src/core/types.ts`: add session activity, lifecycle result, provider session handle, and transition-related types.
- Modify `src/core/state/mailbox-store.ts`: add lock-protected append helpers and typed control/event append wrappers.
- Modify `src/core/state/run-store.ts`: add terminal-status detection and guarded transition helpers.
- Create `src/providers/types.ts`: define provider-neutral background lifecycle interfaces.
- Create `src/providers/claude-code-cli/stream-parser.ts`: parse Claude stream-json/NDJSON events into text, activities, errors, and session ids.
- Create `src/providers/claude-code-cli/background.ts`: spawn Claude Code CLI in read-only stream-json mode and return a `ProviderSessionHandle`.
- Create `src/core/lifecycle.ts`: active background run registry, start/status/cancel/wind-down orchestration, sidecar/mailbox updates, and cleanup.
- Modify `src/mcp/tools.ts`: wire `agent_team_start`, lifecycle-aware `agent_team_status`, `agent_team_cancel`, and `agent_team_wind_down`.
- Add tests under `tests/core`, `tests/core/state`, `tests/providers/claude-code-cli`, and `tests/mcp`.

## Success Criteria

- `agent_team_start` starts a read-only background session and returns immediately with `runId`, `status: running`, sidecar path, mailbox paths, and transcript/log paths.
- Background Claude runs use `child_process.spawn`, `--input-format stream-json`, `--output-format stream-json`, `--verbose`, and subscription OAuth auth precedence. They do not use API-key fallback unless explicitly configured.
- `agent_team_status` reconciles persisted sidecar state with active session handles and includes bounded recent activities, current activity, stderr diagnostics, and stale-running warnings when applicable.
- Restart behavior is explicit: if a persisted sidecar says `running`, `starting`, `cancelling`, or `winding-down` but the active handle map has no handle, status returns a detached/orphaned warning and cancellation reports that no active process is attached.
- `agent_team_cancel` records a serialized control event, soft-kills the active session, force-kills after a grace period if needed, writes terminal `cancelled`, and records cleanup status.
- `agent_team_wind_down` records a serialized control event and marks active runs `winding-down`. It sends a provider input event only when the handle supports stdin; otherwise it reports that wind-down is recorded and the session will finish or can be cancelled.
- Terminal runs are never overwritten by stale non-terminal writes.
- Mailbox/control sequences are monotonic under concurrent appends in the MCP process and are file-lock-safe across future process boundaries.
- `agent_team_message` and `agent_team_reply` remain stable `not_implemented` envelopes.
- CI tests use injected spawn/process handles and do not require live Claude auth.
- `npm run typecheck`, `npm test`, and `npm run build` pass before integration.

## Task 1: Serialized Mailbox Appends

**Files:**
- Modify: `src/core/state/mailbox-store.ts`
- Test: `tests/core/state/mailbox-store.test.ts`

- [ ] **Step 1: Write failing tests**

Extend mailbox tests to prove:

- `appendControlRecord` writes to `control.jsonl`
- `appendEventRecord` writes to `events.jsonl`
- concurrent appends preserve unique monotonic sequences
- a record is re-read and sequenced while holding the append lock

Run: `npm test -- tests/core/state/mailbox-store.test.ts`

Expected: FAIL because locked append/control/event helpers do not exist.

- [ ] **Step 2: Implement locked append helpers**

Implement a small file-lock helper inside `mailbox-store.ts` using an atomic lock directory next to the mailbox file, retrying with short backoff. Keep it dependency-free. `appendMailboxRecord` should acquire the lock, re-read records, assign `sequence`, append JSONL, and release the lock in `finally`.

Add:

```ts
export async function appendControlRecord(
  workspaceRoot: string,
  runId: string,
  input: AppendMailboxInput
): Promise<MailboxRecord>;

export async function appendEventRecord(
  workspaceRoot: string,
  runId: string,
  input: AppendMailboxInput
): Promise<MailboxRecord>;
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/core/state/mailbox-store.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/state/mailbox-store.ts tests/core/state/mailbox-store.test.ts
git commit -m "feat: serialize mailbox appends"
```

## Task 2: Guarded Run Transitions

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/state/run-store.ts`
- Test: `tests/core/state/run-store.test.ts`

- [ ] **Step 1: Write failing tests**

Extend run-store tests to prove:

- `isTerminalRunStatus` returns true for `completed`, `cancelled`, `failed`, and `expired`
- legal transitions such as `queued -> running -> completed` are written
- terminal states reject stale transitions such as `cancelled -> running` and `completed -> failed`
- guarded transition helpers preserve existing terminal sidecars unchanged

Run: `npm test -- tests/core/state/run-store.test.ts`

Expected: FAIL because guarded transition helpers do not exist.

- [ ] **Step 2: Implement transition helpers**

Add:

```ts
export function isTerminalRunStatus(status: RunStatus): boolean;

export class InvalidRunTransitionError extends Error {
  readonly currentStatus: RunStatus;
  readonly nextStatus: RunStatus;
}

export async function transitionRunSidecar(
  workspaceRoot: string,
  runId: string,
  update: (current: RunSidecar) => RunSidecar
): Promise<RunSidecar>;
```

The helper reads the latest sidecar, applies the update, validates terminal safety, writes atomically only when legal, and returns the final sidecar.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/core/state/run-store.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/state/run-store.ts tests/core/state/run-store.test.ts
git commit -m "feat: guard run sidecar transitions"
```

## Task 3: Provider Session Interfaces And Stream Parser

**Files:**
- Create: `src/providers/types.ts`
- Create: `src/providers/claude-code-cli/stream-parser.ts`
- Test: `tests/providers/claude-code-cli/stream-parser.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests proving:

- stream parser extracts assistant text/result chunks into accumulated output
- stream parser extracts session ids when present
- tool-use style events become bounded `SessionActivity` records
- invalid NDJSON lines become parse warnings without crashing the session

Run: `npm test -- tests/providers/claude-code-cli/stream-parser.test.ts`

Expected: FAIL because stream parser and provider session types do not exist.

- [ ] **Step 2: Implement provider-neutral interfaces and parser**

Add provider lifecycle interfaces:

```ts
export interface ProviderSessionActivity {
  readonly type: "tool_start" | "text" | "result" | "error";
  readonly summary: string;
  readonly timestamp: number;
}

export type ProviderSessionDoneStatus = "completed" | "failed" | "interrupted";

export interface ProviderSessionHandle {
  readonly providerSessionId?: string;
  readonly done: Promise<ProviderSessionDoneStatus>;
  readonly recentActivities: readonly ProviderSessionActivity[];
  readonly currentActivity: ProviderSessionActivity | null;
  readonly lastStderr: readonly string[];
  readonly transcriptPath?: string;
  readonly logPath?: string;
  kill(): void;
  forceKill(): void;
  writeStdin?(data: string): void;
}
```

Implement a small parser that accepts one NDJSON line at a time and returns extracted text/activity/session diagnostics. Keep event matching conservative and lossless: unknown JSON remains in transcripts but does not invent model-quality claims.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/providers/claude-code-cli/stream-parser.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/types.ts src/providers/claude-code-cli/stream-parser.ts tests/providers/claude-code-cli/stream-parser.test.ts
git commit -m "feat: add provider session stream parser"
```

## Task 4: Claude Background Session Runner

**Files:**
- Create: `src/providers/claude-code-cli/background.ts`
- Modify: `src/providers/claude-code-cli/types.ts`
- Test: `tests/providers/claude-code-cli/background.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests proving:

- background runner calls `claude` with read-only stream-json args
- stdout NDJSON is written to transcript/log paths and parsed into output/activity state
- stderr is captured in a bounded ring
- `kill` sends soft termination and `forceKill` sends hard termination
- child close with code `0` resolves `completed`, signal termination resolves `interrupted`, and non-zero close resolves `failed`
- auth-precedence diagnostics still block API-key env vars in subscription mode

Run: `npm test -- tests/providers/claude-code-cli/background.test.ts`

Expected: FAIL because background runner does not exist.

- [ ] **Step 2: Implement spawn-based runner**

Implement `startClaudeBackgroundSession(input, deps)` using injectable `spawn`. It must:

- build a read-only prompt using existing prompt helpers
- spawn with `stdio: ["pipe", "pipe", "pipe"]`
- use `--input-format stream-json` and `--output-format stream-json`
- never pass `--bare`, `acceptEdits`, or bypass permissions
- write full transcript/log files under existing `.agent-team` paths
- maintain recent activity and stderr rings
- return `ProviderSessionHandle`

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/providers/claude-code-cli/background.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/background.ts src/providers/claude-code-cli/types.ts tests/providers/claude-code-cli/background.test.ts
git commit -m "feat: add Claude background session runner"
```

## Task 5: Lifecycle Manager

**Files:**
- Create: `src/core/lifecycle.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Create tests proving:

- `startRun` validates read-only role/provider, writes initial sidecar, appends start event, starts provider handle, and returns immediately
- successful handle completion parses final output/verdict and transitions to `completed`
- failed handle completion transitions to `failed` with diagnostics
- `getStatus` merges active-handle activity/stderr with persisted sidecar
- `getStatus` reports stale-running when persisted state says running but no active handle exists
- `cancelRun` on a detached/orphaned run records intent but reports that no active process handle is attached
- `cancelRun` appends `cancel_requested`, transitions through `cancelling`, calls `kill`, calls `forceKill` after grace when needed, and ends at `cancelled`
- `windDownRun` appends `wind_down_requested`, transitions to `winding-down`, and writes stdin only when supported
- terminal controls return current terminal status without mutation

Run: `npm test -- tests/core/lifecycle.test.ts`

Expected: FAIL because lifecycle manager does not exist.

- [ ] **Step 2: Implement lifecycle manager**

Add:

```ts
export class AgentLifecycleManager {
  startRun(request: AgentDispatchRequest): Promise<AgentStartResult>;
  getStatus(workspaceRoot: string, runId: string): Promise<RunSidecar>;
  cancelRun(workspaceRoot: string, runId: string): Promise<AgentControlResult>;
  windDownRun(workspaceRoot: string, runId: string): Promise<AgentControlResult>;
}

export const defaultLifecycleManager = new AgentLifecycleManager();
```

The manager owns only in-process active handles and persisted run transitions. It does not expose live message/reply. Completion callbacks must re-read sidecars through guarded transition helpers before writing terminal states.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/core/lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts src/core/types.ts tests/core/lifecycle.test.ts
git commit -m "feat: add background lifecycle manager"
```

## Task 6: MCP Lifecycle Wiring

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Extend MCP tests to prove:

- `agent_team_start` validates args and delegates to lifecycle manager
- `agent_team_status` uses lifecycle status when available
- `agent_team_cancel` validates `runId` and delegates to lifecycle manager
- `agent_team_wind_down` validates `runId` and delegates to lifecycle manager
- `agent_team_message` and `agent_team_reply` remain `not_implemented`

Run: `npm test -- tests/mcp/tools.test.ts`

Expected: FAIL until lifecycle tools are wired.

- [ ] **Step 2: Implement tool wiring**

Extend tool dependencies with an injectable lifecycle manager. Keep `agent_team_dispatch` on synchronous dispatch. Keep lifecycle tool payloads structured, provider-neutral, and explicit about deferred live messaging.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/mcp/tools.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: wire lifecycle MCP tools"
```

## Task 7: Verification And Integration

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/core/state/mailbox-store.test.ts tests/core/state/run-store.test.ts tests/providers/claude-code-cli/stream-parser.test.ts tests/providers/claude-code-cli/background.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Review diff and commit verification fixes if needed**

Run:

```bash
git status --short
git diff --stat
```

Expected: only planned files changed.

- [ ] **Step 4: Ask for integration choice**

After verification passes, present merge/push options. Do not merge into `main` until verification is green.
