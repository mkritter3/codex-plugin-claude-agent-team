# Agent Team MCP Milestone 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make durable continuation real by implementing `agent_team_message` and `agent_team_reply` as mailbox-backed, provider-neutral resume flows that use Claude Code CLI subscription OAuth and `--resume` without reopening terminal sidecars or keeping Claude processes alive indefinitely.

**Architecture:** First harden the Milestone 3 lifecycle surfaces that continuation depends on: default status must use lifecycle reconciliation, provider start failure must write a terminal sidecar, and transition rules must reject stale non-terminal regressions. Then keep each provider execution as an immutable run sidecar. `agent_team_message` records Codex-to-agent messages in `inbox.jsonl` and never pretends live delivery happened. `agent_team_reply` reads the parent sidecar, requires a persisted provider session id, builds a read-only resume prompt from the recorded message context, and starts a new child run linked to the parent using the provider session id. The lifecycle manager owns the orchestration; the Claude adapter receives an optional `sessionId`, translates it to `claude --resume`, and uses cache-friendly CLI flags where safe.

**Tech Stack:** TypeScript, Node.js ESM, existing lifecycle/mailbox/run stores, existing Claude background runner, Vitest.

---

## File Structure

- Modify `src/core/types.ts`: add mailbox-backed message/reply request and result types; add sidecar lineage fields.
- Modify `src/core/state/mailbox-store.ts`: add `appendInboxRecord` and optional record filtering helpers.
- Modify `src/core/state/run-store.ts`: add explicit legal transition validation for non-terminal stale writes.
- Modify `src/core/prompts.ts`: add `buildReplyPrompt` for resumed read-only turns with verdict protocol preserved.
- Modify `src/core/lifecycle.ts`: add `messageRun` and `replyRun`; make provider start accept `sessionId`; keep parent sidecars immutable.
- Modify `src/providers/claude-code-cli/background.ts`: ensure `sessionId` is passed to command construction for background resumes.
- Modify `src/mcp/tools.ts`: wire `agent_team_message` and `agent_team_reply`.
- Add or extend tests under `tests/core`, `tests/core/state`, `tests/providers/claude-code-cli`, and `tests/mcp`.

## Success Criteria

- `agent_team_message` validates `runId`, `message`, and optional `cwd`, appends to `inbox.jsonl`, returns the persisted mailbox record, and reports delivery as `recorded_for_resume`.
- `agent_team_message` does not write to provider stdin or claim live delivery in this milestone.
- Production `agent_team_status` always uses lifecycle `getStatus`, so active handle activity and detached/orphan warnings are visible without test-only dependency injection.
- If provider start throws, `agent_team_start` writes a terminal `failed` sidecar, appends a failed event, and returns/throws a clear lifecycle error instead of leaving a fake-running run.
- Run sidecar transition validation rejects stale non-terminal regressions such as `winding-down -> running` and `cancelling -> running`.
- `agent_team_reply` validates `runId`, optional `message`, and optional `cwd`.
- `agent_team_reply` reads the parent sidecar and fails closed if `providerSessionId` is missing.
- `agent_team_reply` appends any supplied message to the parent run inbox before starting the resumed child run.
- `agent_team_reply` starts a new run id linked to the parent through sidecar lineage fields such as `parentRunId` and `resumedFromRunId`.
- The parent sidecar remains terminal if it was terminal; reply never transitions `completed`, `failed`, `cancelled`, or `expired` back to `running`.
- The child run uses the parent provider session id and the Claude background runner passes it as `--resume <session_id>`.
- The Claude background runner uses cache-friendly non-interactive flags where safe, including `--exclude-dynamic-system-prompt-sections`, while preserving the default Claude Code context and avoiding `--bare`.
- Milestone 4 does not keep long-lived Claude child processes alive solely for token/cache behavior; conversation continuity comes from persisted session ids and resume.
- Resumed runs preserve read-only role constraints, verdict parsing, sidecars, events, status, wind-down, cancellation, logs, and cleanup behavior.
- `agent_team_reply` and `agent_team_message` use injected lifecycle dependencies in tests; no live Claude auth is required.
- `npm run typecheck`, `npm test`, and `npm run build` pass before merge.

## Task 1: Lifecycle Hardening Before Continuation

**Files:**
- Modify: `src/core/state/run-store.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `src/mcp/tools.ts`
- Test: `tests/core/state/run-store.test.ts`
- Test: `tests/core/lifecycle.test.ts`
- Test: `tests/mcp/tools.test.ts`

- [x] **Step 1: Write failing tests**

Extend tests to prove:

- default `agent_team_status` uses lifecycle status instead of raw sidecar reads
- `startRun` writes `failed` and a failed event if provider start throws after the initial sidecar is written
- non-terminal stale transitions like `winding-down -> running` and `cancelling -> running` throw `InvalidRunTransitionError`

Run:

```bash
npm test -- tests/core/state/run-store.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: FAIL because default status bypasses lifecycle, start failure leaves `running`, and non-terminal transitions are not fully guarded.

