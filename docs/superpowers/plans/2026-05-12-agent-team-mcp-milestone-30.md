# Agent Team MCP Milestone 30 Team Summary Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agent_team_summary` so Codex can inspect a set of durable agent runs as an operator-grade team view without synthesizing quality claims.

**Architecture:** `agent_team_summary` is a read-only MCP tool over persisted `.agent-team/` run state. The core helper reads sidecars and mailbox evidence through shared state readers, groups runs by operational state, preserves ordered per-item results, and maps durable-state corruption through the existing recovery path. It does not call providers, resume sessions, mutate lifecycle state, clean worktrees, cancel runs, message agents, or infer model quality.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Vitest, Zod schemas, provider-neutral durable state contracts, `.agent-team/` sidecars, JSONL mailboxes, and existing state-corruption recovery.

---

## Scope

**Files:**

- Create: `src/core/team-summary.ts`
- Create: `tests/core/team-summary.test.ts`
- Modify: `src/core/types.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `tests/package-runtime.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-30.md`

**Non-goals:**

- Do not add `agent_team_cancel_many`.
- Do not add a durable team record or a second source of truth.
- Do not call Claude, Ollama, Gemini, Grok, provider APIs, provider CLIs, or LLMs.
- Do not summarize model quality, benchmark outcomes, prompt quality, or agent skill.
- Do not delete retained implementation worktrees or rewrite sidecars except through shared corruption recovery.
- Do not expose internal prompts, provider command details, or provider-specific implementation internals in public schemas.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for new core, MCP, schema, and packaged smoke behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Selected matrix cases are explicitly named.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Scope and architecture: this plan names files, ownership boundaries, non-goals, and success criteria.
- TDD red proof: new core helper, MCP handler, schema registration, and packaged smoke assertions are observed failing before implementation.
- MCP contract: tool name, Zod metadata, server registration, validation, package runtime assertions, and packaged stdio smoke are updated.
- Batch tool behavior: empty arrays, non-object children, cwd defaults and overrides, correlation ids, bounded concurrency, ordered results, partial failures, state corruption, recovery failure, duplicate targets, and later-run continuation are tested.
- Failure behavior: validation returns `validation_error` before durable-state reads; non-corruption failures and recovery failures produce per-item `failed` evidence.
- Corruption recovery: `StateCorruptionError` maps to a per-item `state_corrupt` result using operation `agent_team_summary`.
- Public schema: public MCP metadata exposes only run targeting and bounded concurrency; it does not mention Claude, provider internals, prompts, process control, cancellation, cleanup, or model quality.
- Packaged runtime: stdio smoke against built `dist/index.js` asserts `agent_team_summary` requires `runs`.

Live provider smoke is not required for this milestone because the tool reads durable state and mailbox evidence only. No subscription-backed provider process is started, resumed, messaged, cancelled, or wound down.

## Success Criteria

- `agent_team_summary` appears in `listToolNames()`, MCP metadata, server registration, package runtime assertions, and packaged stdio smoke.
- Input shape is `{ runs: [{ runId, cwd?, correlationId? }], cwd?, concurrency? }`.
- Top-level `cwd` defaults into child runs; item-level `cwd` overrides it.
- Duplicate targets for the same normalized `{ cwd, runId }` are rejected before durable-state reads.
- Results preserve input order even when child reads resolve out of order.
- Results include `index`, `runId`, `cwd`, optional `correlationId`, and either `run` plus `evidence`, `error`, or `recovery`.
- Top-level status is `"ok"` only when all items are `ok`; otherwise it is `"partial_failure"`.
- Groups are non-exclusive arrays of run ids for `running`, `awaitingInput`, `windingDown`, `terminal`, `failed`, `detached`, `cleanupBlocked`, and `retainedWorktree`.
- Evidence includes sidecar path, mailbox paths, mailbox record counts, log path, transcript path, workspace diff path, evidence paths, changed files, and verdict where present.
- One child failure, state corruption, or recovery failure does not abort later children.
- The summary path never calls providers, lifecycle control methods, model APIs, prompt builders, workspace cleanup, git inspection, cancellation, message delivery, reply/resume, wind-down, or model-quality synthesis.

## Task 1: Core Team Summary Helper

**Files:**

- Modify: `src/core/types.ts`
- Create: `src/core/team-summary.ts`
- Create: `tests/core/team-summary.test.ts`

- [ ] **Step 1: Write failing core tests**

Create `tests/core/team-summary.test.ts` with tests for bounded concurrency, ordered results, group membership, evidence pointers, partial failures, state corruption, and recovery failure.

Use this shape:

```ts
import { describe, expect, it } from "vitest";
import { StateCorruptionError } from "../../src/core/errors.js";
import { summarizeAgentTeam } from "../../src/core/team-summary.js";
import type { MailboxKind, MailboxRecord, RunSidecar } from "../../src/core/types.js";

