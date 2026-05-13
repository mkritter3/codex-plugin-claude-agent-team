# Agent Team MCP Milestone 52 Workflow Creation Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add the first public workflow-orchestrator surface: expanded L11 roles plus provider-neutral create/get/list workflow tools that persist a goal packet, richer initial slice DAG, Codex planning rationale, and sanitized workflow views without starting agents.

**Architecture:** Keep workflow creation as state orchestration only. The MCP layer validates provider-neutral inputs, core workflow helpers normalize roles, slice ids, blocked/ready state, senior-review policy, Codex-owned rationale, richer slice metadata, and durable evidence paths, and the existing workflow store remains the source of truth under `.agent-team/workflows/`.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Zod schemas, Vitest, `.agent-team/` durable workflow state.

---

## Scope

In scope:

- Expand the role roster to the L11 full-stack roles from `docs/superpowers/specs/2026-05-13-l11-agent-team-workflow-orchestrator-design.md`.
- Add core workflow creation helpers that build a valid `WorkflowRecord` from a goal packet and proposed slices.
- Add pure planning-state mechanics for blocked/ready derivation, Codex rationale records, and user-escalation placeholders without provider execution.
- Add a sanitized workflow view DTO for MCP responses so public tools never return the raw internal `WorkflowRecord`.
- Add public MCP tools:
  - `agent_team_create_workflow`
  - `agent_team_get_workflow`
  - `agent_team_list_workflows`
- Preserve provider-neutral public schemas with no Claude-specific tool fields.
- Record senior-review policy from resolved config at creation time.
- Set slice state deterministically:
  - slices with dependencies start as `blocked`
  - slices without dependencies start as `ready`
  - explicit initial state may only be `planned`, `blocked`, or `ready`
- Return sanitized workflow views with evidence pointers and slice metadata only.
- Add package stdio smoke coverage for the new public tools.
- Update this plan with implementation status and verification evidence.

Out of scope:

- No live Opus call.
- No consensus-round execution.
- No `agent_team_plan_consensus` tool.
- No automatic slice start.
- No mailbox unblock delivery.
- No implementation worktree creation.
- No integration queue computation beyond an empty initial queue.
- No model-quality, benchmark, provider-ranking, or coding-readiness claims.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for roles, workflow core, MCP handlers, server registration, and package smoke coverage.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is not required because this milestone creates durable workflow records only and makes no real senior-review/sign-off claim.

## Success Criteria

- `agent_team_list_roles` returns the expanded L11 role roster.
- Write-capable roles require `structuredOutput`, `tools`, `edits`, `sessionResume`, `cancellation`, and `workspaceIsolation`.
- Read-only roles keep conservative structured-output capability requirements.
- `agent_team_create_workflow` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- `agent_team_get_workflow` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- `agent_team_list_workflows` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- Create input accepts provider-neutral `goal`, `slices`, optional `name`, optional `cwd`, optional `workflowId`, and optional Codex-owned `rationale`.
- Slices support provider-neutral planning metadata: `readScope`, `expectedEvidence`, `riskLevel`, `requiredReviewers`, `integrationOrderHint`, and `blockedMode`.
- Create rejects empty goal fields, empty slices, duplicate slice ids, unsafe workflow ids, unsupported owner roles, unsupported initial states, missing dependency slice ids, self-dependencies, and empty acceptance-test/write-scope arrays.
- Create writes a valid `WorkflowRecord` under `.agent-team/workflows/<workflowId>.json`.
- Create records `seniorReview` from resolved config and leaves `opusReviewEvidence`, `consensusRounds`, `userEscalations`, and `integrationQueue` empty.
- Get rejects unsafe workflow ids before state path resolution and returns the stored workflow through shared corruption recovery.
- List returns workflow records sorted by `createdAt` then `workflowId`.
- Public MCP schemas and outputs return sanitized workflow views, not raw internal records, and do not expose internal prompts, provider session ids, raw provider payloads, secrets, provider command args, raw mailbox payloads, or provider-specific implementation details.
- The implementation introduces no API-key fallback, no live-provider calls, no auto-merge, no auto-commit, and no cleanup shortcut.

