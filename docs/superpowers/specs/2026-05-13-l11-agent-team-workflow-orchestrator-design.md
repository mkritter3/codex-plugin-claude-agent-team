# L11 Agent Team Workflow Orchestrator Design

Date: 2026-05-13
Status: Proposed source-of-truth design

## Purpose

The Agent Team plugin should evolve from durable agent primitives into a senior-engineer-led full-stack development workflow. Codex remains the orchestrator, senior engineer, reviewer, integrator, and final authority. External agents provide specialist critique, implementation, testing, and evidence inside provider-neutral lifecycle contracts.

The workflow must feel like an L11 engineering team: opinionated, test-driven, evidence-first, safe under parallel work, and honest about unresolved product tradeoffs. It must not become a yes-man consensus machine, a hidden auto-merge system, or a provider-specific Claude wrapper.

## Core Invariants

- Claude Code CLI subscription OAuth remains the primary v1 transport.
- Codex owns final technical decisions, integration order, merge decisions, and release gates.
- The user is asked only product, CEO, trust, cost, release-posture, or practical user-impact questions.
- Technical implementation choices are decided by Codex after specialist input and recorded as evidence.
- Agents never auto-merge, auto-commit to the source checkout, or delete evidence.
- Implementation agents write only inside retained isolated worktrees.
- Every planning and implementation workflow is goal-driven and test-driven.
- No agent is asked to agree for agreement's sake; every role advocates for the best outcome from its specialty.
- Public MCP schemas stay provider-neutral and do not expose internal prompts or provider-specific implementation details.
- Benchmark, model-quality, provider-ranking, long-context, and broad coding-readiness claims require real provider evidence.

## Expanded L11 Role Roster

The initial full-stack roster should include these roles.

| Role | Default Mode | Purpose |
| --- | --- | --- |
| `architect` | read-only | Source-of-truth boundaries, modularity, maintainability, platform fit. |
| `planner` | read-only | Sequencing, dependency graph, risk, slice boundaries. |
| `ui-ux-designer` | read-only | Interaction design, visual hierarchy, accessibility, workflow ergonomics, copy fit. |
| `frontend-engineer` | isolated-edit | UI implementation, state wiring, component boundaries, browser/user-flow validation. |
| `backend-engineer` | isolated-edit | APIs, persistence, server/runtime contracts, auth and data boundaries. |
| `slice-implementer` | isolated-edit | General bounded implementation work in retained worktrees. |
| `code-reviewer` | read-only | Correctness, regressions, maintainability, diff review. |
| `test-designer` | read-only | Acceptance tests and focused TDD plan before implementation. |
| `qa-engineer` | read-only | User-flow validation, edge cases, regression posture, real-world acceptance behavior. |
| `test-hardening-engineer` | read-only | Adversarial test strengthening, malformed inputs, races, corruption, partial failures, production-like failure modes. |
| `security-reviewer` | read-only | Secrets, permissions, injection, data exfiltration, provider/tool trust boundaries. |
| `performance-reviewer` | read-only | Latency, memory, concurrency, large-state behavior, cost of lifecycle and provider calls. |
| `devops-release-engineer` | read-only | CI, packaging, install, deployment, rollback, release and migration gates. |
| `docs-dx-writer` | read-only | Runbooks, setup, troubleshooting, operator handoff, developer experience. |
| `integration-engineer` | read-only | Merge ordering, conflict risk, combined diff coherence, integration evidence. |

Write-capable specialist roles must require the same `edits`, `workspaceIsolation`, `tools`, `sessionResume`, and `cancellation` capabilities as `slice-implementer`. Read-only roles should stay conservative and can be routed to non-Claude providers only when declared capabilities satisfy the role.

## Senior Review Policy

Codex and Claude Opus are the default senior sign-off pair.

The default policy is **default-on, opt-out senior review**:

```json
{
  "seniorReview": {
    "opusPlanning": {
      "mode": "required-when-available"
    },
    "opusImplementation": {
      "mode": "required-when-available"
    }
  }
}
```

Supported modes:

- `disabled`: do not request Opus for that workflow class.
- `optional`: Codex may request Opus for high-risk or ambiguous work.
- `required-when-available`: request Opus and require sign-off when reachable; if unavailable, continue with Codex sign-off after notifying the user and recording degraded evidence.
- `required-blocking`: block until Opus signs off or the user changes policy. This must never be the default.

Environment overrides should exist for global plugin-level behavior:

```bash
AGENT_TEAM_OPUS_PLANNING_REVIEW=required-when-available
AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW=required-when-available
```

Workspace config may override global defaults for a specific repository. Config precedence should be explicit: request override, workspace config, environment, plugin default.

Opus unavailability is not silent. The workflow records provider id, requested role, availability result, fallback mode, and the user notification that Codex continued with degraded senior-review posture.

## Decision Filter

Agents escalate questions to Codex first. Codex escalates to the user only when the decision is product-level or affects practical business/user consequences.

User-facing escalation categories:

- Product behavior, user workflow, default UX, user trust, or positioning.
- Privacy, data exposure, security risk acceptance, or permission posture.
- Provider usage cost, speed versus quality tradeoff, or external dependency commitment.
- Release posture: internal tool, private beta, production release, migration, or rollback tolerance.
- Ambiguity where two valid technical paths materially change app behavior or user expectations.

Codex-owned decision categories:

- File/module boundaries.
- Test strategy details.
- Provider routing that preserves configured policy.
- Slice decomposition and dependency ordering.
- Merge order and conflict resolution.
- Refactor shape when it preserves the approved product behavior.

Every escalation should include the practical effect, not raw technical minutiae.

## Planning Consensus Workflow

Planning begins with a goal packet:

- user goal
- non-goals
- practical product effects
- success criteria
- constraints and invariants
- target roles
- proposed slices
- initial acceptance tests
- known risks

Planning then runs a consensus council:

1. Codex drafts the initial plan and slice decomposition.
2. Core planning agents review in parallel: `architect`, `planner`, `ui-ux-designer`, `test-designer`, `security-reviewer`, `performance-reviewer`, `devops-release-engineer`, `docs-dx-writer`, and Claude Opus when enabled.
3. Each agent must provide `agree`, `revise`, or `block`, with evidence and best-solution advocacy.
4. Codex synthesizes revisions and starts the next round if needed.
5. The default cap is 10 rounds.
6. If the plan is close at round 10, Codex may make a final senior-engineer decision and record dissent.
7. If material disagreement remains but convergence is plausible, Codex may extend to 15 rounds.
8. At round 15, unresolved material disagreement must be flagged to the user with the product or risk tradeoff.

Issues that belong to the user decision filter must be flagged during the rounds as soon as they are known, not saved until round 10 or 15.

Consensus does not require unanimity. It requires:

- Codex sign-off.
- Opus sign-off when enabled and available.
- No unresolved blocker that violates a non-negotiable invariant.
- Recorded rationale for any overruled dissent.

## Slice DAG And Blocked Work

Approved plans become a slice dependency graph.

Each slice should include:

- stable slice id
- role owner
- write scope
- read scope
- dependencies
- acceptance tests
- expected evidence
- risk level
- required reviewers
- integration order hint

Slice states:

- `planned`
- `blocked`
- `ready`
- `running`
- `awaiting-review`
- `needs-revision`
- `approved`
- `integrated`
- `failed`
- `cancelled`

Blocked slices can operate in two modes:

- `deferred-start`: do not start until dependencies are approved or integrated.
- `prep-then-wait`: start read-only prep, inspect context, write no code, then wait for mailbox unblock evidence.

When a dependency unblocks, the orchestrator sends a mailbox message containing the dependency run id, summary, changed files, evidence paths, and any integration caveats. Dependent write slices must re-check current source state before editing.

## Implementation Workflow

Implementation is TDD by default.

1. Codex creates implementation slices from the approved DAG.
2. Test-focused roles define or review acceptance tests before write agents begin.
3. Ready independent slices start in parallel with bounded concurrency.
4. Write agents operate only in retained isolated worktrees.
5. Each agent reports changed files, diff evidence, tests run, risks, and blockers.
6. Failed or blocked runs keep their sidecars, logs, transcripts, mailboxes, and worktree evidence.
7. Codex decides whether to revise, cancel, reassign, or integrate.

Agents may not broaden their write scope without asking Codex. Codex may adjust the DAG and notify affected agents through mailboxes.

## Review Consensus Workflow

Every implementation slice requires review before integration.

Default required reviewers:

- Codex.
- Claude Opus when enabled and available.
- `code-reviewer`.
- `test-hardening-engineer`.
- Relevant specialists based on touched surface: frontend, backend, UI/UX, security, performance, devops/release, docs/DX.

Review uses the same 10-round default and 15-round maximum pattern:

1. Reviewers inspect diff evidence, tests, sidecars, logs, and acceptance criteria.
2. They return `approve`, `revise`, or `block`.
3. Codex synthesizes required changes and sends revision messages or starts follow-up runs.
4. At round 10, Codex may decide if remaining disagreement is minor and no invariant is violated.
5. Up to 15 rounds are allowed for close but unresolved review.
6. At round 15, unresolved material disagreement is flagged to the user if it affects product, trust, cost, release posture, or practical user impact.

No implementation slice can be integrated with:

- failing required tests
- missing changed-file evidence
- unresolved security blocker
- unresolved data-loss or source-worktree mutation concern
- missing Codex sign-off
- missing Opus sign-off when Opus was enabled, available, and required

## Integration And Merge Workflow

The plugin should help organize integration, but Codex performs the final merge.

Integration flow:

1. `integration-engineer` proposes merge order using dependency graph, write scopes, conflict risk, and test cost.
2. Codex reviews one worktree diff at a time.
3. Codex integrates by merge, cherry-pick, or manual patch depending on conflict risk.
4. Focused tests run after each integration step when the blast radius warrants it.
5. Full gates run before final commit or push.
6. Retained worktrees are cleaned up only after integration evidence is saved.

