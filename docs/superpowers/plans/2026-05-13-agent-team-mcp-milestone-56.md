# Agent Team MCP Milestone 56 Integration Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral `agent_team_integration_queue` tool that turns approved workflow slices into a durable, read-only integration order and conflict-risk report without merging, committing, cleaning up, or deleting evidence.

**Architecture:** Keep integration planning separate from integration execution. The core service reads the durable workflow record, validates that planning is approved and slice reviews are complete, computes an ordered queue from approved slices using dependency graph, `integrationOrderHint`, write-scope overlap, test cost, and implementation worktree evidence, persists sanitized queue/report evidence to the workflow record, and returns a sanitized workflow view plus report. The MCP layer exposes only provider-neutral workflow/slice inputs and never emits provider prompts, command args, secrets, raw payloads, or provider session ids.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Zod schemas, Vitest, `.agent-team/` workflow state.

---

## Scope

In scope:

- Add integration queue evidence to workflow records:
  - queue item ordering
  - conflict risk level
  - risk reasons
  - focused test recommendations
  - source implementation worktree path
  - changed files
  - dependency slice ids
  - review run ids
- Add core `buildWorkflowIntegrationQueue` service:
  - validates safe workflow id and approved planning
  - accepts optional explicit `sliceIds`
  - selects only `approved` slices
  - rejects slices without implementation evidence or retained worktree path
  - rejects slices with incomplete dependencies that are not `approved` or `integrated`
  - preserves per-slice addressability
  - orders by dependency graph, then `integrationOrderHint`, then risk level, then slice id
  - detects write-scope and changed-file overlap against earlier queued items
  - produces deterministic conflict-risk report
  - persists queue metadata into `workflow.integrationQueue`
  - leaves source checkout, worktrees, git state, sidecars, logs, and cleanup state untouched
- Add public MCP tool:
  - `agent_team_integration_queue`
- Add packaged stdio smoke coverage for the new public tool.
- Update this plan with implementation and verification evidence.

Out of scope:

- No merge, cherry-pick, manual patch application, auto-commit, push, or cleanup.
- No live provider proof or model-quality claim.
- No automatic `integration-engineer` dispatch.
- No filesystem diff reading in v1 of the queue; this milestone uses durable implementation/review evidence already recorded in workflow state.
- No provider-specific public schema fields.
- No raw provider payloads, private prompts, command args, secrets, or provider session ids in public workflow views.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for integration queue core, workflow store/view strictness, MCP handlers, server registration, and package smoke coverage.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is not required because this milestone uses durable fixture workflow evidence and does not claim real provider capability.

## Success Criteria

- `agent_team_integration_queue` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- Tool input accepts provider-neutral `workflowId`, optional `cwd`, and optional `sliceIds`.
- The tool rejects unsafe workflow ids, unknown slice ids, duplicate slice ids, unapproved planning, non-approved selected slices, approved slices without implementation evidence, approved slices without retained worktree path, and dependencies that are neither `approved` nor `integrated`.
- Queue ordering is deterministic:
  - dependencies before dependents
  - lower `integrationOrderHint` before unset or higher hints
  - lower risk before higher risk when dependency/hint ties remain
  - slice id as final tie-breaker
- Queue output preserves per-slice addressability and includes queue position, slice id, state, worktree path, branch name, review run ids, changed files, dependency slice ids, focused test recommendations, conflict risk, and risk reasons.
- Write-scope or changed-file overlap with earlier queued items raises conflict risk and produces explicit reasons.
- Existing integrated slices are excluded from newly queued items but can satisfy dependencies.
- Blocked, failed, needs-revision, awaiting-review, running, or cancelled slices are reported as excluded, not silently queued.
- The service persists sanitized `workflow.integrationQueue` state without source checkout mutation.
- The public MCP schema and workflow view expose only sanitized evidence pointers and recommendations.

## Required Edge Cases

Selected from the L11 matrix:

- Input validation: missing workflow id, unsafe workflow id, unknown slice ids, duplicate slice ids, empty explicit selection, wrong primitive types.
- Workflow state: planning must be approved, only approved slices queue, integrated dependency satisfies dependent, needs-revision/blocked slices are excluded.
- Dependency DAG: dependency ordering, missing dependency id corruption/validation, dependency cycle detection if approved selected slices form a cycle.
- Batch/workflow outputs: ordered per-item results, per-slice addressability, partial exclusion evidence.
- Boundary safety: queue computation never calls providers, lifecycle methods, git merge, git cherry-pick, cleanup, or source mutation.
- Public schema safety: no internal prompts, provider-specific implementation details, raw provider payloads, command args, secrets, or provider session ids.
- Packaged runtime: built `dist/index.js` advertises the new tool and required fields through `npm run smoke:mcp-stdio`.

## File Plan

- Modify `src/core/workflow-types.ts`
  - Add queue/report fields to `WorkflowIntegrationQueueItem` while preserving existing queue states.
- Modify `src/core/state/workflow-store.ts`
  - Strict-parse new integration queue fields and reject unknown fields.
- Modify `src/core/workflow-view.ts`
  - Return sanitized integration queue items.
