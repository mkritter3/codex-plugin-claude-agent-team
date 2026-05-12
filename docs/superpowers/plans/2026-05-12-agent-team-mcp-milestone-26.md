# Agent Team MCP Milestone 26 Batch Status Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class MCP tool that reads status for multiple durable agent runs in one call.

**Architecture:** `agent_team_status_many` is a read-only observability helper over the same lifecycle manager path used by `agent_team_status`. It does not create a durable batch sidecar, infer aggregate verdict quality, cancel runs, wind down runs, or clean up workspaces. Each child result remains individually addressable by run id and preserves per-run detached reconciliation and state-corruption recovery semantics.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP Zod schemas, provider-neutral lifecycle manager, durable run sidecars, state recovery.

---

## File Structure

- Modify `src/core/types.ts`: add status-many request/result types.
- Add `src/core/status-many.ts`: bounded provider-neutral status-many helper.
- Modify `src/mcp/tools.ts`: add parsing and handling for `agent_team_status_many`.
- Modify `src/mcp/schemas.ts`: expose the `agent_team_status_many` input schema.
- Modify `tests/mcp/tools.test.ts`: prove validation, ordering, detached reconciliation, per-run failures, and per-run corruption recovery.
- Modify `tests/mcp/server.test.ts`: prove registered metadata includes the new schema.
- Modify `tests/package-runtime.test.ts` and `scripts/smoke-mcp-stdio.mjs`: keep packaged tool metadata coverage current.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `agent_team_status_many` appears in `listToolNames()` and MCP metadata.
- Input shape is `{ runs: [{ runId, cwd?, correlationId? }], cwd?, concurrency? }`.
- Top-level `cwd` applies as the default for child status reads; item-level `cwd` can override it.
- `runs` must be a non-empty array of objects with non-empty `runId` strings.
- `cwd` and `correlationId`, when provided, must be strings.
- `concurrency` must be a positive integer from 1 through 8; default is 8.
- Results preserve input order.
- Each successful item returns `{ status: "ok", index, runId, cwd, correlationId?, run }`.
- A non-corruption status failure returns `{ status: "failed", index, runId, cwd, correlationId?, error }` without aborting the whole call.
- A `StateCorruptionError` for one run returns `{ status: "state_corrupt", index, runId, cwd, correlationId?, recovery }` using the same archive/recovery path as `agent_team_status`.
- Top-level status is `"ok"` only when all items are `ok`; otherwise it is `"partial_failure"`.
- Detached reconciliation remains lifecycle-owned: `agent_team_status_many` must call `getStatus`, not read sidecars directly.
- Sidecars, mailboxes, verdicts, status, wind-down, and cleanup remain first-class per child run.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, provider runtime implementation, aggregate model-quality verdict, implicit batch cancellation, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: MCP Batch Status Tool

**Files:**
- Add: `src/core/status-many.ts`
- Modify: `src/core/types.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing MCP batch-status tests**

Add tests proving:

- `agent_team_status_many` validates missing, empty, non-object, missing `runId`, empty `runId`, invalid `cwd`, invalid `correlationId`, and invalid `concurrency`.
- top-level `cwd` defaults into child status reads, and item-level `cwd` overrides the default.
- two valid runs with the same cwd call `getStatus` twice through the same lifecycle manager and return ordered `ok` results.
- two valid runs that resolve out of order still return results in input order.
- a failed `getStatus` call returns a per-run `failed` item and still returns later run statuses.
- a `StateCorruptionError` for one run returns a per-run `state_corrupt` item with recovery details and still returns later run statuses.

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL because `agent_team_status_many` is not registered yet.

- [ ] **Step 2: Add status-many types**

In `src/core/types.ts`, add:

```ts
export interface AgentStatusManyRequest {
  readonly runs: readonly AgentStatusManyRun[];
  readonly concurrency: number;
}

export interface AgentStatusManyRun {
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
}

export interface AgentStatusManyOk {
  readonly status: "ok";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly run: RunSidecar;
}

export interface AgentStatusManyFailed {
  readonly status: "failed";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly error: string;
}

export interface AgentStatusManyRecovered {
  readonly status: "state_corrupt";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly recovery: unknown;
}

export type AgentStatusManyItem =
  | AgentStatusManyOk
  | AgentStatusManyFailed
  | AgentStatusManyRecovered;

export interface AgentStatusManyResult {
  readonly status: "ok" | "partial_failure";
  readonly runs: readonly AgentStatusManyItem[];
}
```

- [ ] **Step 3: Implement bounded status-many helper**

In `src/core/status-many.ts`, export:

```ts
export interface StatusManyDependencies {
  readonly getStatus: (cwd: string, runId: string) => Promise<RunSidecar>;
  readonly recoverStateCorruption: (input: StateCorruptionRecoveryInput) => Promise<unknown>;
}

