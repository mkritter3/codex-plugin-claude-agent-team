# Agent Team MCP Milestone 54 Slice Start And Unblock Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first actionable slice-DAG orchestration surface: start approved ready workflow slices with bounded concurrency, and record dependency-unblock evidence for blocked slices without auto-merging or deleting evidence.

**Architecture:** Keep Codex as the orchestrator and use existing lifecycle/mailbox primitives instead of creating a parallel runner. `agent_team_start_slices` reads a durable workflow, validates planning approval and ready slice state, delegates each selected slice to the existing lifecycle `startRun`, updates the workflow slice state with run evidence, and preserves ordered per-slice partial-failure results. `agent_team_unblock_slice` records provider-neutral dependency evidence, transitions a blocked slice to ready only when all dependencies are approved or integrated, and optionally delivers a bounded mailbox notification to existing prep/wait run ids.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Zod schemas, Vitest, existing lifecycle registry, `.agent-team/` workflow state.

---

## Scope

In scope:

- Add workflow slice implementation evidence fields to the durable workflow record.
- Add provider-neutral unblock evidence records.
- Add core `startWorkflowSlices` service:
  - requires `planningStatus: "approved"`
  - starts only `ready` slices
  - supports explicit slice ids or all ready slices
  - uses bounded concurrency
  - delegates to existing lifecycle `startRun`
  - preserves ordered per-slice results
  - records successful run ids and execution evidence on the slice
  - records failed start evidence without dropping later slices
- Add core `unblockWorkflowSlice` service:
  - records dependency evidence
  - verifies dependency slice ids exist
  - marks dependencies as satisfied when dependency slices are `approved` or `integrated`, or when explicit unblock evidence is provided
  - transitions target slice to `ready` only when all dependencies are satisfied
  - optionally sends a mailbox message to provided prep/wait run ids using existing lifecycle `messageRun`
  - preserves ordered notification results and partial failures
- Add public MCP tools:
  - `agent_team_start_slices`
  - `agent_team_unblock_slice`
- Add packaged stdio smoke coverage for the new public tools.
- Update this plan with implementation and verification evidence.

Out of scope:

- No live provider proof or model-quality claim.
- No automatic planning consensus execution.
- No review consensus.
- No integration queue computation.
- No auto-merge, auto-commit, or cleanup.
- No automatic prep-then-wait read-only run creation in this milestone.
- No provider-specific public schema fields.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for workflow slice core, workflow store/view strictness, MCP handlers, server registration, and package smoke coverage.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is not required because tests use injected lifecycle fixtures and do not claim real-provider capability.

## Success Criteria

- `agent_team_start_slices` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- `agent_team_unblock_slice` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- Start-slices input accepts provider-neutral `workflowId`, optional `cwd`, optional `sliceIds`, optional `provider`, optional `timeoutMs`, and optional `concurrency`.
- Start-slices rejects unapproved workflows, empty ready selection, unknown slice ids, duplicate slice ids, non-ready selected slices, invalid concurrency, and invalid cwd before lifecycle invocation.
- Start-slices preserves input/workflow order, bounded concurrency, per-slice addressability, and partial failures.
- Successful slice starts update that slice to `running`, append the run id, and preserve sidecar/log/execution evidence returned by lifecycle.
- Failed slice starts update that slice to `failed` with failure evidence while later slices still run.
- Unblock input accepts provider-neutral `workflowId`, `sliceId`, dependency evidence, optional `notifyRunIds`, optional `message`, optional `correlationId`, optional `cwd`, and optional `concurrency`.
- Unblock rejects unknown workflow/slice/dependency ids, non-blocked target slices, empty evidence summaries, invalid run ids, invalid notification run ids, and invalid concurrency before side effects.
- Unblock records evidence on the target slice and moves it to `ready` only when all dependencies are satisfied.
- If not all dependencies are satisfied, target slice remains `blocked`.
- Optional notification uses existing lifecycle `messageRun`, preserves order, and returns partial-failure evidence.
- Public MCP schemas and workflow views expose only sanitized run/evidence pointers, not prompts, secrets, raw provider payloads, command args, or provider session ids.

