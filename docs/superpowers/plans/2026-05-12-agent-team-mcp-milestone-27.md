# Agent Team MCP Milestone 27 Batch Message Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agent_team_message_many` so Codex can send in-flight updates or evidence to multiple durable agent runs in one bounded MCP call.

**Architecture:** `agent_team_message_many` is a message-family MCP tool over the existing lifecycle manager, not a resume, control, or cleanup shortcut. Each child message delegates to the normal `AgentLifecycleManager.messageRun` path, preserving inbox durability, live-delivery fallback, lifecycle input-closure checks, and state-corruption recovery. The batch helper stays provider-neutral and returns ordered per-message results with partial-failure evidence.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP Zod schemas, provider-neutral lifecycle manager, durable JSONL mailboxes, state recovery.

---

## File Structure

- Modify `src/core/types.ts`: add batch-message request/result types.
- Add `src/core/message-many.ts`: bounded provider-neutral batch-message helper.
- Modify `src/mcp/tools.ts`: add parsing and handling for `agent_team_message_many`.
- Modify `src/mcp/schemas.ts`: expose the `agent_team_message_many` input schema.
- Add `tests/core/message-many.test.ts`: prove bounded concurrency, ordering, partial failures, and state-corruption recovery.
- Modify `tests/mcp/tools.test.ts`: prove validation, lifecycle registry routing, real mailbox recovery, and tool registration.
- Modify `tests/mcp/server.test.ts`: prove registered metadata includes the new schema.
- Modify `tests/package-runtime.test.ts` and `scripts/smoke-mcp-stdio.mjs`: keep packaged tool metadata coverage current.
- Modify this plan file after implementation to mark completed tasks.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for new behavior.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are explicitly selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Input validation
- MCP handlers
- Batch tools
- Messaging
- State stores
- Packaged runtime
- Docs and examples

Live provider smoke is not required for this milestone because `agent_team_message_many` adds a provider-neutral lifecycle batch wrapper and can be proven through lifecycle fixtures plus durable mailbox state. Live Claude behavior remains covered by future opt-in runbook smoke.

## Success Criteria

- `agent_team_message_many` appears in `listToolNames()` and MCP metadata.
- Input shape is `{ messages: [{ runId, message, cwd?, messageType?, correlationId? }], cwd?, concurrency? }`.
- Top-level `cwd` applies as the default for child message deliveries; item-level `cwd` can override it.
- `messages` must be a non-empty array of objects with non-empty `runId` and `message` strings.
- `cwd`, `messageType`, and `correlationId`, when provided, must be non-empty strings.
- `concurrency` must be a positive integer from 1 through 8; default is 8.
- Duplicate `{ cwd, runId }` targets in the same batch are rejected before lifecycle invocation so one batch cannot reorder messages to the same inbox.
- Results preserve input order even when child lifecycle calls resolve out of order.
- Each successful item returns `{ status: "ok", index, runId, cwd, correlationId?, result }`.
- A non-corruption message failure returns `{ status: "failed", index, runId, cwd, correlationId?, error }` without aborting the whole call.
- A `StateCorruptionError` for one run returns `{ status: "state_corrupt", index, runId, cwd, correlationId?, recovery }` using the shared archive/recovery path.
- Top-level status is `"ok"` only when all items are `ok`; otherwise it is `"partial_failure"`.
- Lifecycle messaging remains lifecycle-owned: `agent_team_message_many` must call `messageRun`, not write mailboxes directly.
- The tool only records or delivers messages; it does not reply/resume, cancel, wind down, cleanup, create provider sessions, infer model quality, or create durable batch sidecars.
- Sidecars, mailboxes, verdicts, status, wind-down, cleanup, recovery, and evidence remain first-class per child run.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, provider runtime implementation, aggregate model-quality verdict, implicit control action, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Core Batch Message Helper

**Files:**
- Add: `src/core/message-many.ts`
- Modify: `src/core/types.ts`
- Add: `tests/core/message-many.test.ts`

- [x] **Step 1: Write failing core batch-message tests**

Add `tests/core/message-many.test.ts` with tests proving:

- `sendAgentMessages` sends messages with bounded concurrency and preserves input order when promises resolve out of order.
- child successes include `status`, `index`, `runId`, `cwd`, optional `correlationId`, and lifecycle `result`.
- child non-corruption failures become `failed` items and later messages still run.
- child `StateCorruptionError` failures become `state_corrupt` items using `operation: "agent_team_message_many"` and later messages still run.

Run:

```bash
npm test -- tests/core/message-many.test.ts
```

Expected: FAIL because `src/core/message-many.ts` does not exist yet.

- [x] **Step 2: Add batch-message types**

In `src/core/types.ts`, add:

```ts
export interface AgentMessageManyItemRequest {
  readonly runId: string;
  readonly cwd: string;
  readonly message: string;
  readonly messageType?: string;
  readonly correlationId?: string;
}

export interface AgentMessageManyRequest {
  readonly messages: readonly AgentMessageManyItemRequest[];
  readonly concurrency: number;
}

export interface AgentMessageManyOk {
  readonly status: "ok";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly result: AgentMessageResult;
}

export interface AgentMessageManyFailed {
  readonly status: "failed";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly error: string;
}

export interface AgentMessageManyRecovered {
  readonly status: "state_corrupt";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly recovery: unknown;
}

export type AgentMessageManyItem =
  | AgentMessageManyOk
  | AgentMessageManyFailed
  | AgentMessageManyRecovered;

export interface AgentMessageManyResult {
  readonly status: "ok" | "partial_failure";
  readonly messages: readonly AgentMessageManyItem[];
}
```

- [x] **Step 3: Implement bounded batch-message helper**

In `src/core/message-many.ts`, export:

```ts
export interface MessageManyDependencies {
  readonly messageRun: (request: AgentMessageRequest) => Promise<AgentMessageResult>;
  readonly recoverStateCorruption: (input: StateCorruptionRecoveryInput) => Promise<unknown>;
}

export async function sendAgentMessages(
  request: AgentMessageManyRequest,
  deps: MessageManyDependencies
): Promise<AgentMessageManyResult>
```

Implementation requirements:

- allocate a fixed result array with the same length as `request.messages`
- run a worker loop with `Math.min(request.concurrency, request.messages.length)` workers
- each worker claims the next index synchronously before awaiting lifecycle work
- call `deps.messageRun({ runId, cwd, message, messageType?, correlationId? })` for every child
- map successes to `{ status: "ok", index, runId, cwd, correlationId?, result }`
- map `StateCorruptionError` to `{ status: "state_corrupt", index, runId, cwd, correlationId?, recovery }`
- map other thrown errors to `{ status: "failed", index, runId, cwd, correlationId?, error }`
- return top-level `partial_failure` when any item is not `ok`

- [x] **Step 4: Run focused core tests**

Run:

```bash
npm test -- tests/core/message-many.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit core helper**

```bash
git add src/core/types.ts src/core/message-many.ts tests/core/message-many.test.ts
git commit -m "feat: add batch message core"
```

## Task 2: MCP Tool And Durable Recovery Surface

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [x] **Step 1: Write failing MCP batch-message tests**

Add tests proving:

- `agent_team_message_many` validates missing `messages`, empty `messages`, non-object children, missing/empty `runId`, missing/empty `message`, invalid `cwd`, invalid `messageType`, invalid `correlationId`, and invalid `concurrency`.
- duplicate `{ cwd, runId }` targets in one batch are rejected before lifecycle invocation.
- invalid inputs return `validation_error` before invoking lifecycle.
- top-level `cwd` defaults into child message requests and item-level `cwd` overrides it.
- valid messages with the same cwd reuse the same lifecycle manager, while a different cwd uses the lifecycle registry for that workspace.
- ordered results are returned even when lifecycle messages resolve out of order.
- one lifecycle failure returns a per-child `failed` item and does not drop later messages.
- one corrupt mailbox returns a per-child `state_corrupt` recovery item and still returns later message results.
- `listToolNames()` includes `agent_team_message_many` after `agent_team_message`.

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL because `agent_team_message_many` is not registered yet.

- [x] **Step 2: Register and parse the tool**

In `src/mcp/tools.ts`:

- import `sendAgentMessages` from `../core/message-many.js`
- import `AgentMessageManyRequest` and `AgentMessageManyItemRequest`
- add `"agent_team_message_many"` after `"agent_team_message"` in `TOOL_NAMES`
- add `parseMessageManyArgs(args, cwd)` returning `AgentMessageManyRequest | JsonToolResult`
- validation rules:
  - `messages` must be a non-empty array
  - each `messages[index]` must be an object
  - each `messages[index].runId` must be a non-empty string
  - each `messages[index].message` must be a non-empty string
  - each `messages[index].cwd`, when provided, must be a non-empty string
  - each `messages[index].messageType`, when provided, must be a non-empty string
  - each `messages[index].correlationId`, when provided, must be a non-empty string
  - top-level `cwd`, when provided, must be a non-empty string
  - duplicate resolved `{ cwd, runId }` targets are rejected
  - `concurrency` defaults to `8`
  - `concurrency` must be an integer from `1` to `8`
- handle `agent_team_message_many` by:
  - calling `sendAgentMessages(parsed, { messageRun, recoverStateCorruption })`
  - using `lifecycleFor(item.cwd).messageRun(item)` inside the supplied `messageRun` dependency so workspace-specific config and lifecycle registry identity remain unchanged
  - calling `recoverStateCorruption({ workspaceRoot: item.cwd, runId, operation: "agent_team_message_many", error })` inside the supplied recovery dependency

- [x] **Step 3: Run focused MCP tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit MCP tool**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: expose batch message MCP tool"
```

## Task 3: Schema And Packaged Runtime Metadata

**Files:**
- Modify: `src/mcp/schemas.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `tests/package-runtime.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`

- [x] **Step 1: Write failing schema/package tests**

Add tests proving:

- MCP server metadata exposes `agent_team_message_many` with required `messages`.
- packaged stdio smoke checks `agent_team_message_many` requires `messages`.
- schema descriptions stay provider-neutral and do not mention Claude-specific internals.

Run:

```bash
npm test -- tests/mcp/server.test.ts tests/package-runtime.test.ts
```

Expected: FAIL because schema and smoke metadata are not registered yet.

- [x] **Step 2: Add MCP schema metadata**

In `src/mcp/schemas.ts`, add:

```ts
const messageManyItemInputSchema = z.object({
  runId,
  cwd,
  message,
  messageType,
  correlationId
});

const messageManyInputSchema = {
  messages: z.array(messageManyItemInputSchema).min(1),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};
```

Add metadata:

```ts
agent_team_message_many: {
  title: "Message Agent Sessions",
  description: "Record or deliver in-flight messages to multiple runs with bounded concurrency.",
  inputSchema: messageManyInputSchema
}
```

- [x] **Step 3: Update smoke metadata assertion**

In `scripts/smoke-mcp-stdio.mjs`, add:

```js
assertToolRequires(tools.tools, "agent_team_message_many", ["messages"]);
```

near the existing `agent_team_message` assertion.

- [x] **Step 4: Run focused package tests**

Run:

```bash
npm test -- tests/mcp/server.test.ts tests/package-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit metadata coverage**

```bash
git add src/mcp/schemas.ts tests/mcp/server.test.ts tests/package-runtime.test.ts scripts/smoke-mcp-stdio.mjs
git commit -m "test: cover batch message metadata"
```

## Task 4: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/message-many.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts
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
rg "agent_team_message_many|AgentMessageMany|sendAgentMessages|partial_failure|StateCorruptionError|recoverStateCorruption" src tests docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-27.md
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode" src tests docs
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers
rg "benchmark|model-quality|mock LLM|embedding|heuristic" src tests docs
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|agent_team_reply|agent_team_cancel|agent_team_wind_down" src tests docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-27.md
```

Expected: batch message is messaging-only lifecycle delegation, not an implicit provider fallback, benchmark harness, model-quality aggregator, bypass-permission path, reply/resume path, cancellation path, wind-down path, process-kill path, or cleanup shortcut.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-27.md
git commit -m "docs: mark batch message milestone complete"
```