const now = "2026-05-12T10:00:00.000Z";

function sidecar(runId: string, overrides: Partial<RunSidecar> = {}): RunSidecar {
  return {
    runId,
    role: "implementer",
    provider: "claude-code-cli",
    status: "running",
    createdAt: now,
    updatedAt: now,
    promptHash: "hash",
    promptPath: `/repo/.agent-team/runs/${runId}.prompt.md`,
    sidecarPath: `/repo/.agent-team/runs/${runId}.json`,
    logPath: `/repo/.agent-team/logs/${runId}.jsonl`,
    transcriptPath: `/repo/.agent-team/transcripts/${runId}.jsonl`,
    evidencePaths: [],
    ...overrides
  };
}

function mailbox(sequence: number): MailboxRecord {
  return {
    sequence,
    id: `record_${sequence}`,
    runId: "run",
    kind: "events",
    timestamp: now,
    payload: { message: `record ${sequence}` }
  };
}

describe("summarizeAgentTeam", () => {
  it("summarizes runs with bounded concurrency, ordered results, groups, and evidence", async () => {
    const reads: string[] = [];
    const result = await summarizeAgentTeam(
      {
        cwd: "/repo",
        concurrency: 2,
        runs: [
          { runId: "run_active", correlationId: "active" },
          { runId: "run_waiting", cwd: "/other" },
          { runId: "run_done" }
        ]
      },
      {
        async readRun(workspaceRoot, runId) {
          reads.push(`${workspaceRoot}:${runId}`);
          if (runId === "run_active") {
            return sidecar(runId, {
              detached: true,
              executionCwd: "/repo/.worktrees/run_active",
              workspaceRetention: "retain-until-integrated",
              workspaceCleanup: "pending",
              workspaceDiffPath: "/repo/.agent-team/workspaces/run_active.diff",
              changedFiles: ["src/a.ts"],
              verdict: { status: "SHIP", summary: "ready", requiredChanges: [], evidence: ["tests"], risks: [] }
            });
          }
          if (runId === "run_waiting") return sidecar(runId, { status: "awaiting-input" });
          return sidecar(runId, { status: "completed" });
        },
        async readMailbox(_workspaceRoot, _runId, kind: MailboxKind) {
          return kind === "events" ? [mailbox(1), mailbox(2)] : [];
        },
        async recoverStateCorruption() {
          throw new Error("should not recover state");
        }
      }
    );

    expect(reads).toEqual(["/repo:run_active", "/other:run_waiting", "/repo:run_done"]);
    expect(result.status).toBe("ok");
    expect(result.groups).toMatchObject({
      running: ["run_active"],
      awaitingInput: ["run_waiting"],
      terminal: ["run_done"],
      detached: ["run_active"],
      retainedWorktree: ["run_active"]
    });
    expect(result.runs).toMatchObject([
      {
        status: "ok",
        index: 0,
        runId: "run_active",
        cwd: "/repo",
        correlationId: "active",
        run: { operationalState: "running", detached: true, cleanupBlocked: false, retainedWorktree: true },
        evidence: {
          sidecarPath: "/repo/.agent-team/runs/run_active.json",
          workspaceDiffPath: "/repo/.agent-team/workspaces/run_active.diff",
          changedFiles: ["src/a.ts"],
          verdict: { status: "SHIP" },
          mailboxes: { events: { count: 2, lastSequence: 2 } }
        }
      }
    ]);
  });
});
```

- [ ] **Step 2: Define provider-neutral types**

Add summary request, result, group, run-state, mailbox-evidence, and evidence-pointer types to `src/core/types.ts`.

Type boundaries:

- `AgentTeamSummaryRequest`
- `AgentTeamSummaryRunRequest`
- `AgentTeamSummaryResult`
- `AgentTeamSummaryRunResult`
- `AgentTeamSummaryGroups`
- `AgentTeamSummaryOperationalState`
- `AgentTeamSummaryEvidence`
- `AgentTeamSummaryMailboxEvidence`

- [ ] **Step 3: Implement bounded summary reader**

Create `src/core/team-summary.ts` with:

- bounded concurrency using the existing batch helper style
- normalized cwd inheritance
- duplicate target rejection
- sidecar reads through injected `readRun`
- mailbox reads through injected `readMailbox`
- `StateCorruptionError` handling through injected `recoverStateCorruption`
- deterministic group construction from successful items only
- no provider calls, lifecycle controls, workspace cleanup, git inspection, prompt rendering, or quality synthesis

Operational grouping:

- `running`: `queued`, `starting`, `running`, or `cancelling`
- `awaitingInput`: `awaiting-input`
- `windingDown`: `winding-down`
- `terminal`: `completed`, `cancelled`, `failed`, or `expired`
- `failed`: `failed`
- `detached`: sidecar `detached === true`
- `retainedWorktree`: retained implementation workspace metadata exists and cleanup is not `removed`
- `cleanupBlocked`: terminal retained implementation workspace remains unremoved

## Task 2: MCP Tool Wiring

**Files:**

- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add tests that prove:

- `agent_team_summary` appears in `listToolNames()`
- schema metadata exists and requires `runs`
- server registration includes the tool
- invalid input returns `validation_error`
- duplicate targets are rejected before durable reads
- valid calls use shared state readers and return JSON summary content
- corrupt sidecar or mailbox state returns per-item recovery evidence

- [ ] **Step 2: Add public schema**

Add an MCP schema with title and description that describe a read-only team summary. Public fields:

```ts
{
  runs: [
    {
      runId: string,
      cwd?: string,
      correlationId?: string
    }
  ],
  cwd?: string,
  concurrency?: number
}
```

The schema description must stay provider-neutral and must not mention internal prompts, Claude subscription details, provider command lines, process ids, cleanup implementation, or quality judgments.

- [ ] **Step 3: Wire handler**

Add `agent_team_summary` to `src/mcp/tools.ts` and call `summarizeAgentTeam` with:

- `readRunSidecar`
- `readMailboxRecords`
- shared `recoverStateCorruption`
- parsed cwd defaults and concurrency

Validation must run before durable-state readers are invoked.

## Task 3: Package Runtime And Smoke Coverage

**Files:**

- Modify: `tests/package-runtime.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`

- [ ] **Step 1: Write failing package-runtime tests**

Extend package-runtime coverage so the packaged smoke script must mention `agent_team_summary`.

- [ ] **Step 2: Extend packaged stdio smoke**

Add a built-runtime smoke assertion that calling `agent_team_summary` without `runs` returns a validation error.

## Task 4: Documentation Completion And Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-30.md`

- [ ] **Step 1: Mark completed gates**

After implementation and verification, update this plan’s L11 checklist and task checkboxes.

- [ ] **Step 2: Run focused verification**

Commands:

```bash
npm test -- tests/core/team-summary.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts
npm run typecheck
npm test
npm run build
node scripts/smoke-mcp-stdio.mjs
```

- [ ] **Step 3: Run invariant scans**

Commands:

```bash
rg -n "mock LLM|mockLLM|fake LLM|heuristic|quality score|benchmark claim|API key fallback|ANTHROPIC_API_KEY|Claude prompt|internal prompt|agent_team_summary.*cancel|agent_team_summary.*wind_down|agent_team_summary.*cleanup" src tests docs scripts
rg -n "agent_team_summary" src tests scripts docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-30.md
```

- [ ] **Step 4: Run full CI**

Command:

```bash
npm run ci
```

## Integration Plan

- Commit this plan on `main`.
- Create isolated worktree `.worktrees/milestone-30-team-summary` on branch `codex/milestone-30-team-summary`.
- Implement with TDD and keep red proof in terminal output.
- Merge the implementation branch to `main` only after focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass.
- Push `main`.
- Remove the temporary worktree and delete the temporary branch after successful merge.
