# Agent Team MCP Milestone 60 Workflow Orchestrator Packaged Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixture-safe packaged MCP smoke that drives the L11 workflow orchestrator public tool loop end-to-end without live provider calls.

**Architecture:** Keep this as a packaged-boundary smoke and test milestone. A new Node smoke script launches `dist/index.js` over MCP stdio, creates a disposable git workspace, drives workflow creation, planning consensus, blocked/unblocked slice transitions, review, integration queue, integration evidence recording, final completion reporting, and state inspection through public MCP tools. Because `agent_team_start_slices` intentionally starts provider-backed runs, the fixture smoke seeds disposable workflow state to represent provider-completed implementation handoff before continuing through public review and integration tools. The script emits sanitized control-plane evidence and joins CI after build/install checks because it does not call live providers.

**Tech Stack:** TypeScript build output, Node.js ESM smoke script, MCP SDK stdio client, Vitest script tests, disposable git fixture, existing workflow MCP tools.

---

## Scope

In scope:

- Add `scripts/smoke-workflow-orchestrator.mjs`.
- Add `npm run smoke:workflow-orchestrator`.
- Add the smoke to `npm run ci` after `npm run smoke:mcp-stdio` and before `npm run smoke:package`.
- Drive the packaged `dist/index.js` MCP server through public tools:
  - `agent_team_doctor`
  - `agent_team_create_workflow`
  - `agent_team_get_workflow`
  - `agent_team_plan_consensus`
  - `agent_team_unblock_slice`
  - `agent_team_review_slice`
  - `agent_team_integration_queue`
  - `agent_team_record_integration`
  - `agent_team_workflow_report`
  - `agent_team_list_workflows`
- Use a disposable git fixture under the OS temp directory and remove it after the smoke.
- Record final gate evidence as fixture-local paths without creating real provider runs.
- Assert `completionStatus === "complete"` only after all slices have passing final gate evidence.
- Assert blocked/incomplete/ready-to-integrate states appear before final integration.
- Keep output sanitized: run ids may be absent, no prompts, provider payloads, provider session ids, secrets, command args, process ids, or provider-quality claims.
- Update package smoke so the new script is included in the packed artifact.
- Update README/runbook docs to mention the fixture-safe workflow orchestrator smoke.
- Update docs tests/package script tests to enforce the new gate.
- Update this plan and roadmap evidence after implementation.

Out of scope:

- No live provider calls.
- No Claude, Ollama, Gemini, Grok, or model-quality proof.
- No benchmark, ranking, autonomous-coding, or provider capability claims.
- No source checkout mutation beyond repository files for this milestone.
- No plugin-side auto-merge, patch application, branch deletion, or cleanup execution.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for package scripts, package smoke, and docs coverage.
- [x] The script uses `dist/index.js` over `StdioClientTransport`, not `src/index.ts` or tool internals.
- [x] The script creates and removes a disposable fixture workspace.
- [x] The smoke preserves ordered public tool evidence and fails closed on unexpected workflow states.
- [x] Invariant scans are listed and run.
- [x] Live provider smoke is not required because this milestone uses only fixture-safe public MCP workflow state and makes no real-provider capability/sign-off claim.

## Success Criteria

- `npm run smoke:workflow-orchestrator` exists and runs against the built packaged MCP entrypoint.
- `npm run ci` includes the workflow smoke after build/install/stdout MCP smoke and before package smoke.
- The smoke creates a workflow with at least two slices where one starts blocked and later becomes ready through `agent_team_unblock_slice`.
- The smoke records planning consensus evidence with Codex approval and degraded Opus unavailable evidence without blocking forever.
- The smoke reviews slices through `agent_team_review_slice` and builds a read-only integration queue.
- The smoke records integration evidence for every slice through `agent_team_record_integration`.
- The smoke proves `agent_team_workflow_report` does not report `complete` before final gate evidence, then reports `complete` after all slices are integrated with passing verification.
- The smoke emits a sanitized report with workflow id, completion status, slice states, queue count, evidence paths, and fixture cleanup status.
- Package smoke confirms the script is shipped in npm dry-run packaging.
- README/runbook point operators to the fixture-safe smoke.

## Required Edge Cases

Selected from the L11 matrix:

- Packaged MCP boundary: smoke uses the built stdio runtime and public tools only.
- Workflow state: incomplete, blocked or ready-to-integrate, and complete states are observed in order.
- Blocked/unblocked workflow: dependency evidence moves a deferred slice into the integration path.
- Final gate evidence: completion refuses to claim success before passing verification is recorded for every slice.
- Provider boundary: no live provider invocation, no API-key fallback, no provider-specific schema.
- Public output safety: report excludes internal prompts, raw provider payloads, provider session ids, secrets, process ids, command args, and provider-quality claims.
- Cleanup: disposable fixture is removed even on failure; plugin cleanup is not used as a source mutation shortcut.

## File Plan

- Create `scripts/smoke-workflow-orchestrator.mjs`
  - Owns the disposable fixture, MCP stdio client, public workflow tool sequence, assertions, sanitized report, and cleanup.
- Modify `package.json`
  - Add `smoke:workflow-orchestrator`.
  - Add the smoke to `ci`.
- Modify `scripts/smoke-package.mjs`
  - Require the new smoke script in packed artifacts.
- Modify `tests/package-scripts.test.ts`
  - Assert the new script and CI ordering.
- Modify `tests/package-smoke.test.ts`
  - Assert the new script is packaged and avoids TS source execution.
- Create `tests/workflow-orchestrator-smoke.test.ts`
  - Assert the smoke script fails if `dist/index.js` is missing, uses MCP stdio, calls the required public tools, creates a disposable fixture, removes it, and avoids forbidden leakage terms.
- Modify `tests/docs/runbook.test.ts`
  - Require runbook mention of `npm run smoke:workflow-orchestrator`.
- Modify `tests/docs/packaging.test.ts`
  - Require README mention of `npm run smoke:workflow-orchestrator`.
- Modify `README.md`
  - Document the fixture-safe workflow orchestrator smoke.
- Modify `docs/runbooks/claude-team-session.md`
  - Add the workflow smoke to operator validation commands.
- Modify `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
  - Mark Milestone 60 complete after implementation.
- Modify this plan
  - Mark complete and record verification evidence after implementation.

## Task 1: Failing Coverage Tests

**Files:**

- Modify: `tests/package-scripts.test.ts`
- Modify: `tests/package-smoke.test.ts`
- Create: `tests/workflow-orchestrator-smoke.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `tests/docs/packaging.test.ts`

- [x] **Step 1: Write failing tests**

Add assertions requiring:

- package script `smoke:workflow-orchestrator`
- CI ordering `smoke:mcp-stdio` before `smoke:workflow-orchestrator` before `smoke:package`
- package dry-run includes `scripts/smoke-workflow-orchestrator.mjs`
- smoke script contains `StdioClientTransport`, `dist/index.js`, disposable fixture creation/removal, and public workflow tool names
- smoke script does not contain forbidden leakage terms such as `internal prompt`, `raw provider payload`, `provider session id`, `process.pid`, or `ANTHROPIC_AUTH_TOKEN`
- README/runbook mention `npm run smoke:workflow-orchestrator`

- [x] **Step 2: Confirm red**

Run:

- `npm test -- tests/package-scripts.test.ts tests/package-smoke.test.ts tests/workflow-orchestrator-smoke.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts`

Expected: fail because the smoke script and docs references do not exist yet.

## Task 2: Smoke Script

**Files:**

- Create: `scripts/smoke-workflow-orchestrator.mjs`

- [x] **Step 1: Implement disposable fixture and MCP client**

Use Node ESM modules:

- `mkdtemp`, `rm`, `writeFile`, `mkdir`, `access` from `node:fs/promises`
- `tmpdir` from `node:os`
- `join`, `dirname` from `node:path`
- `fileURLToPath` from `node:url`
- `execFileSync` from `node:child_process`
- `Client` and `StdioClientTransport` from the MCP SDK

Create a temporary git workspace, initialize git, and write a minimal `README.md`.

- [x] **Step 2: Drive public workflow tools**

Call public tools in this order:

1. `agent_team_doctor`
2. `agent_team_create_workflow`
3. `agent_team_get_workflow`
4. `agent_team_plan_consensus`
5. `agent_team_workflow_report`
6. `agent_team_unblock_slice`
7. `agent_team_review_slice` for both slices
8. `agent_team_integration_queue`
9. `agent_team_record_integration` for both slices
10. `agent_team_workflow_report`
11. `agent_team_list_workflows`

