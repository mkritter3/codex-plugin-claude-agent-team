# Agent Team MCP Milestone 55 Slice Review Consensus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral review consensus for implementation slices so Codex can record implementation evidence, reviewer verdicts, Opus implementation-review posture, and a slice-level approval decision before any integration queue or merge work begins.

**Architecture:** Keep M55 as a durable workflow review gate. `agent_team_review_slice` reads an approved workflow, records sanitized implementation evidence for one slice, appends a `review` consensus round, records Codex rationale and Opus implementation evidence, and transitions that slice to `approved`, `needs-revision`, `blocked`, or `awaiting-review` based on explicit reviewer verdicts and senior-review policy. No providers are invoked, no worktrees are merged or cleaned up, and no model-quality claims are made.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Zod schemas, Vitest, `.agent-team/` workflow state.

---

## Scope

In scope:

- Add sanitized implementation evidence to workflow slices:
  - changed files
  - evidence paths
  - tests run
  - source run id
  - retained worktree path
  - implementation summary and known risks
- Add sanitized slice review evidence:
  - review round
  - consensus status
  - reviewed timestamp
  - summary
  - reviewer run ids
- Add core `reviewWorkflowSlice` service:
  - validates workflow and slice ids
  - requires approved workflow planning before review
  - accepts slices in `running`, `awaiting-review`, or `needs-revision`
  - requires implementation evidence before approval
  - appends a `review` consensus round with ordered reviewer verdicts
  - uses the same 10-round default and 15-round extended rule as planning
  - records Codex rationale for the slice decision
  - records Opus implementation-review evidence using `seniorReview.opusImplementation`
  - treats `required-when-available` Opus unavailability as degraded evidence, not a hard block
  - treats `required-blocking` Opus unavailability as blocking
  - blocks approval on unresolved security, test-hardening, source-worktree, data-loss, or invariant blockers
  - records user escalations only for product/user-trust/security-risk/provider-cost/release-posture decisions
  - transitions the slice to `approved`, `needs-revision`, `blocked`, or `awaiting-review`
- Add public MCP tool:
  - `agent_team_review_slice`
- Add packaged stdio smoke coverage for the new public tool.
- Update this plan with implementation and verification evidence.

Out of scope:

- No live provider proof unless a later run makes real Opus sign-off claims.
- No automatic reviewer agent dispatch.
- No integration queue computation.
- No merge, cherry-pick, auto-commit, push, or cleanup.
- No provider-specific public schema fields.
- No raw provider payloads, private prompts, command args, secrets, or provider session ids in public workflow views.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for workflow review core, workflow store/view strictness, MCP handlers, server registration, and package smoke coverage.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are explicitly selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is not required because this milestone records injected review evidence and does not claim real provider capability.

## Success Criteria

- `agent_team_review_slice` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- Review input accepts provider-neutral `workflowId`, `sliceId`, optional `cwd`, optional `roundMode`, required `codexDecision`, required `verdicts`, optional `implementationEvidence`, optional `seniorReviewerEvidence`, and optional `userEscalations`.
- Review rejects unsafe workflow ids, unknown slice ids, unapproved planning, terminal/ineligible slice states, invalid verdict roles/statuses, invalid run ids, invalid round modes, and invalid escalation categories before state mutation.
- Review appends `phase: "review"` consensus rounds and tracks review rounds independently from planning rounds.
- Review round 11 through 15 require `roundMode: "extended"` and round 16 is rejected.
- `required-when-available` Opus unavailability records degraded implementation-review evidence without silently blocking forever.
- `required-blocking` Opus unavailability prevents approval.
- Approval requires Codex approval, implementation evidence, no unresolved blocking verdicts, and no blocking Opus policy failure.
- Test-hardening, security, source-worktree, data-loss, or invariant blockers prevent approval even if Codex attempts to approve.
- Revision verdicts or Codex revise decisions move the slice to `needs-revision`.
- Blocking verdicts or Codex block decisions move the slice to `blocked`.
- Round-15 unresolved material disagreement records user escalation only when it belongs to the user decision filter.
- Public MCP schemas and workflow views expose sanitized evidence pointers only.

## Required Edge Cases

Selected from the L11 matrix:

- Input validation: missing workflow id, unsafe workflow id, missing slice id, unknown slice id, invalid run id, empty changed files/tests/evidence paths, invalid round mode, unsupported verdict status, unsupported reviewer role, technical user escalation category.
- Workflow state: planning must be approved, review rounds are phase-local, review cannot approve without implementation evidence, review can continue from `needs-revision`.
- Senior review: default `required-when-available`, unavailable degraded posture, blocking mode failure, skipped/disabled posture.
- Review blocking: security reviewer block, test-hardening block, source-worktree/data-loss concern in Codex decision category or blocker summary.
- Public boundary: schemas remain provider-neutral and workflow views omit raw payloads, prompts, command args, secrets, and provider session ids.
- Packaged runtime: built `dist/index.js` advertises the new tool and required fields through `npm run smoke:mcp-stdio`.

## File Plan

- Modify `src/core/workflow-types.ts`
  - Add `WorkflowSliceImplementationEvidence` and `WorkflowSliceReviewEvidence`.
  - Add optional `implementationEvidence` and `reviewEvidence` to `WorkflowSlice`.
- Modify `src/core/state/workflow-store.ts`
  - Strict-parse the new optional slice evidence fields and reject unknown fields.
- Modify `src/core/workflow-view.ts`
  - Return sanitized implementation/review evidence.
- Create `src/core/workflow-review.ts`
  - Implement `reviewWorkflowSlice`.
  - Reuse existing workflow state readers, Codex rationale classification, and workflow view conversion.
