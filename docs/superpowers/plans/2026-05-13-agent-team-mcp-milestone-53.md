# Agent Team MCP Milestone 53 Planning Consensus Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the provider-neutral planning consensus state machine and public `agent_team_plan_consensus` tool so Codex can record L11 planning rounds, senior-review availability, user-level escalations, and Codex final decisions before implementation slices start.

**Architecture:** Keep M53 as workflow state orchestration only. The MCP layer validates sanitized provider-neutral round input, the core consensus service appends strict workflow evidence, evaluates the 10/15-round consensus rules, records Opus senior-review evidence through the existing workflow record shape, and returns the existing sanitized workflow view. No providers are invoked and no implementation slices are started.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Zod schemas, Vitest, `.agent-team/` durable workflow state.

---

## Scope

In scope:

- Add pure planning consensus evaluation for workflow records.
- Add `agent_team_plan_consensus` as a public MCP tool.
- Append planning consensus rounds with reviewer verdicts.
- Require a Codex decision for each recorded round.
- Preserve non-yes-man evidence by storing `approve`, `revise`, `block`, and `abstain` verdicts.
- Record senior reviewer evidence when supplied:
  - available sign-off evidence
  - unavailable degraded evidence
  - skipped evidence when policy disables or skips the reviewer
- Enforce planning round caps:
  - default decision window through round 10
  - extension allowed through round 15 only when close
  - round 15 unresolved material disagreement produces user escalation evidence
- Apply the user-decision filter:
  - product/user/trust/security-risk/provider-cost/release-posture categories can create user escalations
  - technical categories create Codex rationale only
- Keep workflow outputs sanitized through `WorkflowView`.
- Add packaged stdio smoke coverage for the new public tool.
- Update this plan with implementation and verification evidence.

Out of scope:

- No live Opus or provider call.
- No provider selection or model-quality claim.
- No autonomous consensus prompting.
- No slice start or implementation worktree creation.
- No review consensus for implementation slices.
- No integration queue computation.
- No auto-merge, auto-commit, or cleanup behavior.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for consensus core, workflow store/view changes if needed, MCP handlers, server registration, and package smoke coverage.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is not required because M53 records state-only planning evidence and makes no real senior-review/sign-off claim.

## Success Criteria

- `agent_team_plan_consensus` appears in tool names, MCP metadata, server registration, packaged stdio smoke, and tests.
- Input shape is provider-neutral:
  - `workflowId`
  - optional `cwd`
  - optional `roundMode` as `default` or `extended`
  - `codexDecision` with `status`, `summary`, `category`, and optional `relatedSliceIds`
  - `verdicts` with reviewer role/provider, status, summary, and optional evidence run id
  - optional `seniorReviewerEvidence` with availability status, provider, run id, and summary
  - optional `userEscalations` with question, product impact, options, and category
- Invalid inputs return `validation_error` before durable state is written.
- The tool reads the workflow through shared recovery paths and writes a strict `WorkflowRecord`.
- Each call appends exactly one planning `WorkflowConsensusRound` with the next monotonic round number.
- Rounds 1 through 10 are allowed in default mode.
- Rounds 11 through 15 require `roundMode: "extended"`.
- Round 16 is rejected.
- A `block` verdict produces `blocked` consensus unless Codex records a permitted user-level escalation.
- A `revise` verdict produces `needs-revision` unless Codex explicitly approves at round 10 or later with no blockers.
- Codex `approve` can approve a close round at round 10 or later when there are no `block` verdicts and Opus policy is satisfied or degraded.
- `required-blocking` senior review cannot be degraded into approval; it must block when unavailable.
- `required-when-available` senior review records unavailable evidence and can continue with degraded evidence.
- User escalations are created only for user-level categories and include practical impact/options.
- Technical categories are recorded as Codex rationale and do not create user escalations.
- Round-15 unresolved material disagreement creates an open user escalation with practical impact evidence.
- Workflow `planningStatus` updates to `in-consensus`, `approved`, or `escalated` according to the result.
- Public MCP schemas and outputs do not expose internal prompts, secrets, raw provider payloads, command args, provider session ids, or provider-specific implementation details.

## Required Edge Cases

Selected from the L11 matrix:

- Input validation: missing workflow id, unsafe workflow id, empty verdicts, non-object verdicts, invalid verdict status, empty summaries, invalid Codex decision status/category, invalid round mode, invalid senior reviewer status, invalid escalation category, empty escalation options.
- MCP handlers: invalid inputs return `validation_error` before service invocation; unknown tools remain explicit; injected dependencies are not called on invalid input.
- State stores: strict workflow parsing still rejects corrupt consensus rounds and user escalations; consensus updates use atomic workflow writes.
- Corruption recovery: corrupt workflow reads are surfaced through shared MCP recovery behavior.
- Consensus rules: default round cap, extended round cap, round-15 escalation, technical versus user-level decision filter, Opus degraded evidence, required-blocking Opus failure.
- Packaged runtime: built `dist/index.js` advertises `agent_team_plan_consensus` and required fields through `npm run smoke:mcp-stdio`.
- Boundary safety: public schemas and workflow views remain sanitized.

## File Plan

- Create `src/core/workflow-consensus.ts`
  - Define `PlanConsensusInput`, `PlanConsensusVerdictInput`, `CodexConsensusDecisionInput`, and `SeniorReviewerEvidenceInput`.
  - Validate round mode and consensus inputs.
  - Append one planning consensus round.
  - Evaluate planning consensus status and workflow `planningStatus`.
  - Record Codex rationale and user escalations.
  - Record senior reviewer evidence using the existing workflow evidence model.
  - Write the updated workflow atomically and return `WorkflowView`.
