# Agent Team MCP Milestone 28 Batch Wind-Down Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agent_team_wind_down_many` so Codex can gracefully ask multiple durable agent runs to wrap up in one bounded MCP call.

**Architecture:** `agent_team_wind_down_many` is a control-family MCP tool over the existing lifecycle manager. Each child run delegates to `AgentLifecycleManager.windDownRun`, preserving control records, input closure, active-handle final-summary requests, detached semantics, terminal semantics, sidecars, mailboxes, and shared state-corruption recovery. The batch helper stays provider-neutral and returns ordered per-run results with partial-failure evidence; it never cancels, hard-kills, resumes, replies, cleans up worktrees, or performs provider-specific shortcuts.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Vitest, Zod schemas, provider-neutral lifecycle contracts, durable `.agent-team/` sidecars and JSONL mailboxes.

---

## Scope

**Files:**

- Create: `src/core/wind-down-many.ts`
- Create: `tests/core/wind-down-many.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `tests/package-runtime.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-28.md`

**Non-goals:**

- Do not add `agent_team_cancel_many`.
- Do not add team records or team summary aggregation.
- Do not change single-run `agent_team_wind_down` semantics.
- Do not add provider APIs, provider fallback, model-quality claims, or live-provider smoke.
- Do not delete implementation worktrees or hide logs, sidecars, mailboxes, diffs, or verdict evidence.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for new behavior.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are explicitly selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Scope and architecture: this plan names files, ownership boundaries, non-goals, and success criteria.
- TDD red proof: new core helper, MCP handler, schema, and packaged smoke tests are written and observed failing before implementation.
- MCP contract: tool names, Zod metadata, handler validation, server registration, package-runtime assertions, and packaged stdio smoke are updated.
- Batch tools: empty arrays, non-object children, cwd defaults/overrides, correlation ids, bounded concurrency, ordered results, partial failures, state corruption, recovery failure, duplicate per-run targets, and later-run continuation are tested.
- Lifecycle safety: each child delegates to lifecycle `windDownRun`; no batch path calls `cancelRun`, `cleanupRunWorkspace`, `replyRun`, `messageRun`, provider process kill, or provider-specific execution.
- Wind-down: active/detached/terminal semantics remain owned by the existing lifecycle method; batch tests verify delegation and durable recovery without reimplementing those semantics.
- Failure behavior: validation returns `validation_error` before lifecycle invocation; non-corruption failures and recovery failures produce per-item `failed` evidence.
- Corruption recovery: `StateCorruptionError` maps to a per-item `state_corrupt` result using operation `agent_team_wind_down_many`.
- Public schema: public MCP metadata exposes only `runs`, `cwd`, and `concurrency`; it does not mention Claude, provider internals, prompts, process control, cancellation, or cleanup.
- Packaged runtime: stdio smoke against built `dist/index.js` asserts `agent_team_wind_down_many` requires `runs`.

Live provider smoke is not required for this milestone because the tool is a provider-neutral lifecycle batch wrapper. Existing lifecycle tests cover active-handle and detached wind-down mechanics without consuming subscription credentials. Live Claude team wind-down remains part of the opt-in runbook milestone.

## Success Criteria

- `agent_team_wind_down_many` appears in `listToolNames()`, MCP metadata, packaged stdio smoke, and tests.
- Input shape is `{ runs: [{ runId, cwd?, correlationId? }], cwd?, concurrency? }`.
- Top-level `cwd` defaults into child runs; item-level `cwd` overrides it.
- Duplicate targets for the same normalized `{ cwd, runId }` are rejected before lifecycle side effects.
- Each child delegates to lifecycle `windDownRun(cwd, runId)`.
- Results preserve input order even when child operations resolve out of order.
- Results include `index`, `runId`, `cwd`, optional `correlationId`, and either `result`, `error`, or `recovery`.
- Top-level status is `"ok"` only when all items are `ok`; otherwise it is `"partial_failure"`.
- One child failure, state corruption, or recovery failure does not abort later children.
- No batch wind-down path performs process kill, cancellation, workspace cleanup, message delivery, reply/resume, provider routing, provider-specific command construction, or model-quality synthesis.

## Task 1: Core Batch Wind-Down Helper

**Files:**

- Modify: `src/core/types.ts`
- Create: `src/core/wind-down-many.ts`
- Create: `tests/core/wind-down-many.test.ts`

- [x] **Step 1: Write failing core tests**

Create `tests/core/wind-down-many.test.ts` with tests for bounded concurrency, ordered results, partial failures, `StateCorruptionError` recovery, and recovery failure.

Use this shape:

```ts
import { describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../src/core/errors.js";
import { windDownAgentRuns } from "../../src/core/wind-down-many.js";
import type { AgentControlResult } from "../../src/core/types.js";

function controlResult(runId: string, status: AgentControlResult["status"]): AgentControlResult {
  return {
    runId,
    status,
    sidecarPath: `/repo/.agent-team/runs/${runId}.json`,
    message: `Wind-down result for ${runId}.`
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("windDownAgentRuns", () => {
  it("winds down runs with bounded concurrency and preserves input order", async () => {
    const gates = Array.from({ length: 4 }, () => deferred<AgentControlResult>());
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;

    const resultPromise = windDownAgentRuns(
      {
        concurrency: 2,
        runs: [
          { runId: "run_0", cwd: "/repo", correlationId: "zero" },
          { runId: "run_1", cwd: "/repo", correlationId: "one" },
          { runId: "run_2", cwd: "/other", correlationId: "two" },
          { runId: "run_3", cwd: "/other", correlationId: "three" }
        ]
      },
      {
        async windDownRun(_cwd, _runId) {
          const index = started.length;
          started.push(index);
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            return await gates[index]!.promise;
          } finally {
            active -= 1;
          }
        },
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

    await flush();
    expect(started).toEqual([0, 1]);
    expect(maxActive).toBe(2);
    gates[1]!.resolve(controlResult("run_1", "completed"));
    await flush();
    expect(started).toEqual([0, 1, 2]);
    gates[2]!.resolve(controlResult("run_2", "winding-down"));
    gates[0]!.resolve(controlResult("run_0", "winding-down"));
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    gates[3]!.resolve(controlResult("run_3", "failed"));

    await expect(resultPromise).resolves.toMatchObject({
      status: "ok",
      runs: [
        { status: "ok", index: 0, runId: "run_0", cwd: "/repo", correlationId: "zero", result: { status: "winding-down" } },
        { status: "ok", index: 1, runId: "run_1", cwd: "/repo", correlationId: "one", result: { status: "completed" } },
        { status: "ok", index: 2, runId: "run_2", cwd: "/other", correlationId: "two", result: { status: "winding-down" } },
        { status: "ok", index: 3, runId: "run_3", cwd: "/other", correlationId: "three", result: { status: "failed" } }
      ]
    });
    expect(maxActive).toBe(2);
  });

  it("records per-run failures and continues queued wind-downs", async () => {
    const attempted: string[] = [];
    const result = await windDownAgentRuns(
      {
        concurrency: 1,
        runs: [
          { runId: "run_ok_1", cwd: "/repo" },
          { runId: "run_bad", cwd: "/repo", correlationId: "bad" },
          { runId: "run_ok_2", cwd: "/repo" }
        ]
      },
      {
        async windDownRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_bad") throw new Error("wind down boom");
          return controlResult(runId, "winding-down");
        },
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

    expect(attempted).toEqual(["run_ok_1", "run_bad", "run_ok_2"]);
    expect(result).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "ok", index: 0, runId: "run_ok_1" },
        { status: "failed", index: 1, runId: "run_bad", cwd: "/repo", correlationId: "bad", error: "wind down boom" },
        { status: "ok", index: 2, runId: "run_ok_2" }
      ]
    });
  });

  it("converts one StateCorruptionError into a recovered item without aborting the batch", async () => {
    const result = await windDownAgentRuns(
      {
        concurrency: 2,
        runs: [
          { runId: "run_corrupt", cwd: "/repo", correlationId: "corrupt" },
          { runId: "run_ok", cwd: "/repo" }
        ]
      },
      {
        async windDownRun(_cwd, runId) {
          if (runId === "run_corrupt") {
            throw new StateCorruptionError("Invalid JSON", {
              path: "/repo/.agent-team/runs/run_corrupt.json",
              kind: "json"
            });
          }
          return controlResult(runId, "winding-down");
        },
        async recoverStateCorruption(input) {
          return {
            status: "state_corrupt",
            runId: input.runId,
            operation: input.operation,
            recovery: "archived",
            interventionRequired: true
          };
        }
      }
    );

    expect(result).toMatchObject({
      status: "partial_failure",
      runs: [
        {
          status: "state_corrupt",
          index: 0,
          runId: "run_corrupt",
          cwd: "/repo",
          correlationId: "corrupt",
          recovery: {
            operation: "agent_team_wind_down_many",
            recovery: "archived",
            interventionRequired: true
          }
        },
        { status: "ok", index: 1, runId: "run_ok", cwd: "/repo" }
      ]
    });
  });

  it("records recovery failures as per-run failures and continues queued wind-downs", async () => {
    const attempted: string[] = [];
    const result = await windDownAgentRuns(
      {
        concurrency: 1,
        runs: [
          { runId: "run_recovery_fails", cwd: "/repo", correlationId: "recover" },
          { runId: "run_after_recovery_failure", cwd: "/repo" }
        ]
      },
      {
        async windDownRun(_cwd, runId) {
          attempted.push(runId);
          if (runId === "run_recovery_fails") {
            throw new StateCorruptionError("Invalid JSON", {
              path: "/repo/.agent-team/runs/run_recovery_fails.json",
              kind: "json"
            });
          }
          return controlResult(runId, "winding-down");
        },
        async recoverStateCorruption() {
          throw new Error("archive failed");
        }
      }
    );

    expect(attempted).toEqual(["run_recovery_fails", "run_after_recovery_failure"]);
    expect(result).toMatchObject({
      status: "partial_failure",
      runs: [
        { status: "failed", index: 0, runId: "run_recovery_fails", cwd: "/repo", correlationId: "recover", error: "state recovery failed: archive failed" },
        { status: "ok", index: 1, runId: "run_after_recovery_failure", cwd: "/repo" }
      ]
    });
  });
});
```

- [x] **Step 2: Run core tests red**

Run:

```bash
npm test -- tests/core/wind-down-many.test.ts
```

Expected: FAIL because `src/core/wind-down-many.ts` does not exist.

- [x] **Step 3: Add wind-down-many types**

In `src/core/types.ts`, add after `AgentMessageManyResult`:

```ts
export interface AgentWindDownManyRun {
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
}

export interface AgentWindDownManyRequest {
  readonly runs: readonly AgentWindDownManyRun[];
  readonly concurrency: number;
}

export interface AgentWindDownManyOk {
  readonly status: "ok";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly result: AgentControlResult;
}

export interface AgentWindDownManyFailed {
  readonly status: "failed";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly error: string;
}

export interface AgentWindDownManyRecovered {
  readonly status: "state_corrupt";
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly recovery: unknown;
}

export type AgentWindDownManyItem =
  | AgentWindDownManyOk
  | AgentWindDownManyFailed
  | AgentWindDownManyRecovered;

export interface AgentWindDownManyResult {
  readonly status: "ok" | "partial_failure";
  readonly runs: readonly AgentWindDownManyItem[];
}
```

- [x] **Step 4: Implement core helper**

Create `src/core/wind-down-many.ts` with:

```ts
import { StateCorruptionError } from "./errors.js";
import type { StateCorruptionRecoveryInput } from "./state/recovery.js";
import type {
  AgentControlResult,
  AgentWindDownManyItem,
  AgentWindDownManyOk,
  AgentWindDownManyRecovered,
  AgentWindDownManyRequest,
  AgentWindDownManyResult
} from "./types.js";

export interface WindDownManyDependencies {
  readonly windDownRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
  readonly recoverStateCorruption: (
    input: StateCorruptionRecoveryInput
  ) => Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function windDownAgentRuns(
  request: AgentWindDownManyRequest,
  deps: WindDownManyDependencies
): Promise<AgentWindDownManyResult> {
  const results = new Array<AgentWindDownManyItem>(request.runs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const run = request.runs[index];
      if (run === undefined) return;

      try {
        const result = await deps.windDownRun(run.cwd, run.runId);
        const ok: AgentWindDownManyOk = {
          status: "ok",
          index,
          runId: run.runId,
          cwd: run.cwd,
          ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
          result
        };
        results[index] = ok;
      } catch (error) {
        if (error instanceof StateCorruptionError) {
          try {
            const recovery = await deps.recoverStateCorruption({
              workspaceRoot: run.cwd,
              runId: run.runId,
              operation: "agent_team_wind_down_many",
              error
            });
            const recovered: AgentWindDownManyRecovered = {
              status: "state_corrupt",
              index,
              runId: run.runId,
              cwd: run.cwd,
              ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
              recovery
            };
            results[index] = recovered;
          } catch (recoveryError) {
            results[index] = {
              status: "failed",
              index,
              runId: run.runId,
              cwd: run.cwd,
              ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
              error: `state recovery failed: ${errorMessage(recoveryError)}`
            };
          }
          continue;
        }

        results[index] = {
          status: "failed",
          index,
          runId: run.runId,
          cwd: run.cwd,
          ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
          error: errorMessage(error)
        };
      }
    }
  }

  const workerCount = Math.min(request.concurrency, request.runs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    status: results.some((result) => result.status !== "ok") ? "partial_failure" : "ok",
    runs: results
  };
}
```

- [x] **Step 5: Run focused core tests**

Run:

```bash
npm test -- tests/core/wind-down-many.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 6: Commit core helper**

```bash
git add src/core/types.ts src/core/wind-down-many.ts tests/core/wind-down-many.test.ts
git commit -m "feat: add batch wind-down core"
```

## Task 2: MCP Tool Handler

**Files:**

- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [x] **Step 1: Write failing MCP handler tests**

Extend `tests/mcp/tools.test.ts` with tests proving:

- invalid `agent_team_wind_down_many` inputs return `validation_error` before lifecycle invocation
- duplicate normalized `{ cwd, runId }` targets are rejected before lifecycle invocation
- default `cwd` and per-run `cwd` overrides use the lifecycle registry selected for that workspace
- child `windDownRun` results are ordered and include correlation ids
- one child failure returns top-level `partial_failure` and later children still run
- one corrupt run sidecar returns a per-item `state_corrupt` recovery result and later children still run
- the tool list includes `agent_team_wind_down_many` after `agent_team_wind_down`

Use this concrete test style:

```ts
const result = await handlers.handleToolCall("agent_team_wind_down_many", {
  cwd: workspace,
  concurrency: 2,
  runs: [
    { runId: "run_a", correlationId: "a" },
    { runId: "run_b", cwd: otherWorkspace, correlationId: "b" },
    { runId: "run_c" }
  ]
});

expect(result.structuredContent).toMatchObject({
  status: "ok",
  runs: [
    { status: "ok", index: 0, runId: "run_a", cwd: workspace, correlationId: "a" },
    { status: "ok", index: 1, runId: "run_b", cwd: otherWorkspace, correlationId: "b" },
    { status: "ok", index: 2, runId: "run_c", cwd: workspace }
  ]
});
```

For corruption recovery, create a corrupt sidecar using existing helpers:

```ts
await writeFile(runSidecarPath(workspace, "run_corrupt_many_wind"), "{\"bad\"\n", "utf8");
const result = await handlers.handleToolCall("agent_team_wind_down_many", {
  runs: [
    { runId: "run_corrupt_many_wind", correlationId: "bad" },
    { runId: "run_ok_many_wind" }
  ]
});
expect(result.structuredContent).toMatchObject({
  status: "partial_failure",
  runs: [
    {
      status: "state_corrupt",
      index: 0,
      runId: "run_corrupt_many_wind",
      correlationId: "bad",
      recovery: { operation: "agent_team_wind_down_many" }
    },
    { status: "ok", index: 1, runId: "run_ok_many_wind" }
  ]
});
```

- [x] **Step 2: Run MCP tests red**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL because `agent_team_wind_down_many` is unknown.

- [x] **Step 3: Register and parse the tool**

In `src/mcp/tools.ts`:

- import `windDownAgentRuns` from `../core/wind-down-many.js`
- import `AgentWindDownManyRequest` and `AgentWindDownManyRun`
- add `"agent_team_wind_down_many"` after `"agent_team_wind_down"` in `TOOL_NAMES`
- add `parseWindDownManyArgs(args, cwd)` returning `AgentWindDownManyRequest | JsonToolResult`
- validate non-empty `runs`
- validate top-level `cwd` as optional non-empty string
- validate `concurrency` as integer from `1` to `8`, defaulting to `8`
- validate each child is an object
- validate each child `runId` as non-empty string
- validate each child `cwd` and `correlationId` as optional non-empty strings
- resolve child cwd as `item.cwd ?? defaultCwd ?? cwd`
- reject duplicate `${resolve(resolvedCwd)}\0${runId}` targets
- handle `agent_team_wind_down_many` by calling:

```ts
return jsonToolResult({
  ...(await windDownAgentRuns(parsed, {
    windDownRun: async (workspaceRoot, runId) =>
      (await lifecycleFor(workspaceRoot)).windDownRun(workspaceRoot, runId),
    recoverStateCorruption: async (input) => recoverStateCorruption(input)
  }))
});
```

Do not call `cancelRun`, `cleanupRunWorkspace`, `messageRun`, `replyRun`, provider APIs, `process.kill`, or direct mailbox writers in the batch tool.

- [x] **Step 4: Run focused MCP tests**

Run:

```bash
npm test -- tests/core/wind-down-many.test.ts tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit MCP tool**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: expose batch wind-down MCP tool"
```

## Task 3: MCP Schema And Packaged Runtime

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `tests/package-runtime.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`

- [x] **Step 1: Write failing schema/package tests**

Extend:

- `tests/mcp/server.test.ts`: mocked `listToolNames()` includes `agent_team_wind_down_many`; expected registered names include it; metadata schema has `runs`.
- `tests/package-runtime.test.ts`: smoke script must contain `assertToolRequires(tools.tools, "agent_team_wind_down_many", ["runs"])`.

Run:

```bash
npm test -- tests/mcp/server.test.ts tests/package-runtime.test.ts
```

Expected: FAIL because schema and smoke metadata are not registered yet.

- [x] **Step 2: Add MCP schema metadata**

In `src/mcp/schemas.ts`, add:

```ts
const windDownManyRunInputSchema = z.object({
  runId,
  cwd,
  correlationId
});

const windDownManyInputSchema = {
  runs: z.array(windDownManyRunInputSchema).min(1),
  cwd,
  concurrency: z.number().int().min(1).max(8).optional()
};
```

Then add to `TOOL_METADATA_BY_NAME` after `agent_team_wind_down`:

```ts
agent_team_wind_down_many: {
  title: "Wind Down Agent Sessions",
  description: "Request graceful finalization for multiple active or durable runs with bounded concurrency.",
  inputSchema: windDownManyInputSchema
},
```

The description must not mention Claude, provider internals, prompts, cancellation, process kill, or cleanup.

- [x] **Step 3: Update packaged stdio smoke**

In `scripts/smoke-mcp-stdio.mjs`, add near the single-run wind-down/control assertions:

```js
assertToolRequires(tools.tools, "agent_team_wind_down_many", ["runs"]);
```

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
git commit -m "test: cover batch wind-down metadata"
```

## Task 4: Verification, Plan Completion, And Integration

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-28.md`

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/wind-down-many.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts
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
rg "agent_team_wind_down_many|AgentWindDownMany|windDownAgentRuns|partial_failure|StateCorruptionError|recoverStateCorruption" src tests docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-28.md
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode" src tests docs
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers
rg "benchmark|model-quality|mock LLM|embedding|heuristic" src tests docs
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|agent_team_cancel|agent_team_reply|agent_team_message" src tests docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-28.md
```

Expected: batch wind-down is graceful lifecycle delegation, not an implicit provider fallback, benchmark harness, model-quality aggregator, bypass-permission path, message path, reply/resume path, cancellation path, process-kill path, or cleanup shortcut.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit:

```bash
git add docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-28.md
git commit -m "docs: mark batch wind-down milestone complete"
```

- [x] **Step 5: Merge, push, and cleanup**

From the main checkout:

```bash
git merge --ff-only codex/milestone-28-batch-wind-down
git push origin main
git worktree remove .worktrees/milestone-28-batch-wind-down
git branch -d codex/milestone-28-batch-wind-down
git status --short --branch
git worktree list
```

Expected: `main` matches `origin/main`, no temporary worktree remains, and no milestone branch remains.