Do not call `agent_team_start_slices`, because this fixture-safe smoke validates the workflow state machine without starting provider-backed runs. Instead, seed disposable workflow state in the temporary fixture to represent provider-completed handoff before public review and integration calls.

- [x] **Step 3: Assert state transitions and sanitized output**

Assert:

- planning becomes approved
- pre-integration report is not complete
- blocked slice can be unblocked with dependency evidence
- queue includes approved slices
- final report is complete only after final gate evidence is recorded
- report contains no provider secrets or provider payload details
- fixture cleanup runs in `finally`

- [x] **Step 4: Confirm green script behavior**

Run:

- `npm run build`
- `npm run smoke:workflow-orchestrator`

Expected: smoke passes and prints sanitized JSON summary.

## Task 3: Package, CI, And Docs Wiring

**Files:**

- Modify: `package.json`
- Modify: `scripts/smoke-package.mjs`
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`

- [x] **Step 1: Wire package scripts**

Add:

- `"smoke:workflow-orchestrator": "node scripts/smoke-workflow-orchestrator.mjs"`

Update `ci` to:

- `npm run typecheck && npm test && npm run build && npm run install:check && npm run smoke:mcp-stdio && npm run smoke:workflow-orchestrator && npm run smoke:package`

- [x] **Step 2: Wire package smoke**

Add `scripts/smoke-workflow-orchestrator.mjs` to the required packed files list.

- [x] **Step 3: Update docs**

Add `npm run smoke:workflow-orchestrator` to README/runbook validation sections and describe that it is fixture-safe, packaged-boundary, provider-free, and makes no model-quality or provider capability claim.

- [x] **Step 4: Confirm focused green**

Run:

- `npm test -- tests/package-scripts.test.ts tests/package-smoke.test.ts tests/workflow-orchestrator-smoke.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts`

## Task 4: Full Verification And Integration

**Files:**

- Modify: `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-60.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [x] **Step 1: Run required verification**

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:mcp-stdio`
- `npm run smoke:workflow-orchestrator`
- `npm run smoke:package`
- `! rg -n "internal prompt text:|hidden instruction text:|raw provider payload:|provider session id:|ANTHROPIC_AUTH_TOKEN=|ANTHROPIC_API_KEY=|OLLAMA_API_KEY=|process\\.pid|quality score|model-quality comparison|provider ranking claim:|api-key fallback" README.md docs/runbooks/claude-team-session.md scripts/smoke-workflow-orchestrator.mjs`
- `npm run ci`
- `git diff --check`

- [x] **Step 2: Update evidence and roadmap**

Update:

- this plan's completed checkboxes
- roadmap current baseline to include Milestone 60 and the packaged workflow orchestrator smoke

- [x] **Step 3: Commit, merge, push, and clean up**

- Commit implementation on isolated branch.
- Merge to `main` only after verification passes.
- Push `main`.
- Remove temporary worktree and branch.

## Verification Evidence

Implementation evidence:

- TDD red: `npm test -- tests/package-scripts.test.ts tests/package-smoke.test.ts tests/workflow-orchestrator-smoke.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts` failed before implementation because `smoke:workflow-orchestrator`, `scripts/smoke-workflow-orchestrator.mjs`, package smoke wiring, and docs references did not exist.
- Focused green: the same focused test command passed 12 tests across 5 files.
- Packaged smoke proof: `npm run smoke:workflow-orchestrator` passed against `dist/index.js`, returned `completionStatus: "complete"`, reported blocked probe `blocked -> ready`, reported 2 cleanup-ready slices, and removed the disposable fixture.
- Required gates:
  - `npm run typecheck` passed.
  - `npm test` passed 572 tests across 76 files.
  - `npm run build` passed.
  - `npm run smoke:mcp-stdio` passed.
  - `npm run smoke:workflow-orchestrator` passed.
  - `npm run smoke:package` passed.
  - invariant scan passed for leak-shaped internal prompt, hidden instruction, raw payload, session id, API token, process id, quality-score, provider-ranking, and API-key fallback patterns.
  - `npm run ci` passed, including typecheck, full tests, build, install preflight, MCP stdio smoke, workflow orchestrator smoke, and package smoke.
  - `git diff --check` passed.

Live provider smoke was intentionally not run. This milestone validates fixture-safe workflow orchestration through the packaged MCP boundary and makes no new real-provider capability, sign-off, benchmark, model-quality, or provider-ranking claim.
