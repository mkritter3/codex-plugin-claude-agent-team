# Agent Team MCP Milestone 59 Workflow Orchestrator Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the complete L11 workflow orchestrator operator loop so a user can run the feature end-to-end from public MCP tools without relying on prior chat history.

**Architecture:** Keep this as a docs-and-tests milestone. The runbook is the operator-facing source of truth for the full workflow loop: doctor, create workflow, plan consensus, start/unblock/review slices, build integration queue, record integration evidence, read completion report, and perform explicit cleanup only after evidence is saved. Tests enforce that the docs mention every public workflow tool and preserve safety boundaries.

**Tech Stack:** Markdown docs, Vitest docs tests, existing MCP/runbook terminology.

---

## Scope

In scope:

- Expand `docs/runbooks/claude-team-session.md` with a complete workflow orchestrator section.
- Cover the full public MCP sequence:
  - `agent_team_doctor`
  - `agent_team_create_workflow`
  - `agent_team_plan_consensus`
  - `agent_team_start_slices`
  - `agent_team_unblock_slice`
  - `agent_team_review_slice`
  - `agent_team_integration_queue`
  - Codex-owned manual integration outside the plugin
  - `agent_team_record_integration`
  - `agent_team_workflow_report`
  - `agent_team_cleanup`
- Document success criteria for a complete workflow:
  - planning approved
  - slices integrated
  - final gate verification recorded
  - completion report says `complete`
  - cleanup performed only after saved evidence
- Document blocked/incomplete handling:
  - blocked slices
  - failed or skipped verification
  - Opus unavailable degraded evidence
  - needs-revision review loops
  - user escalation only for CEO/product-level decisions
- Update README to point users to the workflow orchestrator runbook and list the workflow tools.
- Update docs tests so runbook coverage is enforced.
- Update this plan and roadmap evidence after implementation.

Out of scope:

- No new runtime tools or schema changes.
- No provider calls or live proof.
- No merge, patch application, cherry-pick, commit, push, cleanup execution, or workflow mutation beyond documentation.
- No model-quality, benchmark, provider-ranking, or capability claim.
- No internal prompts, secrets, raw provider payloads, command args, provider session ids, or provider-specific implementation details in docs.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for runbook/README coverage tests.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is not required because this milestone documents already-tested public MCP surfaces and makes no real-provider capability/sign-off claim.

## Success Criteria

- Runbook documents every public workflow orchestrator tool from workflow creation through final report.
- Runbook states that Codex owns manual integration and the plugin never auto-merges.
- Runbook states that `agent_team_workflow_report` only reports `complete` after durable passing final gate evidence exists for every slice.
- Runbook states that cleanup is explicit and only after integration evidence is saved.
- Runbook documents blocked/incomplete paths and CEO/product-level escalation boundaries.
- README points operators to the full workflow loop and lists the core workflow tools.
- Docs tests fail before docs are updated and pass after.
- Docs remain free of private implementation leakage and unsafe onboarding paths.

## Required Edge Cases

Selected from the L11 matrix:

- Public schema safety: docs must not expose internal prompts, provider command details, raw provider payloads, secrets, or provider session ids.
- Workflow state: docs distinguish `complete`, `incomplete`, `blocked`, `ready-to-integrate`, `missing-evidence`, and cleanup-ready states.
- Cleanup boundary: docs say cleanup is explicit and cannot happen before evidence is saved.
- Provider boundary: docs preserve Claude Code CLI subscription OAuth as primary v1 transport and do not introduce API-key fallback.
- User escalation: docs say routine technical decisions stay with Codex; user questions are CEO/product-level tradeoffs only.
- Live proof: docs do not claim real Opus sign-off or provider capability without opt-in live proof.

## File Plan

- Modify `tests/docs/runbook.test.ts`
  - Add required workflow orchestrator runbook terms.
- Modify `tests/docs/packaging.test.ts`
  - Add README workflow tool/runbook coverage assertions.
- Modify `docs/runbooks/claude-team-session.md`
  - Add complete workflow orchestrator operating section.
- Modify `README.md`
  - Add a concise workflow orchestrator section and runbook pointer.
- Modify `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
  - Mark Milestone 59 complete after implementation.
- Modify this plan
  - Mark complete and record verification evidence after implementation.

## Task 1: Docs Coverage Tests

**Files:**

- Modify: `tests/docs/runbook.test.ts`
- Modify: `tests/docs/packaging.test.ts`

- [ ] **Step 1: Write failing docs tests**

Add assertions that require:

- `agent_team_create_workflow`
- `agent_team_plan_consensus`
- `agent_team_start_slices`
- `agent_team_unblock_slice`
- `agent_team_review_slice`
- `agent_team_integration_queue`
- `agent_team_record_integration`
- `agent_team_workflow_report`
- `completionStatus`
- `ready-to-integrate`
- `missing-evidence`
- `Codex-owned manual integration`
- `CEO/product-level`
- `final gate verification`
- `cleanup only after integration evidence is saved`

- [ ] **Step 2: Confirm red**

Expected failure:

- `npm test -- tests/docs/runbook.test.ts tests/docs/packaging.test.ts`

## Task 2: Runbook And README

**Files:**

- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `README.md`

- [ ] **Step 1: Update runbook**

Add a complete workflow orchestrator section with:

- prerequisites and safety posture
- public MCP tool sequence
- integration and final gate evidence rules
- blocked/incomplete handling
- cleanup handoff rules
- no provider ranking/model-quality claims

- [ ] **Step 2: Update README**

Add a compact workflow orchestrator section that:

- lists the public workflow tools
- points to `docs/runbooks/claude-team-session.md`
- reiterates that Codex owns manual integration and cleanup remains explicit

- [ ] **Step 3: Confirm green**

Run:

- `npm test -- tests/docs/runbook.test.ts tests/docs/packaging.test.ts`

## Task 3: Full Verification And Integration

**Files:**

- Modify: `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-59.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [ ] **Step 1: Run focused milestone verification**

- `npm test -- tests/docs/runbook.test.ts tests/docs/packaging.test.ts`

- [ ] **Step 2: Run required verification**

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:mcp-stdio`
- `! rg -n "internal prompt|hidden instruction|raw provider|provider payload|provider session id|command args|secret" README.md docs/runbooks/claude-team-session.md`
- `! rg -n "model-quality comparison|quality score|provider ranking|benchmark claim|api-key fallback" README.md docs/runbooks/claude-team-session.md`
- `npm run ci`

- [ ] **Step 3: Update evidence and roadmap**

Update:

- this plan's completed checkboxes
- roadmap current baseline to include Milestone 59 and workflow orchestrator runbook coverage

- [ ] **Step 4: Commit, merge, push, and clean up**

- Commit implementation on isolated branch.
- Merge to `main` only after verification passes.
- Push `main`.
- Remove temporary worktree and branch.

## Verification Evidence

Pending implementation.
