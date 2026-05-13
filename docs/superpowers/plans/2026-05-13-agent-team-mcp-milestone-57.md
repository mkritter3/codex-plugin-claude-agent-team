# Agent Team MCP Milestone 57 Integration Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral `agent_team_record_integration` tool that lets Codex record manually completed integration evidence, final verification results, slice integrated-state marking, integration queue state, and cleanup handoff boundaries without executing merges, commits, pushes, cleanup, or provider calls.

**Architecture:** Keep integration execution Codex-owned and outside the plugin. The plugin records durable evidence after Codex has manually integrated a queued slice and run verification. The core service validates workflow and slice state, requires an existing queue item, requires successful verification before marking a slice integrated, appends sanitized integration evidence, updates queue state, and returns a sanitized workflow view. Public MCP schemas remain provider-neutral and cannot expose prompts, secrets, raw provider payloads, command args, provider session ids, or implementation-specific internals.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Zod schemas, Vitest, `.agent-team/` workflow state.

---

## Scope

In scope:

- Add durable integration evidence to workflow slices:
  - integrated timestamp
  - integration method label
  - Codex-owned summary
  - changed files
  - verification commands and pass/fail/skipped results
  - evidence paths
  - retained worktree path
  - cleanup handoff recommendation
- Add core `recordWorkflowIntegration` service:
  - validates safe workflow id
  - validates approved planning
  - validates known slice id
  - requires a queued integration item for the slice
  - requires the slice to be `approved`
  - requires implementation evidence and retained worktree evidence
  - requires non-empty successful verification before marking integrated
  - appends sanitized integration evidence to the slice
  - marks the slice `integrated`
  - marks the matching queue item `integrated`
  - records queue-level final gate summary fields
  - leaves source checkout, worktrees, git state, sidecars, logs, and cleanup state untouched
- Add public MCP tool:
  - `agent_team_record_integration`
- Add packaged stdio smoke coverage for the new public tool.
- Update this plan with implementation and verification evidence.

Out of scope:

- No merge, patch application, cherry-pick, commit, push, branch delete, worktree delete, or cleanup.
- No automatic workflow completion claim across all slices.
- No live provider proof or model-quality claim.
- No provider-specific public schema fields.
- No raw provider payloads, private prompts, command args, secrets, or provider session ids in public workflow views.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for integration evidence core, workflow store/view strictness, MCP handlers, server registration, and package smoke coverage.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is not required because this milestone records Codex-owned local integration evidence and does not claim provider capability.

## Success Criteria

- `agent_team_record_integration` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- Tool input accepts provider-neutral `workflowId`, `sliceId`, optional `cwd`, `integrationMethod`, `summary`, `changedFiles`, `verification`, optional `evidencePaths`, optional `retainedWorktreePath`, and optional `cleanupRecommendation`.
- The tool rejects unsafe workflow ids, missing slice ids, unapproved planning, unknown slices, non-approved slices, slices without queued integration items, slices without implementation evidence, slices without retained worktree evidence, empty changed-file evidence, empty verification evidence, and failed final verification for integrated marking.
- Successful recording appends durable sanitized integration evidence to the slice and marks the slice `integrated`.
- Successful recording updates only the matching integration queue item to `integrated` while preserving queue order, per-slice addressability, conflict-risk evidence, review run ids, changed files, focused tests, and queued timestamp.
- Queue-level integration evidence includes final gate status, integrated timestamp, cleanup recommendation, and evidence paths.
- Cleanup remains a handoff recommendation only; no cleanup action is performed.
- Public workflow views expose only sanitized integration evidence and never expose internal prompts, provider-specific implementation details, raw provider payloads, command args, secrets, or provider session ids.
- Recording integration is idempotent-safe: repeated successful calls for an already integrated slice are rejected unless a future milestone adds explicit amendment semantics.

## Required Edge Cases

Selected from the L11 matrix:

- Input validation: missing workflow id, unsafe workflow id, missing slice id, wrong primitive types, empty arrays, malformed verification items.
- Workflow state: planning must be approved, slice must be approved, slice must already be queued, queue item must refer to the same slice.
- Final gates: integrated marking requires at least one verification command and every verification item must pass.
- Evidence safety: changed files, evidence paths, retained worktree path, cleanup recommendation, and summaries must be non-empty and sanitized through strict store parsing.
- Batch/workflow outputs: per-slice addressability is preserved through queue item state and slice integration evidence.
- Boundary safety: recording integration never calls providers, lifecycle methods, git merge, git cherry-pick, cleanup, source mutation, or delete operations.
- Public schema safety: no internal prompts, provider-specific implementation details, raw provider payloads, command args, secrets, or provider session ids.
- Packaged runtime: built `dist/index.js` advertises the new tool and required fields through `npm run smoke:mcp-stdio`.