- Modify `src/mcp/schemas.ts`
  - Add provider-neutral schema for `agent_team_review_slice`.
- Modify `src/mcp/tools.ts`
  - Add tool name, parser, dependency injection, handler branch, and shared recovery.
- Modify `scripts/smoke-mcp-stdio.mjs`
  - Assert required fields for the new tool.
- Test `tests/core/workflow-review.test.ts`
  - Review consensus state transitions, 10/15-round behavior, Opus policy, blockers, escalation filtering, and implementation evidence requirements.
- Test `tests/core/state/workflow-store.test.ts`
  - Strict parsing for implementation/review evidence fields.
- Test `tests/core/workflow-view.test.ts`
  - Sanitized evidence output.
- Test `tests/mcp/tools.test.ts`
  - Metadata, validation fail-before-service, handler behavior, and recovery behavior.
- Test `tests/mcp/server.test.ts`
  - Server registration and provider-neutral metadata.
- Test package smoke coverage.
- Modify this plan
  - Mark complete and record verification evidence after implementation.

## Task 1: Workflow Review Core

**Files:**

- Modify: `src/core/workflow-types.ts`
- Modify: `src/core/state/workflow-store.ts`
- Modify: `src/core/workflow-view.ts`
- Create: `src/core/workflow-review.ts`
- Test: `tests/core/workflow-review.test.ts`
- Test: `tests/core/state/workflow-store.test.ts`
- Test: `tests/core/workflow-view.test.ts`

- [x] **Step 1: Write failing core tests**

Add tests proving:

- approved workflow plus implementation evidence plus approving verdicts marks a slice `approved`
- review rounds are phase-local and do not count planning rounds
- round 11 requires extended mode and round 16 is rejected
- missing implementation evidence prevents approval
- `required-when-available` Opus unavailable records degraded implementation evidence and still allows Codex approval
- `required-blocking` Opus unavailable blocks approval
- security and test-hardening blockers prevent approval
- revise decisions mark the slice `needs-revision`
- block decisions mark the slice `blocked`
- round-15 unresolved user-level disagreement records a user escalation
- technical user escalations are rejected as Codex-owned

- [x] **Step 2: Run focused tests and verify red**

Run:

```bash
npm test -- tests/core/workflow-review.test.ts
```

Expected: fail because `workflow-review.ts` does not exist.

- [x] **Step 3: Implement workflow review service and evidence parsing**

Create:

```ts
export async function reviewWorkflowSlice(input: ReviewWorkflowSliceInput): Promise<{ readonly workflow: WorkflowView }>
```

Use `readWorkflowRecord`, `writeWorkflowRecord`, `appendCodexRationale`, `classifyUserEscalation`, and `toWorkflowView`. Do not call providers directly.

- [x] **Step 4: Run focused tests and verify green**

Run:

```bash
npm test -- tests/core/workflow-review.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts
```

Expected: workflow review, store, and view tests pass.

## Task 2: Public MCP Tool

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`
- Test: `tests/mcp/server.test.ts`

- [x] **Step 1: Write failing MCP tests**

Add tests proving:

- `agent_team_review_slice` appears in tool metadata and server registration
- required schema fields are present
- invalid inputs return `validation_error` before injected services are called
- valid inputs delegate to injected service and return sanitized workflow/results
- state corruption is routed through shared recovery behavior

- [x] **Step 2: Run focused MCP tests and verify red**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: fail because the tool is not registered.

- [x] **Step 3: Implement MCP schema and handler**

Add the tool to names, metadata, parser helpers, dependency injection, and handler dispatch. Keep public schema provider-neutral.

- [x] **Step 4: Run focused MCP tests and verify green**

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

- [x] **Step 1: Write failing smoke coverage**

Assert packaged MCP metadata includes `agent_team_review_slice` and required fields.

- [x] **Step 2: Run focused smoke tests and verify red**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: fail until the smoke script and schemas are updated.

- [x] **Step 3: Implement smoke coverage**

Update packaged stdio smoke assertions.

- [x] **Step 4: Run focused smoke tests and verify green**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: package runtime smoke test passes.

## Verification Plan

Run before integration:

```bash
npm test -- tests/core/workflow-review.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
npm test -- tests/package-runtime.test.ts
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
rg -n "benchmark|model-quality|raw provider|provider session|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_API_KEY|auto-merge|git merge|git cherry-pick" src tests docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-55.md
npm run ci
```

Live provider proof: not required for M55 unless the implementation claims real Opus sign-off behavior. This milestone proves policy mechanics, state transitions, and public MCP contracts with fixture evidence only.

## Verification Evidence

Completed in isolated worktree `.worktrees/codex/workflow-slice-review`:

```bash
npm test -- tests/core/workflow-review.test.ts
npm test -- tests/core/workflow-review.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
npm test -- tests/package-runtime.test.ts
npm test -- tests/core/workflow-review.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
rg -n "benchmark|model-quality|raw provider|provider session|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_API_KEY|auto-merge|git merge|git cherry-pick" src tests docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-55.md
npm run ci
```

Results:

- Focused tests: 96 focused tests passed across workflow review, store/view, MCP tools/server, and package-runtime suites.
- Full tests: 72 files and 557 tests passed.
- Typecheck, build, install check, packaged stdio smoke, package smoke, and `npm run ci` passed.
- Invariant scan found expected historical/docs/test/provider configuration references only; M55 public schemas and workflow views remain provider-neutral and sanitized.
- No live provider proof was run or required because M55 records fixture review evidence and does not make real Opus/model capability claims.