- Create `src/core/workflow-integration-queue.ts`
  - Implement `buildWorkflowIntegrationQueue`.
  - Keep it state-only and deterministic.
- Modify `src/mcp/schemas.ts`
  - Add provider-neutral schema for `agent_team_integration_queue`.
- Modify `src/mcp/tools.ts`
  - Add tool name, parser, dependency injection, handler branch, and shared recovery.
- Modify `scripts/smoke-mcp-stdio.mjs`
  - Assert required fields for the new tool.
- Test `tests/core/workflow-integration-queue.test.ts`
  - Queue ordering, exclusions, conflict risk, dependency validation, persistence, and no source mutation behavior.
- Test `tests/core/state/workflow-store.test.ts`
  - Strict parsing for expanded integration queue fields.
- Test `tests/core/workflow-view.test.ts`
  - Sanitized queue output.
- Test `tests/mcp/tools.test.ts`
  - Metadata, validation fail-before-service, handler behavior, and recovery behavior.
- Test `tests/mcp/server.test.ts`
  - Server registration and provider-neutral metadata.
- Test `tests/package-runtime.test.ts`
  - Smoke script covers the new tool.
- Modify this plan
  - Mark complete and record verification evidence after implementation.

## Task 1: Integration Queue Core

**Files:**

- Modify: `src/core/workflow-types.ts`
- Modify: `src/core/state/workflow-store.ts`
- Modify: `src/core/workflow-view.ts`
- Create: `src/core/workflow-integration-queue.ts`
- Test: `tests/core/workflow-integration-queue.test.ts`
- Test: `tests/core/state/workflow-store.test.ts`
- Test: `tests/core/workflow-view.test.ts`

- [ ] **Step 1: Write failing core tests**

Add tests proving:

- approved slices with implementation evidence and worktree paths are queued in deterministic dependency/hint/risk/slice order
- integrated slices are excluded from queue but satisfy dependencies
- explicit `sliceIds` preserves selected queue scope while still enforcing dependencies
- non-approved selected slices reject with a clear validation error
- approved slices without implementation evidence or worktree path reject before mutation
- unresolved dependency states reject before mutation
- write-scope and changed-file overlaps raise conflict risk and record risk reasons
- dependency cycles are rejected before mutation
- queue state is persisted to the workflow record
- returned workflow output does not contain prompts, secrets, raw provider payloads, command args, or provider session ids

- [ ] **Step 2: Run focused tests and verify red**

Run:

```bash
npm test -- tests/core/workflow-integration-queue.test.ts
```

Expected: fail because `workflow-integration-queue.ts` does not exist.

- [ ] **Step 3: Implement integration queue service and evidence parsing**

Create:

```ts
export async function buildWorkflowIntegrationQueue(input: BuildWorkflowIntegrationQueueInput): Promise<BuildWorkflowIntegrationQueueResult>
```

Use `readWorkflowRecord`, `writeWorkflowRecord`, and `toWorkflowView`. Do not call providers, lifecycle methods, git commands, cleanup, or filesystem diff readers.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```bash
npm test -- tests/core/workflow-integration-queue.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts
```

Expected: integration queue, store, and view tests pass.

## Task 2: Public MCP Tool

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`
- Test: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add tests proving:

- `agent_team_integration_queue` appears in tool metadata and server registration
- required schema fields are present
- invalid inputs return `validation_error` before injected services are called
- valid inputs delegate to injected service and return sanitized queue/report/workflow results
- state corruption is routed through shared recovery behavior

- [ ] **Step 2: Run focused MCP tests and verify red**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: fail because the tool is not registered.

- [ ] **Step 3: Implement MCP schema and handler**

Add the tool to names, metadata, parser helpers, dependency injection, and handler dispatch. Keep public schema provider-neutral.

- [ ] **Step 4: Run focused MCP tests and verify green**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: MCP tests pass.

## Task 3: Package Smoke And Gates

**Files:**

- Modify: `scripts/smoke-mcp-stdio.mjs`
- Test: `tests/package-runtime.test.ts`
- Modify: this plan

- [ ] **Step 1: Write failing smoke coverage**

Assert packaged MCP metadata includes `agent_team_integration_queue` and required fields.

- [ ] **Step 2: Run focused smoke tests and verify red**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: fail until the smoke script and schemas are updated.

- [ ] **Step 3: Implement smoke coverage**

Update packaged stdio smoke assertions.

- [ ] **Step 4: Run focused smoke tests and verify green**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: package runtime smoke test passes.

## Verification Plan

Run before integration:

```bash
npm test -- tests/core/workflow-integration-queue.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
npm test -- tests/package-runtime.test.ts
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
rg -n "benchmark|model-quality|raw provider|provider session|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_API_KEY|auto-merge|git merge|git cherry-pick|cleanupRunWorkspace" src tests docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-56.md
npm run ci
```

Live provider proof: not required for M56 unless the implementation claims real provider integration or real Opus sign-off behavior. This milestone proves deterministic queue mechanics, state transitions, and public MCP contracts with durable fixture evidence only.