## File Plan

- Modify `src/core/workflow-types.ts`
  - Add integration evidence types to slices and final gate fields to integration queue items.
- Modify `src/core/state/workflow-store.ts`
  - Strict-parse new slice integration evidence and queue final gate fields.
- Modify `src/core/workflow-view.ts`
  - Return sanitized integration evidence and queue final gate fields.
- Create `src/core/workflow-integration-evidence.ts`
  - Implement `recordWorkflowIntegration`.
  - Keep it state-only and deterministic.
- Modify `src/mcp/schemas.ts`
  - Add provider-neutral schema for `agent_team_record_integration`.
- Modify `src/mcp/tools.ts`
  - Add tool name, parser, dependency injection, handler branch, and shared recovery.
- Modify `scripts/smoke-mcp-stdio.mjs`
  - Assert required fields for the new tool.
- Test `tests/core/workflow-integration-evidence.test.ts`
  - Successful recording, queue update, rejection cases, and no source mutation behavior.
- Test `tests/core/state/workflow-store.test.ts`
  - Strict parsing for new integration evidence fields.
- Test `tests/core/workflow-view.test.ts`
  - Sanitized integration evidence output.
- Test `tests/mcp/tools.test.ts`
  - Metadata, validation fail-before-service, handler behavior, and recovery behavior.
- Test `tests/mcp/server.test.ts`
  - Server registration and provider-neutral metadata.
- Test `tests/package-runtime.test.ts`
  - Smoke script covers the new tool.
- Modify this plan
  - Mark complete and record verification evidence after implementation.

## Task 1: Integration Evidence Core

**Files:**

- Modify: `src/core/workflow-types.ts`
- Modify: `src/core/state/workflow-store.ts`
- Modify: `src/core/workflow-view.ts`
- Create: `src/core/workflow-integration-evidence.ts`
- Test: `tests/core/workflow-integration-evidence.test.ts`
- Test: `tests/core/state/workflow-store.test.ts`
- Test: `tests/core/workflow-view.test.ts`

- [ ] **Step 1: Write failing core tests**

Add tests proving:

- a queued approved slice with implementation evidence can be marked integrated only after successful verification
- the matching queue item is updated to `integrated` without reordering the queue
- integration evidence is appended to the slice with final gate commands, evidence paths, retained worktree path, and cleanup recommendation
- failed verification prevents integrated marking
- unknown slice ids, unapproved planning, non-approved slices, missing queue items, missing implementation evidence, and missing retained worktree evidence fail closed
- strict workflow parsing rejects unknown or malformed integration evidence fields
- sanitized workflow views expose only provider-neutral evidence

- [ ] **Step 2: Confirm red**

Expected failure:

- `npm test -- tests/core/workflow-integration-evidence.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts`

- [ ] **Step 3: Implement core**

Implement:

- integration evidence type definitions
- strict store parser updates
- sanitized view updates
- `recordWorkflowIntegration`

- [ ] **Step 4: Confirm green**

Run:

- `npm test -- tests/core/workflow-integration-evidence.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts`

## Task 2: MCP Tool Surface

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts` if needed by tool list registration
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Test: `tests/mcp/tools.test.ts`
- Test: `tests/mcp/server.test.ts`
- Test: `tests/package-runtime.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add tests proving:

- `agent_team_record_integration` metadata exists with provider-neutral required fields
- invalid input fails before service invocation
- handler calls the core service with workspace root and parsed evidence
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

- Modify: `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-57.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [ ] **Step 1: Run focused milestone verification**

- `npm test -- tests/core/workflow-integration-evidence.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts`

- [ ] **Step 2: Run required verification**

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:mcp-stdio`
- `npm run scan:invariants`
- `npm run ci`

- [ ] **Step 3: Update evidence and roadmap**

Update:

- this plan's completed checkboxes
- roadmap current baseline to include Milestone 57 and `agent_team_record_integration`

- [ ] **Step 4: Commit, merge, push, and clean up**

- Commit implementation on isolated branch.
- Merge to `main` only after verification passes.
- Push `main`.
- Remove temporary worktree and branch.

## Verification Evidence

Pending implementation.