The plugin should never auto-merge multiple agent worktrees into the source checkout. It may produce an integration queue, conflict analysis, and suggested commands, but the final action remains Codex-owned.

## Hook Hierarchy

Guided workflow hooks are deterministic recommendations over durable workflow state. They never start providers, mutate source, merge code, delete worktrees, or claim completion.

1. Brainstorm with the user until product goal, non-goals, success criteria, and practical user effects are clear.
2. Write the plan and run planning consensus.
3. Request user approval for product-level plan effects.
4. Start ready independent slices with bounded concurrency.
5. Record mailbox updates for steering, blockers, and dependency unblocks.
6. Review implementation slices with Codex and senior review.
7. Queue integration in read-only mode.
8. Codex integrates one reviewed slice at a time.
9. Record integration evidence.
10. Run verification gates.
11. Report completion only when final gates are met.
12. Clean up retained worktrees and sidecars only after evidence is saved.

Provider steering modes must be explicit:

- `live`: an active run has an open input channel.
- `recorded_for_resume`: mailbox guidance is durable evidence for resume or follow-up, but the active run is not live-stdin steerable.
- `follow_up_run`: Codex must launch a corrected follow-up run with mailbox evidence.
- `cancel_wind_down`: cancellation or wind-down is the safe intervention before reassignment.
- `unsupported`: the provider or lifecycle state cannot accept steering.

Default provider-role policy:

- Opus for planning, architecture, high-complexity review, security-sensitive decisions, and senior sign-off.
- Sonnet and Codex CLI for autonomous implementation in retained isolated worktrees.
- Haiku for search and reconnaissance.
- Gemini CLI as a full autonomous worker, primarily for UI, UX, frontend, visual, and browser-flow work.
- Kimi K2.6, GLM 5.1, and DeepSeek-style Ollama Cloud profiles as junior bounded workers requiring isolated worktrees and senior review before integration.

## Evidence Model

New workflow records should remain provider-neutral and durable under `.agent-team/`.

Required evidence:

- consensus session id
- planning rounds and reviewer verdicts
- user escalations and decisions
- slice DAG
- dependency unblock messages
- implementation run ids
- review rounds and reviewer verdicts
- Opus availability and sign-off state
- Codex senior-engineer decisions
- integration queue
- final verification commands and results
- cleanup state

Do not record raw secrets, provider command args, private prompts, provider session ids in public summaries, or mailbox payloads in broad dashboards unless explicitly requested through existing evidence tools.

## Proposed MCP Surface

The first implementation should be small and composable.

Potential tools:

- `agent_team_create_workflow`: create a durable workflow record from goal, constraints, and requested workflow policy.
- `agent_team_plan_consensus`: run or continue planning consensus rounds.
- `agent_team_get_workflow`: read workflow, rounds, slice DAG, and evidence pointers.
- `agent_team_start_slices`: start all ready slices with bounded concurrency.
- `agent_team_unblock_slice`: record dependency evidence and notify a blocked/prep slice.
- `agent_team_review_slice`: run or continue review consensus for one slice.
- `agent_team_integration_queue`: read-only integration order and conflict-risk report.

Tool schemas must stay provider-neutral. Opus should be represented as a configured senior reviewer policy and provider selector, not as a public Claude-specific field in every tool.

## Testing And Validation Strategy

Implementation milestones for this workflow must map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.

Required focused proof:

- consensus rounds stop at 10 when Codex can decide
- consensus can extend to 15 when unresolved but close
- unresolved round-15 material disagreement produces user escalation evidence
- product-decision filter escalates only user-level decisions
- technical decisions are recorded as Codex-owned rationale
- Opus default policy is `required-when-available`
- Opus unavailable path records degraded posture and user notification without hard-blocking
- implementation Opus review can be disabled by env/config
- dependency DAG preserves blocked/ready/running/approved/integrated states
- blocked slices can receive mailbox unblock evidence
- `prep-then-wait` slices cannot write before unblock
- review consensus blocks integration on security, test, or source-worktree concerns
- integration queue is read-only and never auto-merges
- workflow summaries do not expose internal prompts, secrets, provider command details, or raw mailbox payloads

Live provider proof is required before claiming real Opus sign-off behavior. Fixture tests can prove policy mechanics, round handling, state transitions, and public MCP contracts without live providers.

## Non-Goals

- No blind autonomous merge.
- No automatic cleanup of implementation worktrees before Codex review.
- No hidden provider fallback when Opus or another senior reviewer is unavailable.
- No model ranking, benchmark, or quality scoring from consensus outcomes.
- No user prompts for routine technical decisions.
- No provider-specific public MCP schema fields for normal workflow operation.

## Open Product Defaults

The agreed defaults are:

- Opus planning review: `required-when-available`.
- Opus implementation review: `required-when-available`.
- Round cap: 10 by default, 15 maximum when close.
- Round-15 unresolved material disagreement escalates to the user.
- User escalation is limited to CEO/product-level practical effects.
- Performance, devops/release, and docs/DX are core L11 roles from the first workflow version.
