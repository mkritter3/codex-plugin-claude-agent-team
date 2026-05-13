# Agent Team MCP Milestone 66: Delegation Playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable, test-backed delegation playbook that tells Codex which roles, providers, steering modes, and evidence gates to use for L11 agent-team workflows.

**Architecture:** Add a small provider-neutral core module that maps work types and workflow phases to sanitized delegation recommendations. The playbook sits above routing: it advises Codex, while existing provider policy, capability gating, health checks, lifecycle, mailboxes, workflow state, and cleanup remain the execution authorities.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing workflow guidance/core role types, README/docs, invariant scans.

---

## Success Criteria

- Codex can ask the core playbook for guidance on planning, implementation, UI/UX, search, review, junior implementation, steering, testing, integration, and release/docs work.
- Playbook recommendations include roles, provider preferences, concurrency guidance, steering mode, evidence requirements, user-escalation categories, and claim boundary.
- Claude Opus is preferred for planning, high-complexity architecture, security-sensitive decisions, and final review.
- Claude Sonnet and Codex CLI are preferred for senior implementation.
- Claude Haiku is preferred for search, reconnaissance, lightweight scans, and summaries.
- Gemini CLI is represented as a full autonomous worker and default-preferred for UI/UX/frontend/product-flow work when configured.
- Ollama Claude Code Kimi K2.6, GLM 5.1, and DeepSeek V4 Flash are represented as junior contained implementation workers that require isolated worktrees, bounded scope, and senior review before integration.
- The playbook separates Codex-owned technical decisions from user-facing CEO/product decisions.
- Public/sanitized output does not include internal prompts, secrets, raw provider payloads, provider command arguments, API keys, or hidden implementation details.
- Tests prove the playbook does not emit provider-ranking, model-quality, or benchmark claims.
- README and workflow design docs document the delegation strategy and its evidence boundary.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## File Structure

- Create `src/core/delegation-playbook.ts`
  - Defines work types, recommendation types, provider preferences, evidence requirements, steering guidance, and sanitized helper functions.
- Create `tests/core/delegation-playbook.test.ts`
  - Covers provider preferences, role recommendations, junior containment, Gemini worker guidance, user decision filtering, and output sanitization.
- Modify `src/core/workflow-guidance.ts`
  - Adds delegation recommendations to workflow guidance output without starting providers or mutating source.
- Modify `tests/core/workflow-guidance.test.ts`
  - Verifies guidance includes playbook recommendations for planning/executing/review phases and remains sanitized.
- Modify `docs/superpowers/specs/2026-05-13-l11-agent-team-workflow-orchestrator-design.md`
  - Adds the delegation playbook as the source-of-truth strategy layer.
- Modify `README.md`
  - Adds concise operator guidance for how Codex should delegate to Opus, Sonnet, Haiku, Codex CLI, Gemini CLI, and Ollama Claude Code profiles.

## Task 1: Add Delegation Playbook Types And Recommendations

**Files:**
- Create: `src/core/delegation-playbook.ts`
- Test: `tests/core/delegation-playbook.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that import `recommendDelegation` and verify:

```ts
expect(recommendDelegation({ workType: "planning" }).providerPreferences).toContain("claude-code-cli:opus");
expect(recommendDelegation({ workType: "implementation" }).providerPreferences).toEqual(
  expect.arrayContaining(["claude-code-cli:sonnet", "codex-cli"])
);
expect(recommendDelegation({ workType: "search" }).providerPreferences).toContain("claude-code-cli:haiku");
expect(recommendDelegation({ workType: "ui-ux" }).providerPreferences).toContain("gemini-cli");
expect(recommendDelegation({ workType: "junior-implementation" }).riskControls).toEqual(
  expect.arrayContaining(["isolated_worktree_required", "senior_review_required"])
);
```

Also assert JSON output does not match `/api[_-]?key|secret|rawProvider|providerPayload|commandArgs|best model|provider superiority|benchmark winner/i`.

- [ ] **Step 2: Run failing focused test**

Run: `npm test -- tests/core/delegation-playbook.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the core playbook**