- [x] **Step 2: Implement hardening**

Implement:

- `agent_team_status` always delegates to `lifecycle.getStatus`
- `startRun` catches provider start failure, transitions the just-created sidecar to `failed`, appends a `failed` event, and rethrows a typed/clear error
- run-store transition validation with explicit allowed transitions:

```ts
const ALLOWED_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["starting", "running", "failed", "expired"],
  starting: ["running", "failed", "expired"],
  running: ["awaiting-input", "winding-down", "cancelling", "completed", "failed", "expired"],
  "awaiting-input": ["running", "winding-down", "cancelling", "failed", "expired"],
  "winding-down": ["completed", "failed", "cancelling", "cancelled"],
  cancelling: ["cancelled", "failed"],
  completed: ["completed"],
  cancelled: ["cancelled"],
  failed: ["failed"],
  expired: ["expired"]
};
```

- [x] **Step 3: Run tests**

Run:

```bash
npm test -- tests/core/state/run-store.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/state/run-store.ts src/core/lifecycle.ts src/mcp/tools.ts tests/core/state/run-store.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
git commit -m "fix: harden lifecycle status and transitions"
```

## Task 2: Message And Reply Types Plus Inbox Helper

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/state/mailbox-store.ts`
- Test: `tests/core/state/mailbox-store.test.ts`

- [x] **Step 1: Write failing tests**

Extend mailbox-store tests to prove:

- `appendInboxRecord` writes to `inbox.jsonl`
- the returned record includes the supplied `messageType`, `correlationId`, and payload
- inbox sequence numbers remain monotonic alongside the existing locked append path

Run: `npm test -- tests/core/state/mailbox-store.test.ts`

Expected: FAIL because `appendInboxRecord` does not exist.

- [x] **Step 2: Implement types and helper**

Add types:

```ts
export interface AgentMessageRequest {
  readonly runId: string;
  readonly cwd: string;
  readonly message: string;
  readonly messageType?: string;
  readonly correlationId?: string;
}

export interface AgentMessageResult {
  readonly runId: string;
  readonly status: "recorded_for_resume";
  readonly record: MailboxRecord;
  readonly message: string;
}

export interface AgentReplyRequest extends AgentMessageRequest {
  readonly provider?: string;
  readonly timeoutMs?: number;
}

export interface AgentReplyResult extends AgentStartResult {
  readonly parentRunId: string;
  readonly resumedFromRunId: string;
  readonly providerSessionId: string;
}
```

Extend `RunSidecar`:

```ts
readonly parentRunId?: string;
readonly resumedFromRunId?: string;
readonly resumeSequence?: number;
```

Add:

```ts
export async function appendInboxRecord(
  workspaceRoot: string,
  runId: string,
  input: AppendMailboxInput
): Promise<MailboxRecord>;
```

- [x] **Step 3: Run tests**

Run: `npm test -- tests/core/state/mailbox-store.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/state/mailbox-store.ts tests/core/state/mailbox-store.test.ts
git commit -m "feat: add inbox message primitives"
```

## Task 3: Resume Prompt Builder

**Files:**
- Modify: `src/core/prompts.ts`
- Test: `tests/core/prompts.test.ts`

- [x] **Step 1: Write failing tests**

Extend prompt tests to prove:

- `buildReplyPrompt` includes role identity, workspace, parent run id, provider session id, and the new message
- read-only constraints remain present
- the exact `<<<VERDICT>>>` protocol remains present
- the prompt names this as a resumed continuation without claiming live message delivery

Run: `npm test -- tests/core/prompts.test.ts`

Expected: FAIL because `buildReplyPrompt` does not exist.

- [x] **Step 2: Implement prompt builder**

Add:

```ts
export interface BuildReplyPromptInput {
  readonly role: AgentRole;
  readonly cwd: string;
  readonly parentRunId: string;
  readonly providerSessionId: string;
  readonly message: string;
}

