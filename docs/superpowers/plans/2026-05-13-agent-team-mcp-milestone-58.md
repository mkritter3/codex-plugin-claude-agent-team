# Agent Team MCP Milestone 58 Workflow Completion Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral `agent_team_workflow_report` tool that returns a read-only completion report for a durable workflow without claiming completion unless every required slice is integrated with final verification evidence.

**Architecture:** Keep reporting separate from planning, execution, review, integration, merge, and cleanup. The core service reads the durable workflow record, classifies each slice into integrated, ready-to-integrate, in-progress, blocked, failed, deferred, cancelled, or cleanup-ready categories, computes an explicit completion status, and returns sanitized evidence pointers plus a compact human-readable report. The MCP layer exposes only provider-neutral workflow/report controls and does not reveal prompts, secrets, raw provider payloads, command args, provider session ids, or provider-specific implementation details.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Zod schemas, Vitest, `.agent-team/` workflow state.

---

## Scope

In scope:

- Add a read-only workflow report core service:
  - validates safe workflow id
  - reads one durable workflow record
  - returns sanitized workflow view
  - computes `completionStatus` as `complete`, `incomplete`, or `blocked`
  - treats a slice as complete only when it is `integrated` and has at least one integration evidence item with final verification evidence
  - classifies approved queued slices as ready-to-integrate
  - classifies blocked, needs-revision, failed, cancelled, running, awaiting-review, ready, and planned states separately
  - identifies cleanup-ready integrated slices from cleanup recommendations and retained worktree paths
  - preserves per-slice addressability
  - records missing evidence reasons without mutating source checkout or workflow state
- Add public MCP tool:
  - `agent_team_workflow_report`
- Add packaged stdio smoke coverage for the new public tool.
- Update this plan with implementation and verification evidence.

Out of scope:

- No merge, patch application, cherry-pick, commit, push, branch delete, worktree delete, cleanup, provider call, workflow mutation, or state repair.
- No automatic workflow finalization.
- No model-quality, benchmark, provider-ranking, or capability claim.
- No provider-specific public schema fields.
- No raw provider payloads, private prompts, command args, secrets, provider session ids, or mailbox payloads in the public report.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for report core, MCP handlers, server registration, and package smoke coverage.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is not required because this milestone uses durable workflow state and does not claim real provider capability.

## Success Criteria

- `agent_team_workflow_report` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- Tool input accepts provider-neutral `workflowId`, optional `cwd`, and optional `includeWorkflow`.
- The service rejects unsafe workflow ids before state access.
- The service returns `completionStatus: "complete"` only when:
  - planning is approved
  - every workflow slice is `integrated`
  - every integrated slice has at least one integration evidence item
  - every integration evidence item used for completion has at least one verification result and all verification results pass
- The service returns `completionStatus: "blocked"` when any slice is blocked, failed, cancelled, or needs revision.
- The service returns `completionStatus: "incomplete"` for draft/planning workflows, ready/running/awaiting-review slices, approved queued slices, missing integration evidence, or missing final verification.
- Output preserves per-slice addressability with slice id, state, category, blockers, evidence paths, retained worktree path, and cleanup recommendation.
- Cleanup-ready slices are reported as recommendations only; no cleanup action is performed.
- Report text and structured output stay sanitized and provider-neutral.
- `includeWorkflow` defaults to true; when false, the report omits the full workflow view while preserving summary counts and per-slice rows.

## Required Edge Cases

Selected from the L11 matrix:

- Input validation: missing workflow id, unsafe workflow id, wrong primitive types.
- Workflow state: unapproved planning prevents completion claims, all integrated with evidence can complete, integrated without evidence remains incomplete, approved queued slices are ready-to-integrate but incomplete.
- Failure states: blocked, failed, cancelled, and needs-revision slices produce blocked report status with explicit reasons.
- Evidence safety: final verification must be present and passed; failed or skipped verification cannot complete the workflow.
- Cleanup boundaries: cleanup-ready is reported from evidence only and never invokes cleanup lifecycle methods.
- Public schema safety: no internal prompts, provider-specific implementation details, raw provider payloads, command args, secrets, provider session ids, or raw mailbox payloads.
- Packaged runtime: built `dist/index.js` advertises the new tool and required fields through `npm run smoke:mcp-stdio`.

## File Plan