Create `src/core/delegation-playbook.ts` with:

- `DELEGATION_WORK_TYPES`
- `DelegationWorkType`
- `DelegationRecommendation`
- `recommendDelegation(input)`
- `recommendDelegationForWorkflowPhase(phase)`

Use explicit provider preference arrays:

```ts
["claude-code-cli:opus"]
["claude-code-cli:sonnet", "codex-cli"]
["claude-code-cli:haiku"]
["gemini-cli", "claude-code-cli:sonnet", "codex-cli"]
["ollama-claude-code:kimi-k2.6", "ollama-claude-code:glm-5.1", "ollama-claude-code:deepseek-v4-flash"]
```

Return claim boundary `routing_guidance_only`.

- [ ] **Step 4: Run focused test**

Run: `npm test -- tests/core/delegation-playbook.test.ts`

Expected: PASS.

## Task 2: Attach Playbook To Workflow Guidance

**Files:**
- Modify: `src/core/workflow-guidance.ts`
- Modify: `tests/core/workflow-guidance.test.ts`

- [ ] **Step 1: Write failing workflow guidance tests**

Add tests that verify:

- planning guidance includes Opus planning preference
- executing guidance includes implementation or junior implementation recommendation
- reviewing guidance includes Opus/Codex sign-off evidence requirements
- guidance output remains sanitized and advisory

- [ ] **Step 2: Run focused tests**

Run: `npm test -- tests/core/workflow-guidance.test.ts tests/core/delegation-playbook.test.ts`

Expected: FAIL until guidance output includes delegation.

- [ ] **Step 3: Extend `WorkflowGuidance`**

Add:

```ts
readonly delegation: readonly DelegationRecommendation[];
```

Derive recommendations from phase:

- `brainstorming`, `planning`, `awaiting_user_plan_approval`: planning
- `approved`, `executing`: implementation plus junior implementation when slices are low/medium risk
- `reviewing`, `awaiting_integration`, `integrating`, `validating`: review/testing/integration recommendations
- `blocked`: debugging/search
- `completed`, `cleanup_ready`: docs/release cleanup guidance

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/core/workflow-guidance.test.ts tests/core/delegation-playbook.test.ts`

Expected: PASS.

## Task 3: Document Operator Delegation Strategy

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-13-l11-agent-team-workflow-orchestrator-design.md`

- [ ] **Step 1: Add documentation assertions**

Extend existing docs tests if practical, or add focused assertions in `tests/docs/workflow-readiness.test.ts`/`tests/docs/packaging.test.ts` that README includes:

- `claude-code-cli:opus`
- `claude-code-cli:sonnet`
- `claude-code-cli:haiku`
- `gemini-cli`
- `ollama-claude-code:kimi-k2.6`
- `routing_guidance_only`

- [ ] **Step 2: Run docs tests and verify failure**

Run: `npm test -- tests/docs/workflow-readiness.test.ts tests/docs/packaging.test.ts`

Expected: FAIL until docs are updated.

- [ ] **Step 3: Update docs**

Add a concise “Delegation Playbook” section to README and a short “Delegation Playbook Layer” section to the workflow orchestrator design.

- [ ] **Step 4: Run docs tests**

Run: `npm test -- tests/docs/workflow-readiness.test.ts tests/docs/packaging.test.ts`

Expected: PASS.

## Task 4: Verification And Integration

**Files:**
- All modified files

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/core/delegation-playbook.test.ts tests/core/workflow-guidance.test.ts tests/docs/workflow-readiness.test.ts tests/docs/packaging.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Run packaged and invariant gates**

Run:

```bash
npm run smoke:mcp-stdio
npm run smoke:workflow-orchestrator
npm run smoke:package
npm run scan:workflow-guidance
npm run validate:workflow-fixtures
npm run scan:workflow-validation
```

Expected: PASS.

- [ ] **Step 6: Run full CI**

Run: `npm run ci`

Expected: PASS.

- [ ] **Step 7: Commit, merge, push, and cleanup**

Commit the implementation, fast-forward merge to `main`, push `main`, remove the temporary worktree, and delete the local milestone branch.