export async function readAgentStatuses(
  request: AgentStatusManyRequest,
  deps: StatusManyDependencies
): Promise<AgentStatusManyResult>
```

Implementation requirements:

- allocate a fixed result array with the same length as `request.runs`
- run a worker loop with `Math.min(request.concurrency, request.runs.length)` workers
- each worker claims the next index synchronously before awaiting status
- call `deps.getStatus(run.cwd, run.runId)` for every run
- map successes to `{ status: "ok", index, runId, cwd, correlationId?, run }`
- map `StateCorruptionError` to `{ status: "state_corrupt", index, runId, cwd, correlationId?, recovery }`
- map other thrown errors to `{ status: "failed", index, runId, cwd, correlationId?, error }`
- return top-level `partial_failure` when any item is not `ok`

- [ ] **Step 4: Register and parse the tool**

In `src/mcp/tools.ts`:

- add `"agent_team_status_many"` after `"agent_team_status"` in `TOOL_NAMES`
- add `parseStatusManyArgs(args, cwd)` returning `AgentStatusManyRequest | JsonToolResult`
- validation rules:
  - `runs` must be a non-empty array
  - each `runs[index]` must be an object
  - each `runs[index].runId` must be a non-empty string
  - each `runs[index].cwd`, when provided, must be a string
  - each `runs[index].correlationId`, when provided, must be a string
  - `cwd`, when provided, must be a string
  - `concurrency` defaults to `8`
  - `concurrency` must be an integer from `1` to `8`
- handle `agent_team_status_many` by:
  - calling `readAgentStatuses(parsed, { getStatus, recoverStateCorruption })`
  - using `lifecycleFor(itemCwd).getStatus(itemCwd, runId)` inside the supplied `getStatus` dependency so workspace-specific config and lifecycle registry identity remain unchanged
  - calling `recoverStateCorruption({ workspaceRoot: itemCwd, runId, operation: "agent_team_status_many", error })` inside the supplied recovery dependency

- [ ] **Step 5: Run focused MCP tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/status-many.ts src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: add batch status MCP tool"
```

## Task 2: Schema And Package Metadata

**Files:**
- Modify: `src/mcp/schemas.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `tests/package-runtime.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`

- [ ] **Step 1: Write failing schema/package tests**

Add tests proving:

- MCP server metadata exposes `agent_team_status_many` with required `runs`.
- `listToolNames()` includes `agent_team_status_many` in the expected position.
- the packaged smoke script checks `agent_team_status_many` requires `runs`.

Run:

```bash
npm test -- tests/mcp/server.test.ts tests/package-runtime.test.ts
```

Expected: FAIL because schema and smoke metadata are not registered yet.

- [ ] **Step 2: Add MCP schema metadata**

In `src/mcp/schemas.ts`, add:

```ts
const statusManyInputSchema = {
  runs: z.array(z.object({
    runId,
    cwd,
    correlationId
  })).min(1),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};
```

Add metadata:

```ts
agent_team_status_many: {
  title: "Get Agent Statuses",
  description: "Read current durable state for multiple runs.",
  inputSchema: statusManyInputSchema
}
```

- [ ] **Step 3: Update smoke metadata assertion**

In `scripts/smoke-mcp-stdio.mjs`, add:

```js
assertToolRequires(tools.tools, "agent_team_status_many", ["runs"]);
```

near the existing `agent_team_status` assertion.

- [ ] **Step 4: Run focused package tests**

Run:

```bash
npm test -- tests/mcp/server.test.ts tests/package-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/schemas.ts tests/mcp/server.test.ts tests/package-runtime.test.ts scripts/smoke-mcp-stdio.mjs
git commit -m "test: cover batch status metadata"
```

## Task 3: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts
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
rg "agent_team_status_many|AgentStatusMany|state_corrupt|partial_failure|recoverStateCorruption" src tests docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-26.md
rg "allowApiKeyFallback|benchmark|embedding|mock LLM|bypassPermissions|process.kill|aggregate verdict|model-quality|automatic cleanup|batch cancel|batch wind" src/providers src/core src/mcp tests/providers tests/core tests/mcp
```

Expected: batch status is read-only observability over lifecycle status, not an implicit provider fallback, benchmark harness, model-quality aggregator, bypass-permission path, process-kill path, control shortcut, or cleanup shortcut.

- [ ] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-26.md
git commit -m "docs: mark batch status milestone complete"
```