## Required Edge Cases

Selected from the L11 matrix:

- Input validation: missing required goal, empty strings, wrong primitive types, non-object child slices, empty arrays, duplicate ids, unsafe workflow ids, invalid role ids, invalid state, invalid risk level, invalid blocked mode, unknown dependency ids, self-dependencies.
- MCP handlers: validation returns `validation_error` before store writes; unknown tools remain explicit; injected dependencies are not called on invalid input.
- State stores: workflow creation uses the strict workflow store, corrupt workflow JSON is reported through existing recovery paths for get/list, and new slice metadata remains strict-parse protected.
- View safety: sanitized views exclude internal prompts, raw provider details, raw mailbox payloads, command args, and session internals.
- Packaged runtime: built `dist/index.js` advertises the new tools and required fields through `npm run smoke:mcp-stdio`.
- Docs/examples: no live-provider steps and no internal prompt details.

## File Plan

- Modify `src/core/types.ts`
  - Extend `RoleId` with the L11 role roster.
- Modify `src/core/roles.ts`
  - Add the expanded read-only and isolated-edit roles with capability requirements.
- Modify `src/core/workflow-types.ts`
  - Add richer slice metadata, Codex rationale records, workflow planning status, and user-escalation category metadata.
- Modify `src/core/state/workflow-store.ts`
  - Strict-parse the richer workflow metadata while preserving unknown-field rejection.
- Create `src/core/workflow-planning-state.ts`
  - Pure dependency state derivation, rationale append, and user-escalation placeholder helpers.
- Create `src/core/workflow-view.ts`
  - Map internal workflow records to sanitized MCP-safe view DTOs.
- Create `src/core/workflow-service.ts`
  - Add workflow creation input types.
  - Validate/normalize goal packets and slices.
  - Generate default workflow ids.
  - Call `writeWorkflowRecord`, `readWorkflowRecord`, and `listWorkflowRecords`.
  - Return sanitized workflow views for public callers.
- Modify `src/mcp/schemas.ts`
  - Add provider-neutral schemas and metadata for create/get/list workflow tools.
- Modify `src/mcp/tools.ts`
  - Add tool names, validation/parsing, handler branches, and recoverable state handling.
- Modify `scripts/smoke-mcp-stdio.mjs`
  - Assert the new packaged tools and required fields.
- Test `tests/core/roles.test.ts`
  - Expanded role roster and write-capable capability requirements.
- Test `tests/core/workflow-service.test.ts`
  - Workflow creation, role/dependency validation, senior-review capture, richer slice metadata, planning rationale, and sorted listing.
- Test `tests/core/workflow-planning-state.test.ts`
  - Dependency blocked/ready derivation, invalid transition rejection, Codex rationale recording, and user-escalation classification.
- Test `tests/core/workflow-view.test.ts`
  - Sanitized view excludes prompts, raw provider details, raw mailbox payloads, command args, and session internals.
- Test `tests/mcp/tools.test.ts`
  - Public metadata, validation fail-before-write, create/get/list handler behavior, sanitized view shape, and schema leakage guard.
- Test `tests/mcp/server.test.ts`
  - Server registration and provider-neutral metadata.
- Test `tests/package-runtime.test.ts`
  - Smoke script covers new tools.
- Modify this plan
  - Mark complete and record verification evidence after implementation.