export function buildReplyPrompt(input: BuildReplyPromptInput): string;
```

Use the same read-only rules and verdict protocol shape as `buildRolePrompt`; do not duplicate the verdict text by hand if a small shared helper keeps the prompt safer.

- [x] **Step 3: Run tests**

Run: `npm test -- tests/core/prompts.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/prompts.ts tests/core/prompts.test.ts
git commit -m "feat: add resumed reply prompt"
```

## Task 4: Claude Resume Transport Contract

**Files:**
- Modify: `src/core/lifecycle.ts`
- Modify: `src/providers/claude-code-cli/background.ts`
- Test: `tests/providers/claude-code-cli/background.test.ts`

- [x] **Step 1: Write failing tests**

Extend background runner tests to prove:

- `startClaudeBackgroundSession` with `sessionId: "session_abc"` passes `--resume session_abc`
- background runner passes `--exclude-dynamic-system-prompt-sections`
- the command still uses `--input-format stream-json`, `--output-format stream-json`, `--permission-mode default`, and no `--bare`

Run: `npm test -- tests/providers/claude-code-cli/background.test.ts`

Expected: PASS if the runner already supports this, or FAIL if the lifecycle-facing type is missing.

- [x] **Step 2: Extend provider start type**

Extend the lifecycle `StartProviderSession` input with:

```ts
readonly sessionId?: string;
```

Ensure `startClaudeBackgroundSession` already forwards that optional value to `buildClaudeCommand`. Add a command option for `excludeDynamicSystemPromptSections?: boolean` and enable it for background Claude sessions. Do not enable `--bare`.

- [x] **Step 3: Run tests**

Run: `npm test -- tests/providers/claude-code-cli/background.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts src/providers/claude-code-cli/background.ts tests/providers/claude-code-cli/background.test.ts
git commit -m "feat: support background resume sessions"
```

## Task 5: Lifecycle Message And Reply

**Files:**
- Modify: `src/core/lifecycle.ts`
- Test: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing lifecycle tests**

Extend lifecycle tests to prove:

- `messageRun` appends an inbox record and returns `recorded_for_resume`
- `messageRun` does not mutate the run sidecar status
- `replyRun` rejects a parent sidecar with no `providerSessionId`
- `replyRun` appends an optional message before starting the child run
- `replyRun` creates a new child run with `parentRunId`, `resumedFromRunId`, `providerSessionId`, and `status: running`
- `replyRun` passes the parent `providerSessionId` to the injected provider session starter
- parent terminal sidecar status is unchanged after reply
- child completion follows the existing verdict/cleanup path

Run: `npm test -- tests/core/lifecycle.test.ts`

Expected: FAIL because `messageRun` and `replyRun` do not exist.

- [x] **Step 2: Implement lifecycle methods**

Add to `AgentLifecycleManager`:

```ts
messageRun(request: AgentMessageRequest): Promise<AgentMessageResult>;
replyRun(request: AgentReplyRequest): Promise<AgentReplyResult>;
```

Rules:

- Read parent sidecar before writing.
- Use `appendInboxRecord` for messages.
- Require `providerSessionId` for reply.
- Use parent role/provider unless a requested provider is supplied and passes capability routing.
- Build prompt through `buildReplyPrompt`.
- Write a new child run sidecar and event records.
- Start provider with `sessionId: parent.providerSessionId`.
- Register the child run in the active handle map.
- Reuse existing completion observation for the child run.

- [x] **Step 3: Run tests**

Run: `npm test -- tests/core/lifecycle.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: add mailbox-backed reply lifecycle"
```

## Task 5: MCP Message And Reply Wiring

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

- [x] **Step 1: Write failing MCP tests**

Extend MCP tests to prove:

- `agent_team_message` validates `runId` and `message`, then delegates to injected lifecycle `messageRun`
- `agent_team_reply` validates `runId` and optional `message`, then delegates to injected lifecycle `replyRun`
- `agent_team_reply` returns child `runId`, parent lineage, and provider session id
- `agent_team_message` and `agent_team_reply` no longer return `not_implemented`

Run: `npm test -- tests/mcp/tools.test.ts`

Expected: FAIL until the tools are wired.

- [x] **Step 2: Implement tool wiring**

Extend `ToolDependencies.lifecycle` with:

```ts
readonly messageRun: (request: AgentMessageRequest) => Promise<AgentMessageResult>;
readonly replyRun: (request: AgentReplyRequest) => Promise<AgentReplyResult>;
```

Add argument validation. `agent_team_message` requires non-empty `message`; `agent_team_reply` may omit `message` only if the parent inbox already has recorded messages.

- [x] **Step 3: Run tests**

Run: `npm test -- tests/mcp/tools.test.ts`

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: wire message and reply MCP tools"
```

## Task 6: Verification And Integration

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/core/state/mailbox-store.test.ts tests/core/prompts.test.ts tests/providers/claude-code-cli/background.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
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

- Planned on `main` in commit `be586bf docs: plan durable reply milestone`.
- Implemented in isolated worktree `.worktrees/milestone-4-durable-reply` on branch `codex/milestone-4-durable-reply`.
- Focused verification passed: `npm test -- tests/core/state/run-store.test.ts tests/core/state/mailbox-store.test.ts tests/core/prompts.test.ts tests/providers/claude-code-cli/background.test.ts tests/providers/claude-code-cli/commands.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts` (7 files, 43 tests).
- Full verification passed: `npm run typecheck`, `npm test` (17 files, 70 tests), and `npm run build`.
