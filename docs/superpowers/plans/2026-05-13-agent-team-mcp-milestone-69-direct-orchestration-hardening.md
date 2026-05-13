# Direct Orchestration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the direct Codex-operated Agent Team MCP path based on the first live direct-orchestration proof.

**Architecture:** Keep the runtime provider-neutral and fix the shared MCP validation/service normalization layer so direct users do not need sentinel values such as `read-only` or `none-read-only`. Preserve strict non-empty validation for fields that materially require evidence, while allowing empty arrays for optional/no-op surfaces and read-only evidence. Use focused MCP handler tests first, then update docs and packaging tests only where the public operator contract changed.

**Tech Stack:** TypeScript, MCP tool schemas, Vitest, Agent Team workflow state, Codex plugin skill docs.

---

### Task 1: Direct MCP Schema Ergonomics

**Files:**
- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/core/workflow-service.ts`
- Modify: `src/core/workflow-review.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing tests for empty/no-op direct MCP inputs**

Add focused tests to `tests/mcp/tools.test.ts` that reproduce the live-run friction:

```ts
it("accepts explicit empty optional arrays for direct workflow calls", async () => {
  let consensusCalled = false;
  let reviewCalled = false;
  const handlers = createToolHandlers({
    cwd: () => "/repo",
    planConsensus: async (input) => {
      consensusCalled = true;
      expect(input.userEscalations).toEqual([]);
      return {
        workflow: {
          workflowId: input.workflowId,
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T10:01:00.000Z",
          planningStatus: "approved",
          goal: {
            title: "Plan",
            successCriteria: ["approved"],
            constraints: ["provider neutral"],
            nonGoals: ["live claims"]
          },
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [],
          consensusRounds: [],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
        }
      };
    },
    reviewWorkflowSlice: async (input) => {
      reviewCalled = true;
      expect(input.userEscalations).toEqual([]);
      expect(input.implementationEvidence?.changedFiles).toEqual([]);
      return {
        workflow: {
          workflowId: input.workflowId,
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T10:02:00.000Z",
          planningStatus: "approved",
          goal: {
            title: "Review",
            successCriteria: ["reviewed"],
            constraints: ["provider neutral"],
            nonGoals: ["live claims"]
          },
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [],
          consensusRounds: [],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_mcp.json"
        }
      };
    }
  });

  const consensus = await handlers.handleToolCall("agent_team_plan_consensus", {
    workflowId: "workflow_mcp",
    userEscalations: [],
    codexDecision: {
      status: "approve",
      category: "technical",
      summary: "No user escalation is needed."
    },
    verdicts: [
      {
        reviewerRole: "planner",
        status: "approve",
        summary: "Proceed."
      }
    ]
  });

  const review = await handlers.handleToolCall("agent_team_review_slice", {
    workflowId: "workflow_mcp",
    sliceId: "slice_readonly",
    userEscalations: [],
    implementationEvidence: {
      summary: "Read-only proof.",
      changedFiles: [],
      testsRun: ["agent_team_status_many"],
      evidencePaths: ["/repo/.agent-team/runs/run_readonly.json"]
    },
    codexDecision: {
      status: "revise",
      category: "technical",
      summary: "Needs docs hardening."
    },
    verdicts: [
      {
        reviewerRole: "planner",
        status: "revise",
        summary: "Revise docs."
      }
    ]
  });

  expect(consensus.structuredContent?.workflow.workflowId).toBe("workflow_mcp");
  expect(review.structuredContent?.workflow.workflowId).toBe("workflow_mcp");
  expect(consensusCalled).toBe(true);
  expect(reviewCalled).toBe(true);
});
```

Also add a create-workflow test proving a read-only role can use an empty `dependencies` array and an empty `writeScope`:

```ts
it("accepts empty dependencies and writeScope for read-only workflow slices", async () => {
  let createInput: CreateWorkflowInput | undefined;
  const handlers = createToolHandlers({
    cwd: () => "/repo",
    createWorkflow: async (input) => {
      createInput = input;
      return {
        workflow: {
          workflowId: "workflow_readonly",
          createdAt: "2026-05-13T10:00:00.000Z",
          updatedAt: "2026-05-13T10:00:00.000Z",
          planningStatus: "draft",
          goal: input.goal,
          seniorReview: DEFAULT_AGENT_TEAM_CONFIG.seniorReview,
          slices: [
            {
              sliceId: "slice_readonly",
              title: "Read-only review",
              state: "ready",
              ownerRole: "planner",
              dependencies: [],
              writeScope: [],
              acceptanceTests: ["agent_team_status_many"]
            }
          ],
          consensusRounds: [],
          userEscalations: [],
          opusReviewEvidence: [],
          integrationQueue: [],
          codexRationale: [],
          evidencePath: "/repo/.agent-team/workflows/workflow_readonly.json"
        }
      };
    }
  });

  const result = await handlers.handleToolCall("agent_team_create_workflow", {
    workflowId: "workflow_readonly",
    goal: {
      title: "Read-only proof",
      successCriteria: ["workflow created"],
      constraints: ["no source edits"],
      nonGoals: ["feature work"]
    },
    slices: [
      {
        sliceId: "slice_readonly",
        title: "Read-only review",
        ownerRole: "planner",
        state: "ready",
        dependencies: [],
        writeScope: [],
        acceptanceTests: ["agent_team_status_many"],
        expectedEvidence: ["run status evidence"]
      }
    ]
  });

  expect(result.structuredContent?.workflow.workflowId).toBe("workflow_readonly");
  expect(createInput?.slices[0]?.dependencies).toEqual([]);
  expect(createInput?.slices[0]?.writeScope).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: fail with validation errors for `dependencies`, `writeScope`, `userEscalations`, or `changedFiles`.

- [ ] **Step 3: Implement minimal validation normalization**

Update shared parsing so:

- `dependencies: []` is accepted and passed through.
- `userEscalations: []` is accepted and passed through.
- `implementationEvidence.changedFiles: []` is accepted for read-only/no-change reviews.
- `writeScope: []` is accepted for read-only roles and represented as an empty array.

Do not relax:

- `goal.successCriteria`, `goal.constraints`, `goal.nonGoals`
- `acceptanceTests`
- `expectedEvidence`
- `verdicts`
- `evidencePaths`
- integration `changedFiles` unless a later live run proves it is needed.

- [ ] **Step 4: Run focused tests to verify pass**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: all `tests/mcp/tools.test.ts` tests pass.

### Task 2: Operator Contract Documentation

**Files:**
- Modify: `skills/codex-agent-team-orchestrator/SKILL.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `.codex-plugin/plugin.json`
- Test: `tests/plugin-operator-skill.test.ts`
- Test: `tests/docs/runbook.test.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing assertions for the direct start contract**

Extend existing docs/skill tests to require:

- `agent_team_start_slices` returns run ids plus sidecar/log/mailbox/transcript evidence.
- `policy.liveSmokeEnabled` gates live smoke harnesses, not normal direct MCP starts.
- Direct provider-backed starts require policy allow-lists for roles, providers, write mode, and worktree roots.
- Steering can interleave while a slice is active.
- `agent_team_workflow_report` only reports complete after final integration evidence.
- Plugin prompts mention `agent_team_create_workflow`, `agent_team_plan_consensus`, and `agent_team_start_slices`.

- [ ] **Step 2: Run focused docs tests to verify fail**

Run:

```bash
npm test -- tests/plugin-operator-skill.test.ts tests/docs/runbook.test.ts tests/mcp/tools.test.ts
```

Expected: fail on missing documentation strings and old prompt text.

- [ ] **Step 3: Update docs and manifest**

Add concise operational wording to the skill and runbook. Keep harness language clear: harnesses prove packaging/provider wiring, while Codex uses MCP tools directly for real work.

- [ ] **Step 4: Run focused docs tests to verify pass**

Run:

```bash
npm test -- tests/plugin-operator-skill.test.ts tests/docs/runbook.test.ts tests/mcp/tools.test.ts
```

Expected: pass.

### Task 3: Verification And Integration

**Files:**
- All files touched above.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

Expected: all pass.

- [ ] **Step 2: Run a direct MCP proof after restart/reload when available**

Use Codex MCP tools directly:

```text
agent_team_doctor
agent_team_create_workflow
agent_team_plan_consensus
agent_team_start_slices
agent_team_status_many
agent_team_message_many
agent_team_wind_down
agent_team_review_slice
agent_team_workflow_report
```

Expected: no sentinel values are needed for read-only workflow slices or no-escalation review evidence.

- [ ] **Step 3: Commit, merge, push, and clean worktree**

Commit message:

```bash
git commit -m "fix: harden direct mcp orchestration ergonomics"
```

Clean up temporary worktree and branch after successful merge/push.
