# Agent Team MCP Milestone 61 Workflow Orchestrator Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove whether the L11 Workflow Orchestrator product-level success criteria are complete, and stop if they are.

**Architecture:** Keep this as an evidence-and-tests milestone. Add a repo-native readiness report that maps the workflow orchestrator design, quality gates, roadmap baseline, runbook, public MCP tools, packaged smoke, and CI gates into one final product-readiness checklist. Tests enforce that the report is not aspirational: every required workflow capability, safety invariant, and proof boundary must be listed with concrete evidence commands and no live-provider or model-quality overclaim.

**Tech Stack:** Markdown readiness report, Vitest docs tests, existing roadmap/runbook/spec files, existing package scripts.

---

## Scope

In scope:

- Create `docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`.
- Add docs tests that require the readiness report to map:
  - final product decision
  - workflow tool surface
  - senior review policy
  - no yes-man consensus
  - 10/15-round consensus handling
  - CEO/product-level escalation boundary
  - expanded L11 full-stack role roster
  - slice DAG and blocked/unblocked flow
  - isolated implementation worktrees
  - review/sign-off before integration
  - read-only integration queue
  - Codex-owned integration
  - final gate evidence
  - explicit cleanup after evidence
  - provider-neutral public MCP schemas
  - Claude Code CLI subscription OAuth primary v1 transport
  - no API-key fallback unless configured
  - no model-quality, benchmark, or provider-ranking claim
  - packaged workflow orchestrator smoke evidence
  - full verification evidence
- Update the roadmap to mark the workflow-orchestrator product-level success criteria complete if the report proves completion.
- Update README/runbook only if the final readiness report needs a discoverable pointer.
- Do not add runtime tools, provider behavior, or live proof.

Out of scope:

- No new MCP tools.
- No live provider calls.
- No implementation-agent execution changes.
- No automatic merge, patch application, branch deletion, cleanup execution, or source checkout mutation.
- No real Opus sign-off, model-quality, benchmark, provider-ranking, long-context, or coding-readiness claim.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for final readiness report coverage.
- [ ] Focused docs tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is not required because this milestone records product-readiness evidence from existing fixture-safe and previously opt-in proof surfaces without making new real-provider claims.

## Success Criteria

- Readiness report states whether the workflow orchestrator product-level success criteria are met.
- Readiness report cites concrete repo evidence for every workflow orchestrator design invariant.
- Readiness report distinguishes fixture-safe proof from live-provider proof boundaries.
- Readiness report says Codex remains senior engineer, orchestrator, reviewer, integrator, and final authority.
- Readiness report says the plugin does not auto-merge, auto-cleanup, or expose internal prompts/provider payloads through public MCP schemas.
- Readiness report says user escalation is limited to CEO/product-level practical decisions.
- Readiness report says Opus review is default-on required-when-available and unavailable Opus records degraded evidence instead of blocking forever.
- Readiness report maps `npm run ci` to typecheck, full tests, build, install preflight, stdio smoke, workflow smoke, and package smoke.
- Roadmap current baseline marks the workflow-orchestrator success criteria complete and tells future workers to stop repeating workflow-orchestrator implementation prompts unless a new product requirement appears.
- Tests fail before the readiness report exists and pass after.

## Required Edge Cases

Selected from the L11 matrix:

- Docs and examples: final readiness docs do not depend on chat history.
- Public schema safety: report must not expose internal prompts, raw provider payloads, provider session ids, provider command details, or secrets.
- Packaged runtime: report must cite packaged `dist/index.js`, stdio smoke, workflow orchestrator smoke, package smoke, and CI.
- Provider boundary: report must not claim new live provider capability or real Opus sign-off from fixture-safe tests.
- Cleanup boundary: report must preserve cleanup-after-evidence and no auto-cleanup semantics.
- Integration boundary: report must preserve Codex-owned manual integration and no auto-merge semantics.

## File Plan

- Create `docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`
  - Owns final product-readiness evidence and completion decision.
- Create `tests/docs/workflow-readiness.test.ts`
  - Enforces required report evidence terms and forbidden overclaim/leakage patterns.
- Modify `tests/docs/runbook.test.ts`
  - Require the runbook to point to the final readiness report.
- Modify `tests/docs/packaging.test.ts`
  - Require README to point to the final readiness report.
- Modify `README.md`
  - Add concise final readiness pointer.
- Modify `docs/runbooks/claude-team-session.md`
  - Add final readiness pointer near fixture-safe verification or workflow loop.
- Modify `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
  - Mark Milestone 61 complete after verification and state workflow-orchestrator product success criteria are met.
- Modify this plan
  - Mark complete and record verification evidence.

## Task 1: Failing Readiness Tests

**Files:**

- Create: `tests/docs/workflow-readiness.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `tests/docs/packaging.test.ts`

- [ ] **Step 1: Write failing readiness tests**

Require the readiness report to include:

- `Final Decision: Complete`
- `Codex remains the senior engineer, orchestrator, reviewer, integrator, and final authority`
- `Claude Code CLI subscription OAuth`
- `required-when-available`
- `degraded evidence`
- `CEO/product-level`
- `10 rounds`
- `15 rounds`
- `no yes-man`
- `expanded L11 full-stack roster`
- `slice DAG`
- `blocked/unblocked`
- `retained isolated worktrees`
- `Codex-owned manual integration`
- `read-only integration queue`
- `final gate evidence`
- `cleanup only after integration evidence is saved`
- `agent_team_create_workflow`
- `agent_team_workflow_report`
- `npm run smoke:workflow-orchestrator`
- `npm run ci`
- `fixture-safe`
- `no new live-provider capability claim`

Require README and runbook to mention:

- `docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`

- [ ] **Step 2: Confirm red**

Run:

- `npm test -- tests/docs/workflow-readiness.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts`

Expected: fail because the readiness report and pointers do not exist yet.

## Task 2: Final Readiness Report And Pointers

**Files:**

- Create: `docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`

- [ ] **Step 1: Write the readiness report**

Create a concise but complete report with:

- final decision
- evidence table mapping design criteria to repo evidence
- proof boundary section distinguishing fixture-safe CI proof from live-provider proof
- remaining non-blocking future work only if it is outside the accepted product-level goal

- [ ] **Step 2: Add README/runbook pointers**

Add one sentence in README and runbook pointing to the readiness report.

- [ ] **Step 3: Confirm focused green**

Run:

- `npm test -- tests/docs/workflow-readiness.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts`

## Task 3: Roadmap And Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-61.md`

- [ ] **Step 1: Update roadmap**

Update the roadmap baseline to Milestone 61 and state that the workflow-orchestrator product-level success criteria are complete. Future work should require a new product requirement, not another continuation of the same orchestrator goal.

- [ ] **Step 2: Run required verification**

- `npm test -- tests/docs/workflow-readiness.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:mcp-stdio`
- `npm run smoke:workflow-orchestrator`
- `npm run smoke:package`
- `! rg -n "internal prompt text:|hidden instruction text:|raw provider payload:|provider session id:|ANTHROPIC_AUTH_TOKEN=|ANTHROPIC_API_KEY=|OLLAMA_API_KEY=|process\\.pid|quality score|model-quality comparison|provider ranking claim:|api-key fallback" README.md docs/runbooks/claude-team-session.md docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`
- `npm run ci`
- `git diff --check`

- [ ] **Step 3: Update evidence and commit**

Update this plan with verification evidence, commit implementation on the isolated branch, merge to `main`, push, and clean up the temporary worktree/branch.

## Verification Evidence

Pending implementation.