- Modify `src/core/workflow-types.ts`
  - Add `WorkflowConsensusRound` fields only if required for state evidence; prefer existing fields if sufficient.
- Modify `src/core/state/workflow-store.ts`
  - Strict-parse any new consensus fields if added.
- Modify `src/core/workflow-view.ts`
  - Keep consensus and escalation output sanitized; expose only fields needed for Codex orchestration.
- Modify `src/mcp/schemas.ts`
  - Add metadata and provider-neutral input schema for `agent_team_plan_consensus`.
- Modify `src/mcp/tools.ts`
  - Add tool name, parser, dependency injection, handler branch, validation-before-service behavior, and shared recovery.
- Modify `scripts/smoke-mcp-stdio.mjs`
  - Assert `agent_team_plan_consensus` required fields.
- Test `tests/core/workflow-consensus.test.ts`
  - Consensus rules, round caps, senior-review behavior, decision filter, strict state output.
- Test `tests/core/state/workflow-store.test.ts`
  - Strict parsing remains valid for appended consensus/user escalation/senior evidence.
- Test `tests/core/workflow-view.test.ts`
  - Sanitized consensus/evidence output remains free of provider internals.
- Test `tests/mcp/tools.test.ts`
  - Metadata, validation fail-before-service, handler behavior, recovery behavior.
- Test `tests/mcp/server.test.ts`
  - Server registration and provider-neutral metadata.
- Test `tests/package-runtime.test.ts`
  - Smoke script covers the new tool.
- Modify this plan
  - Mark complete and record red/green/full verification evidence after implementation.

## Task 1: Consensus Core

**Files:**

- Create: `src/core/workflow-consensus.ts`
- Test: `tests/core/workflow-consensus.test.ts`

- [ ] **Step 1: Write failing consensus tests**

Add tests proving:

- appending a first round creates round `1`, phase `planning`, and `planningStatus: "in-consensus"`
- all approve verdicts plus Codex approval marks planning `approved`
- revise verdicts keep planning in consensus before round 10
- round 11 without `extended` mode is rejected
- round 16 with `extended` mode is rejected
- round 15 unresolved disagreement creates `planningStatus: "escalated"` and an open user escalation
- technical Codex decisions append rationale but do not create user escalations
- user-level Codex decisions create user escalations only when practical options are supplied
- `required-when-available` senior reviewer unavailable evidence is recorded as degraded continuation
- `required-blocking` senior reviewer unavailable evidence blocks approval

- [ ] **Step 2: Run focused tests and verify red**

Run:

```bash
npm test -- tests/core/workflow-consensus.test.ts
```

Expected: fail because `workflow-consensus.ts` does not exist.

- [ ] **Step 3: Implement minimal consensus service**

Create:

```ts
export async function planConsensus(input: PlanConsensusInput): Promise<{ readonly workflow: WorkflowView }>
```

Use `readWorkflowRecord`, `writeWorkflowRecord`, `appendCodexRationale`, `classifyUserEscalation`, and `toWorkflowView`. Do not call providers, lifecycle, dispatch, or mailbox code.

- [ ] **Step 4: Run focused tests and verify green**

Run:

```bash
npm test -- tests/core/workflow-consensus.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts
```

Expected: consensus, store, and view tests pass.

## Task 2: Public MCP Tool

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`
- Test: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add tests proving:

- `agent_team_plan_consensus` appears in tool metadata and server registration
- required schema fields include `workflowId`, `codexDecision`, and `verdicts`
- invalid inputs return `validation_error` before injected `planConsensus` is called
- valid inputs delegate to the injected service and return its sanitized workflow view
- state corruption is routed through shared recovery behavior

- [ ] **Step 2: Run focused MCP tests and verify red**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: fail because the tool is not registered.

- [ ] **Step 3: Implement MCP schema and handler**

Add `agent_team_plan_consensus` to tool names, metadata, parser helpers, dependency injection, and handler dispatch. Keep the public schema provider-neutral and do not expose internal prompts or provider-specific implementation details.

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

Assert the packaged smoke script checks required fields for `agent_team_plan_consensus`.

- [ ] **Step 2: Run package-runtime test and verify red**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: fail because the smoke script does not cover the new tool.

- [ ] **Step 3: Update stdio smoke**

Add:

```js
assertToolRequires(tools.tools, "agent_team_plan_consensus", [
  "workflowId",
  "codexDecision",
  "verdicts"
]);
```

- [ ] **Step 4: Run full milestone verification**

Run:

```bash
npm test -- tests/core/workflow-consensus.test.ts tests/core/state/workflow-store.test.ts tests/core/workflow-view.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts
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
! rg -n "allowApiKeyFallback:\\s*true|apiKeyFallback\\s*:\\s*true" src .codex-plugin package.json
! rg -n "hiddenPrompt|internalPrompt|rawProvider|raw provider|providerPayload|provider payload" src/mcp src/core .codex-plugin
! rg -n "mock LLM|heuristic LLM|heuristic.*benchmark|mock.*benchmark|provider-ranking" src scripts .codex-plugin
rg -n "agent_team_plan_consensus|WorkflowConsensusRound|WorkflowUserEscalation|WorkflowOpusReviewEvidence|StateCorruptionError" src tests docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-53.md
```

Expected: the negated scans return no matches; the workflow scan shows only implementation, tests, and docs guardrail matches.

- [ ] **Step 6: Mark plan complete and commit**

Update this plan with the implementation summary and verification evidence, then commit the milestone implementation.