- Create `src/core/workflow-report.ts`
  - Implement `buildWorkflowReport`.
  - Keep it read-only and deterministic.
- Modify `src/mcp/schemas.ts`
  - Add provider-neutral schema for `agent_team_workflow_report`.
- Modify `src/mcp/tools.ts`
  - Add tool name, parser, dependency injection, handler branch, and shared recovery.
- Modify `tests/core/workflow-report.test.ts`
  - Cover completion status, blocking states, incomplete evidence, cleanup-ready slices, and sanitized output.
- Modify `tests/mcp/tools.test.ts`
  - Cover metadata, validation fail-before-service, handler behavior, and recovery behavior.
- Modify `tests/mcp/server.test.ts`
  - Cover server registration and provider-neutral metadata.
- Modify `scripts/smoke-mcp-stdio.mjs`
  - Assert required fields for the new tool.
- Modify `tests/package-runtime.test.ts`
  - Cover package smoke assertion for the new tool.
- Modify `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
  - Mark Milestone 58 complete after implementation.
- Modify this plan
  - Mark complete and record verification evidence after implementation.

## Task 1: Workflow Report Core

**Files:**

- Create: `src/core/workflow-report.ts`
- Test: `tests/core/workflow-report.test.ts`

- [ ] **Step 1: Write failing core tests**

Add tests proving:

- a workflow with approved planning and all integrated slices with passing verification returns `completionStatus: "complete"`
- a workflow with approved queued slices returns `completionStatus: "incomplete"` and ready-to-integrate rows
- a workflow with failed, blocked, cancelled, or needs-revision slices returns `completionStatus: "blocked"`
- an integrated slice without integration evidence or without passing verification keeps the report incomplete
- cleanup-ready rows include retained worktree path and cleanup recommendation without invoking cleanup
- sanitized report output does not expose prompt/provider/secret internals

- [ ] **Step 2: Confirm red**

Expected failure:

- `npm test -- tests/core/workflow-report.test.ts`

- [ ] **Step 3: Implement core**

Implement:

- report row/category types
- completion status calculation
- cleanup-ready detection
- compact report text
- optional workflow view inclusion

- [ ] **Step 4: Confirm green**

Run:

- `npm test -- tests/core/workflow-report.test.ts`

## Task 2: MCP Tool Surface

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Test: `tests/mcp/tools.test.ts`
- Test: `tests/mcp/server.test.ts`
- Test: `tests/package-runtime.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add tests proving:

- `agent_team_workflow_report` metadata exists with provider-neutral required fields
- invalid input fails before service invocation
- handler calls the core service with workspace root, workflow id, and `includeWorkflow`
- handler recovery preserves sanitized error shape
- server registration includes the new tool
- packaged stdio smoke asserts the new tool and required fields

- [ ] **Step 2: Confirm red**

Expected failure:

- `npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts`

- [ ] **Step 3: Implement MCP surface**

Implement:

- schema definition
- metadata entry
- input parser
- dependency injection hook
- handler branch
- package smoke assertion

- [ ] **Step 4: Confirm green**

Run:

- `npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts`

## Task 3: Full Verification And Integration

**Files:**

- Modify: `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-58.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [ ] **Step 1: Run focused milestone verification**

- `npm test -- tests/core/workflow-report.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts`

- [ ] **Step 2: Run required verification**

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:mcp-stdio`
- `! rg -n "hiddenPrompt|internalPrompt|rawProvider|raw provider|providerPayload|provider payload|providerSessionId|commandArgs" src/core/workflow-report.ts src/mcp/schemas.ts src/mcp/tools.ts scripts/smoke-mcp-stdio.mjs`
- `! rg -n "mock LLM|heuristic LLM|heuristic.*benchmark|mock.*benchmark|provider-ranking|auto-merge|git merge|git cherry-pick|cleanupRunWorkspace" src/core/workflow-report.ts src/mcp/schemas.ts scripts/smoke-mcp-stdio.mjs`
- `npm run ci`

- [ ] **Step 3: Update evidence and roadmap**

Update:

- this plan's completed checkboxes
- roadmap current baseline to include Milestone 58 and `agent_team_workflow_report`

- [ ] **Step 4: Commit, merge, push, and clean up**

- Commit implementation on isolated branch.
- Merge to `main` only after verification passes.
- Push `main`.
- Remove temporary worktree and branch.

## Verification Evidence

Pending implementation.