## Required Edge Cases

Selected from the L11 matrix:

- Input validation: missing workflow id, unsafe workflow id, unknown slice ids, duplicate slice ids, empty slice selection, invalid concurrency, invalid run ids, empty evidence summary, wrong primitive types.
- MCP handlers: validation returns `validation_error` before lifecycle/store invocation; unknown tools remain explicit; injected dependencies are not called on invalid input.
- Batch/workflow tools: bounded concurrency, ordered per-item results, partial failure, per-slice status, and per-run/per-slice addressability.
- Lifecycle safety: start-slices delegates to existing lifecycle start; unblock notification delegates to existing lifecycle message; neither tool cancels, winds down, cleans up, or merges.
- Workspace safety: implementation write isolation remains lifecycle/provider-policy owned; workflow tooling records evidence only.
- State stores: strict parse new slice evidence fields, reject unknown fields, and surface corrupt workflow JSON through shared recovery.
- Packaged runtime: built `dist/index.js` advertises new tools and required fields through `npm run smoke:mcp-stdio`.
- Boundary safety: public schemas and workflow views remain sanitized.

## File Plan

- Modify `src/core/workflow-types.ts`
  - Add `WorkflowSliceRunEvidence`, `WorkflowSliceStartFailureEvidence`, and `WorkflowSliceUnblockEvidence`.
  - Add optional `runIds`, `runEvidence`, `startFailureEvidence`, and `unblockEvidence` to `WorkflowSlice`.
- Modify `src/core/state/workflow-store.ts`
  - Strict-parse the new optional slice evidence fields.
- Modify `src/core/workflow-view.ts`
  - Return sanitized slice run/unblock evidence without provider internals.
- Create `src/core/workflow-slices.ts`
  - Implement `startWorkflowSlices` and `unblockWorkflowSlice`.
  - Reuse existing lifecycle-like `startRun` and `messageRun` dependencies.
  - Preserve bounded concurrency and ordered results.
- Modify `src/mcp/schemas.ts`
  - Add provider-neutral schemas for `agent_team_start_slices` and `agent_team_unblock_slice`.
- Modify `src/mcp/tools.ts`
  - Add tool names, parsers, dependency injection, handler branches, and shared recovery.
- Modify `scripts/smoke-mcp-stdio.mjs`
  - Assert required fields for both new tools.
- Test `tests/core/workflow-slices.test.ts`
  - Start/unblock state transitions, ordered concurrency, partial failures, validation, and notification behavior.
- Test `tests/core/state/workflow-store.test.ts`
  - Strict parsing for new evidence fields.
- Test `tests/core/workflow-view.test.ts`
  - Sanitized evidence output.
- Test `tests/mcp/tools.test.ts`
  - Metadata, validation fail-before-service, handler behavior, and recovery behavior.
- Test `tests/mcp/server.test.ts`
  - Server registration and provider-neutral metadata.
- Test `tests/package-runtime.test.ts`
  - Smoke script covers the new tools.
- Modify this plan
  - Mark complete and record verification evidence after implementation.

## Task 1: Workflow Slice Core

**Files:**

- Modify: `src/core/workflow-types.ts`
- Modify: `src/core/state/workflow-store.ts`
- Modify: `src/core/workflow-view.ts`
- Create: `src/core/workflow-slices.ts`
- Test: `tests/core/workflow-slices.test.ts`
- Test: `tests/core/state/workflow-store.test.ts`
- Test: `tests/core/workflow-view.test.ts`

- [ ] **Step 1: Write failing core tests**

Add tests proving:

- unapproved workflows reject before `startRun`
- ready slices start in workflow order with bounded concurrency
- selected duplicate or unknown slice ids reject before `startRun`
- non-ready selected slices reject before `startRun`
- successful starts mark slices `running` and append run evidence
- failed starts mark only those slices `failed` and do not stop later slices
- unblock evidence keeps a slice blocked until all dependencies are satisfied
- unblock evidence moves a slice to ready when all dependencies are satisfied
- notification run ids receive ordered mailbox messages through injected `messageRun`
- notification partial failures are returned without losing durable unblock evidence

- [ ] **Step 2: Run focused tests and verify red**

Run:

```bash
npm test -- tests/core/workflow-slices.test.ts
```

Expected: fail because `workflow-slices.ts` does not exist.

- [ ] **Step 3: Implement workflow slice services**

Create:

```ts
export async function startWorkflowSlices(input: StartWorkflowSlicesInput, deps: StartWorkflowSlicesDependencies): Promise<StartWorkflowSlicesResult>
export async function unblockWorkflowSlice(input: UnblockWorkflowSliceInput, deps: UnblockWorkflowSliceDependencies): Promise<UnblockWorkflowSliceResult>
```

Use `readWorkflowRecord`, `writeWorkflowRecord`, existing lifecycle dependency functions, and `toWorkflowView`. Do not call providers directly.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```bash
npm test -- tests/core/workflow-slices.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts
```

Expected: workflow slice, store, and view tests pass.

## Task 2: Public MCP Tools

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`
- Test: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add tests proving:

- `agent_team_start_slices` and `agent_team_unblock_slice` appear in tool metadata and server registration
- required schema fields are present
- invalid inputs return `validation_error` before injected services are called
- valid inputs delegate to injected services and return sanitized workflow/results
- state corruption is routed through shared recovery behavior

- [ ] **Step 2: Run focused MCP tests and verify red**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: fail because the tools are not registered.

- [ ] **Step 3: Implement MCP schema and handlers**

Add both tools to names, metadata, parser helpers, dependency injection, and handler dispatch. Keep public schema provider-neutral.

- [ ] **Step 4: Run focused MCP tests and verify green**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: MCP tool tests pass.

## Task 3: Packaged Smoke And Verification

**Files:**

- Modify: `scripts/smoke-mcp-stdio.mjs`
- Test: `tests/package-runtime.test.ts`
- Modify: this plan

- [ ] **Step 1: Write failing package-runtime test**

Assert the packaged smoke script checks required fields for `agent_team_start_slices` and `agent_team_unblock_slice`.

- [ ] **Step 2: Run package-runtime test and verify red**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: fail because the smoke script does not cover the new tools.

- [ ] **Step 3: Update stdio smoke**

Add:

```js
assertToolRequires(tools.tools, "agent_team_start_slices", ["workflowId"]);
assertToolRequires(tools.tools, "agent_team_unblock_slice", [
  "workflowId",
  "sliceId",
  "dependencyEvidence"
]);
```

- [ ] **Step 4: Run full milestone verification**

Run:

```bash
npm test -- tests/core/workflow-slices.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

- [ ] **Step 5: Run invariant scans**

Run:

```bash
! rg -n "allowApiKeyFallback:\s*true|apiKeyFallback\s*:\s*true" src .codex-plugin package.json
! rg -n "hiddenPrompt|internalPrompt|rawProvider|raw provider|providerPayload|provider payload" src/mcp src/core .codex-plugin
! rg -n "mock LLM|heuristic LLM|heuristic.*benchmark|mock.*benchmark|provider-ranking" src scripts .codex-plugin
rg -n "agent_team_start_slices|agent_team_unblock_slice|WorkflowSliceRunEvidence|WorkflowSliceUnblockEvidence|StateCorruptionError" src tests docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-54.md
```

Expected: the negated scans return no matches; the workflow scan shows only implementation, tests, and docs guardrail matches.

- [ ] **Step 6: Mark plan complete and commit**

Update this plan with the implementation summary and verification evidence, then commit the milestone implementation.