## Task 1: Expanded L11 Role Roster

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/roles.ts`
- Test: `tests/core/roles.test.ts`

- [x] **Step 1: Write failing roster tests**

Add tests that assert the role list includes:

```ts
[
  "architect",
  "planner",
  "ui-ux-designer",
  "frontend-engineer",
  "backend-engineer",
  "slice-implementer",
  "code-reviewer",
  "test-designer",
  "qa-engineer",
  "test-hardening-engineer",
  "security-reviewer",
  "performance-reviewer",
  "devops-release-engineer",
  "docs-dx-writer",
  "integration-engineer"
]
```

Also assert `frontend-engineer`, `backend-engineer`, and `slice-implementer` use `isolated-edit` and require `edits` plus `workspaceIsolation`.

- [x] **Step 2: Run focused test and verify red**

Run:

```bash
npm test -- tests/core/roles.test.ts
```

Expected: fail because the expanded roster is not implemented.

- [x] **Step 3: Implement expanded roles**

Extend `RoleId` and `ROLES` with the L11 roster. Keep write-capable specialist roles capability-equivalent to `slice-implementer`.

- [x] **Step 4: Run focused test and verify green**

Run:

```bash
npm test -- tests/core/roles.test.ts
```

Expected: expanded role tests pass.

## Task 2: Workflow Service Core

**Files:**

- Create: `src/core/workflow-service.ts`
- Test: `tests/core/workflow-service.test.ts`

- [x] **Step 1: Write failing workflow creation tests**

Add tests proving:

- valid input writes a workflow record
- senior review policy is copied from config
- richer slice metadata is preserved
- Codex-owned rationale is recorded
- dependency-free slices become `ready`
- dependency-bearing slices become `blocked`
- get/list use sanitized workflow views

- [x] **Step 2: Write failing validation tests**

Add tests for duplicate slice ids, invalid owner role, unsafe workflow id, invalid initial state, invalid risk level, invalid blocked mode, missing dependency, self-dependency, empty write scope, empty expected evidence, and empty acceptance tests.

- [x] **Step 3: Run focused tests and verify red**

Run:

```bash
npm test -- tests/core/workflow-service.test.ts
```

Expected: fail because `workflow-service.ts` does not exist.

- [x] **Step 4: Implement workflow service**

Create:

```ts
export async function createWorkflow(input: CreateWorkflowInput): Promise<{ readonly workflow: WorkflowView }>
export async function getWorkflow(input: GetWorkflowInput): Promise<{ readonly workflow: WorkflowView }>
export async function listWorkflows(workspaceRoot: string): Promise<{ readonly workflows: readonly WorkflowView[] }>
```

Use strict validation, pure planning-state helpers, sanitized views, and the existing workflow store. Do not call providers or lifecycle.

- [x] **Step 5: Run focused tests and verify green**

Run:

```bash
npm test -- tests/core/workflow-service.test.ts tests/core/workflow-planning-state.test.ts tests/core/workflow-view.test.ts tests/core/state/workflow-store.test.ts
```

Expected: workflow service and store tests pass.

## Task 3: Public Workflow MCP Tools

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`
- Test: `tests/mcp/server.test.ts`

- [x] **Step 1: Write failing MCP metadata and validation tests**

Assert the new tool names, schemas, and validation behavior. Invalid `agent_team_create_workflow` inputs must return `validation_error` before injected workflow creation is called.

- [x] **Step 2: Run focused MCP tests and verify red**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: fail because workflow tools are not registered.

- [x] **Step 3: Implement schemas and handlers**

Add `agent_team_create_workflow`, `agent_team_get_workflow`, and `agent_team_list_workflows` to tool names, metadata, parsing, and handler dispatch. Use dependency injection for tests and shared recovery for store reads/writes.

- [x] **Step 4: Run focused MCP tests and verify green**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: MCP tests pass.

## Task 4: Package Smoke And Verification

**Files:**

- Modify: `scripts/smoke-mcp-stdio.mjs`
- Modify: `tests/package-runtime.test.ts`
- Modify: `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-52.md`

- [x] **Step 1: Write failing package-runtime smoke coverage test**

Assert `scripts/smoke-mcp-stdio.mjs` checks:

```js
assertToolRequires(tools.tools, "agent_team_create_workflow", ["goal", "slices"])
assertToolRequires(tools.tools, "agent_team_get_workflow", ["workflowId"])
assertObjectSchema(tools.tools, "agent_team_list_workflows")
```

- [x] **Step 2: Run package test and verify red**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: fail because the smoke script does not cover workflow tools.

- [x] **Step 3: Update smoke script**

