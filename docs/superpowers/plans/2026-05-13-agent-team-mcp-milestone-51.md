# Agent Team MCP Milestone 51 Workflow State And Senior Review Policy Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the durable workflow-state and senior-review-policy foundation for the L11 Agent Team Workflow Orchestrator without starting live agents or adding public workflow MCP tools yet.

**Architecture:** Extend config with default-on senior review policy, add provider-neutral workflow record types, and store workflow records under `.agent-team/workflows/` using the existing atomic JSON and corruption-reporting patterns. This milestone creates the source-of-truth state layer that later consensus, slice DAG, blocked/unblocked, and review tools will use.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, atomic JSON state helpers, `.agent-team/` durable state, provider-neutral core contracts.

---

## Scope

This milestone is intentionally foundational.

In scope:

- `seniorReview` config defaults and parser support.
- Environment override parsing for Opus planning and implementation review modes.
- Workflow id/path helpers.
- Workflow record types for goal packet, senior review policy, slice DAG, consensus rounds, reviewer verdicts, user escalation evidence, Opus availability evidence, and integration queue metadata.
- Atomic workflow read/write/list store with strict shape validation.
- Focused tests for defaults, overrides, invalid modes, safe workflow ids, sorted listing, corruption, and unknown-field rejection.
- Documentation status update in this plan after implementation.

Out of scope:

- No new public MCP workflow tools.
- No live Opus calls.
- No consensus orchestration execution.
- No slice start/unblock execution.
- No integration queue computation.
- No automatic merge or cleanup behavior.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for config and workflow store behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is not required because this milestone proves state/config mechanics only and makes no real Opus sign-off claim.

## Success Criteria

- `DEFAULT_AGENT_TEAM_CONFIG.seniorReview.opusPlanning.mode` is `required-when-available`.
- `DEFAULT_AGENT_TEAM_CONFIG.seniorReview.opusImplementation.mode` is `required-when-available`.
- Workspace config can set either mode to `disabled`, `optional`, `required-when-available`, or `required-blocking`.
- `AGENT_TEAM_OPUS_PLANNING_REVIEW` and `AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW` can override missing workspace values.
- Invalid senior-review modes fail config loading with `AgentTeamConfigError`.
- Workflow ids are safe, path-confined ids matching `workflow_<safe>`.
- Workflow records are written atomically under `.agent-team/workflows/<workflowId>.json`.
- Workflow records reject unknown top-level fields, unsafe ids, path/id mismatch, malformed slice states, malformed consensus rounds, malformed reviewer verdicts, malformed Opus evidence, and malformed user escalation evidence as `StateCorruptionError`.
- Workflow listing returns records sorted by `createdAt` then `workflowId`.
- The implementation introduces no public MCP schema changes.
- The implementation introduces no API-key fallback, no live-provider call, no heuristic model-quality behavior, no auto-merge, and no hidden cleanup.

## Required Edge Cases

Selected from the L11 matrix:

- Config input validation: missing fields, invalid strings, env override precedence, workspace config precedence.
- State stores: atomic writes, corrupt JSON, shape-invalid JSON, unknown fields, unsafe ids, path/id mismatch.
- Provider routing/auth posture: Opus policy remains policy metadata only; no provider fallback or API-key inference.
- Docs/examples: plan does not depend on chat history and marks live Opus proof out of scope.

## File Plan

- Modify `src/core/types.ts`
  - Add `SeniorReviewMode`, `SeniorReviewPolicyConfig`, `WorkflowRecord`, `WorkflowSlice`, `WorkflowConsensusRound`, `WorkflowReviewerVerdict`, `WorkflowUserEscalation`, `WorkflowOpusReviewEvidence`, and related provider-neutral types.
- Modify `src/core/config.ts`
  - Add default `seniorReview`.
  - Parse workspace config and env overrides.
  - Reject invalid modes.
- Modify `src/core/state/paths.ts`
  - Add `workflow` id safety helpers plus `workflowsDir` and `workflowRecordPath`.
- Create `src/core/state/workflow-store.ts`
  - Strict parser and atomic read/write/list functions for workflow records.
- Test `tests/core/config.test.ts`
  - Default senior review modes.
  - Workspace overrides.
  - Env overrides.
  - Invalid modes.
- Test `tests/core/state/workflow-store.test.ts`
  - Atomic write/read/list and corruption cases.
- Modify `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-51.md`
  - Mark complete and record verification after implementation.

## Task 1: Senior Review Config

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

- [ ] **Step 1: Write failing default config test**

Add a test asserting:

```ts
await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
  seniorReview: {
    opusPlanning: { mode: "required-when-available" },
    opusImplementation: { mode: "required-when-available" }
  }
});
```

- [ ] **Step 2: Run focused test and verify red**

Run:

```bash
npm test -- tests/core/config.test.ts
```

Expected: fail because `seniorReview` is not part of `AgentTeamConfig`.

- [ ] **Step 3: Add minimal senior review types and defaults**

Add:

```ts
export type SeniorReviewMode =
  | "disabled"
  | "optional"
  | "required-when-available"
  | "required-blocking";

export interface SeniorReviewPolicyConfig {
  readonly opusPlanning: { readonly mode: SeniorReviewMode };
  readonly opusImplementation: { readonly mode: SeniorReviewMode };
}
```

Then add `seniorReview: SeniorReviewPolicyConfig` to `AgentTeamConfig` and defaults in `DEFAULT_AGENT_TEAM_CONFIG`.

- [ ] **Step 4: Run focused test and verify green**

Run:

```bash
npm test -- tests/core/config.test.ts
```

Expected: pass for the new default test.

- [ ] **Step 5: Add failing workspace/env override tests**

Add tests for:

- workspace config sets planning `optional` and implementation `disabled`
- env sets planning `disabled` and implementation `optional` when workspace fields are absent
- workspace value wins over env value
- invalid mode rejects with `AgentTeamConfigError`

- [ ] **Step 6: Run focused test and verify red**

Run:

```bash
npm test -- tests/core/config.test.ts
```

Expected: fail because parser/env override support is missing.

- [ ] **Step 7: Implement parser and env override support**

Add a strict parser with supported values only. Use `process.env` by default and an optional env input only if tests need injection without mutating global env.

- [ ] **Step 8: Run focused test and verify green**

Run:

```bash
npm test -- tests/core/config.test.ts
```

Expected: all config tests pass.

## Task 2: Workflow Paths And Types

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/state/paths.ts`
- Test: `tests/core/state/workflow-store.test.ts`

- [ ] **Step 1: Write failing path/id tests**

Create tests proving:

- `workflowRecordPath(workspace, "workflow_123")` resolves to `.agent-team/workflows/workflow_123.json`
- unsafe ids such as `../runs/run_escape` throw before path resolution

- [ ] **Step 2: Run focused test and verify red**

Run:

```bash
npm test -- tests/core/state/workflow-store.test.ts
```

Expected: fail because workflow path helpers and store do not exist.

- [ ] **Step 3: Add workflow id path helpers**

Add `isSafeWorkflowId`, `workflowsDir`, and `workflowRecordPath` following the team path pattern.

- [ ] **Step 4: Add workflow record types**

Add provider-neutral types for:

- `WorkflowRecord`
- `WorkflowSlice`
- `WorkflowSliceState`
- `WorkflowConsensusRound`
- `WorkflowReviewerVerdict`
- `WorkflowUserEscalation`
- `WorkflowOpusReviewEvidence`
- `WorkflowIntegrationQueueItem`

- [ ] **Step 5: Run focused test and verify green**

Run:

```bash
npm test -- tests/core/state/workflow-store.test.ts
```

Expected: path/id tests pass once store imports compile.

## Task 3: Workflow Store

**Files:**

- Create: `src/core/state/workflow-store.ts`
- Test: `tests/core/state/workflow-store.test.ts`

- [ ] **Step 1: Write failing atomic write/read/list tests**

Test a valid workflow record with:

- `workflowId`
- `goal`
- `createdAt`
- `updatedAt`
- `seniorReview`
- `slices`
- `consensusRounds`
- `userEscalations`
- `opusReviewEvidence`
- `integrationQueue`
- `evidencePath`

Assert write/read equality and sorted listing by `createdAt` then `workflowId`.

- [ ] **Step 2: Run focused test and verify red**

Run:

```bash
npm test -- tests/core/state/workflow-store.test.ts
```

Expected: fail because store functions do not exist.

- [ ] **Step 3: Implement strict workflow parser and store**

Create:

```ts
export async function writeWorkflowRecord(workspaceRoot: string, record: WorkflowRecord): Promise<void>
export async function readWorkflowRecord(workspaceRoot: string, workflowId: string): Promise<WorkflowRecord>
export async function listWorkflowRecords(workspaceRoot: string): Promise<readonly WorkflowRecord[]>
```

Use `readJsonFile`, `writeJsonAtomic`, `StateCorruptionError`, and strict key validation.

- [ ] **Step 4: Run focused test and verify green**

Run:

```bash
npm test -- tests/core/state/workflow-store.test.ts
```

Expected: valid workflow read/write/list tests pass.

- [ ] **Step 5: Add failing corruption tests**

Add tests for:

- corrupt JSON
- unknown top-level key
- workflow id/file mismatch
- empty slices with invalid shape when present
- invalid slice state
- invalid reviewer verdict
- invalid Opus availability status
- unsafe workflow id

- [ ] **Step 6: Run focused test and verify red**

Run:

```bash
npm test -- tests/core/state/workflow-store.test.ts
```

Expected: fail until strict parser covers all cases.

- [ ] **Step 7: Implement corruption handling**

Reject invalid records with `StateCorruptionError` including `path` and `kind: "json"`.

- [ ] **Step 8: Run focused test and verify green**

Run:

```bash
npm test -- tests/core/state/workflow-store.test.ts
```

Expected: all workflow-store tests pass.

## Task 4: Verification And Integration

**Files:**

- Modify: `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-51.md`

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/state/workflow-store.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: pass.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 5: Run packaged stdio smoke**

Run:

```bash
npm run smoke:mcp-stdio
```

Expected: pass.

- [ ] **Step 6: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode" src tests docs
rg "benchmark|model-quality|mock LLM|embedding|heuristic|provider-ranking|auto-merge|auto-commit" src tests docs
rg "workflow|seniorReview|opusPlanning|opusImplementation|StateCorruptionError" src tests docs
```

Expected: matches are config, tests, docs, or explicit guardrails only.

- [ ] **Step 7: Run full CI gate**

Run:

```bash
npm run ci
```

Expected: pass.

- [ ] **Step 8: Update plan status and commit**

Update this plan with completed status, verification evidence, and any known limitations. Commit implementation with:

```bash
git add docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-51.md src tests
git commit -m "feat: add workflow state foundation"
```

## Live Provider Proof

Not required for this milestone. The milestone adds policy and durable state only; it does not claim real Opus sign-off, provider quality, or workflow execution behavior.

## Status

Planned.