Add required-field and invalid-input assertions for the new tools.

- [x] **Step 4: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/roles.test.ts tests/core/workflow-service.test.ts tests/core/workflow-planning-state.test.ts tests/core/workflow-view.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts
```

Expected: focused tests pass.

- [x] **Step 5: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

Expected: all pass.

- [x] **Step 6: Run invariant scans**

Run:

```bash
! rg -n "allowApiKeyFallback:\\s*true|apiKeyFallback\\s*:\\s*true" src .codex-plugin package.json
! rg -n "hiddenPrompt|internalPrompt|rawProvider|raw provider|providerPayload|provider payload" src/mcp src/core .codex-plugin
! rg -n "mock LLM|heuristic LLM|heuristic.*benchmark|mock.*benchmark|provider-ranking" src scripts .codex-plugin
rg -n "agent_team_create_workflow|agent_team_get_workflow|agent_team_list_workflows|WorkflowRecord|StateCorruptionError" src tests docs
```

Expected: no forbidden matches; workflow matches are implementation, tests, and docs only.

- [x] **Step 7: Update plan status and commit**

Update this plan with verification evidence and commit:

```bash
git add docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-52.md src tests scripts
git commit -m "feat: add workflow creation surface"
```

## Live Provider Proof

Not required for this milestone. This adds workflow state creation/read/list only and makes no real Opus sign-off, provider capability, benchmark, model-quality, or autonomous implementation claim.

## Status

Implemented in `codex/workflow-creation-surface`. This milestone remains state/MCP workflow creation only: no live providers, no Opus sign-off claim, no consensus execution, no slice starts, no auto-merge, and no cleanup behavior were introduced.

## Implementation Notes

- Expanded the provider-neutral role roster to 17 L11 roles while preserving conservative read-only capabilities and isolated-edit capability requirements for write-capable roles.
- Added richer workflow slice metadata, planning status, blocked modes, risk levels, and Codex rationale records.
- Added pure workflow planning helpers for initial blocked/ready derivation, Codex rationale appending, and user-escalation classification.
- Added sanitized workflow views so public MCP tools do not return raw internal workflow records.
- Added `agent_team_create_workflow`, `agent_team_get_workflow`, and `agent_team_list_workflows` with provider-neutral schemas and handler validation.
- Updated Claude agent-definition and health tests to account for the expanded roster.
- Updated packaged stdio smoke coverage for workflow tools.

## Verification Evidence

- Focused M52 tests passed: `npm test -- tests/core/roles.test.ts tests/core/workflow-service.test.ts tests/core/workflow-planning-state.test.ts tests/core/workflow-view.test.ts tests/core/state/workflow-store.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts` passed: 98 tests.
- Claude role-definition focused tests passed: `npm test -- tests/providers/claude-code-cli/agent-definition-store.test.ts tests/providers/claude-code-cli/runtime-health.test.ts tests/providers/claude-code-cli/doctor.test.ts` passed: 13 tests.
- `npm run typecheck` passed.
- `npm test` passed: 69 files, 528 tests.
- `npm run build` passed.
- `npm run install:check` passed.
- `npm run smoke:mcp-stdio` passed.
- `npm run smoke:package` passed.
- `npm run ci` passed.
- Invariant scan `! rg -n "allowApiKeyFallback:\s*true|apiKeyFallback\s*:\s*true" src .codex-plugin package.json` passed with no matches.
- Invariant scan `! rg -n "hiddenPrompt|internalPrompt|rawProvider|raw provider|providerPayload|provider payload" src/mcp src/core .codex-plugin` passed with no matches.
- Invariant scan `! rg -n "mock LLM|heuristic LLM|heuristic.*benchmark|mock.*benchmark|provider-ranking" src scripts .codex-plugin` passed with no matches.
- Workflow scan `rg -n "agent_team_create_workflow|agent_team_get_workflow|agent_team_list_workflows|WorkflowRecord|StateCorruptionError" src tests docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-52.md` showed only implementation, tests, and docs guardrail matches.
