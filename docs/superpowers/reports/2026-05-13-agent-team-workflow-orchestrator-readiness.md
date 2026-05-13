# Agent Team Workflow Orchestrator Readiness Report

Date: 2026-05-13

## Final Decision: Complete

The L11 Agent Team Workflow Orchestrator product-level success criteria are met for the accepted v1 scope. Codex can use the plugin as a provider-neutral workflow control plane for planning, consensus, slice orchestration, review, integration ordering, final-gate evidence, completion reporting, and evidence-preserving cleanup handoff.

Codex remains the senior engineer, orchestrator, reviewer, integrator, and final authority. The plugin organizes durable workflow state and agent-team evidence; it does not auto-merge, auto-commit to the source checkout, or auto-clean retained implementation evidence.

Future work requires a new product requirement. Repeating the same workflow-orchestrator continuation prompt should stop at this report unless the user asks for a new feature, a new provider capability, live-provider proof, or a changed product default.

## Evidence Map

| Product criterion | Evidence |
| --- | --- |
| Primary v1 transport remains Claude Code CLI subscription OAuth | `README.md`, `docs/runbooks/claude-team-session.md`, provider config tests, doctor tests, and the roadmap state Claude Code CLI subscription OAuth as the primary v1 transport. |
| Opus senior review is default-on required-when-available | `docs/superpowers/specs/2026-05-13-l11-agent-team-workflow-orchestrator-design.md`, config tests, and workflow consensus/review tests cover `required-when-available`, unavailable Opus, and degraded evidence. |
| Users are asked only CEO/product-level decisions | Workflow consensus and review tests cover the user decision filter; the runbook says user escalation is CEO/product-level and practical. |
| No yes-man consensus | The design requires best-solution advocacy; planning and review verdicts preserve approve, revise, block, and abstain evidence rather than forcing agreement. This is the no yes-man posture. |
| Consensus loops support 10 rounds and 15 rounds | Workflow consensus/review tests and the design cover 10 rounds by default, 15 rounds only when close, and escalation when unresolved at round 15. |
| Expanded L11 full-stack roster exists | Role definitions and the design include the expanded L11 full-stack roster: architect, planner, UI/UX, frontend, backend, code review, test design, QA, test hardening, security, performance, devops/release, docs/DX, integration, and slice implementation roles. |
| Slice DAG and blocked/unblocked workflow are durable | Workflow state, slice-start, unblock, and packaged smoke tests cover slice DAG records, blocked/unblocked transition evidence, dependency evidence, and per-slice addressability. |
| Implementation agents write only in retained isolated worktrees | Role capability policy, workspace config, lifecycle/workspace tests, live matrix docs, and Ollama write validation preserve retained isolated worktrees for write-capable implementation roles. |
| Reviews and sign-off happen before integration | `agent_team_review_slice`, review consensus tests, and the runbook require implementation evidence, reviewer verdicts, Codex sign-off, Opus posture when available, and approval before integration. |
| Integration queue is read-only | `agent_team_integration_queue` tests and runbook prove the read-only integration queue emits ordering, conflict risk, retained worktree paths, and focused tests without merge execution. |
| Integration remains Codex-owned | The runbook and workflow evidence tests require Codex-owned manual integration and `agent_team_record_integration` after Codex has integrated and verified the slice. |
| Final completion requires final gate evidence | `agent_team_workflow_report`, workflow report tests, integration evidence tests, and `npm run smoke:workflow-orchestrator` prove `completionStatus` becomes complete only after durable passing final gate evidence exists for every slice. |
| Cleanup is explicit and evidence-preserving | Completion report rows, cleanup docs, and lifecycle cleanup tests preserve cleanup only after integration evidence is saved. |
| Public MCP schemas remain provider-neutral | MCP schema and tools tests assert provider-neutral public MCP schemas, no provider-specific public workflow schema leakage, no internal prompts, and no raw provider details. |
| No hidden fallback | Config, routing, provider, and docs tests preserve No API-key fallback unless explicitly configured and keep provider selection capability-routed. |
| Batch/workflow outputs preserve addressability and partial evidence | Batch tests and workflow tests cover bounded concurrency, ordered results, partial-failure evidence, per-run addressability, and per-slice addressability. |
| Recovery and evidence remain first-class | State store, mailbox, lifecycle, dashboard, summary, and recovery tests preserve sidecars, mailboxes, verdicts, status, wind-down, cleanup, recovery, and evidence. |

## Public Workflow Tool Surface

The workflow orchestrator is available through public MCP tools:

- `agent_team_create_workflow`
- `agent_team_get_workflow`
- `agent_team_list_workflows`
- `agent_team_plan_consensus`
- `agent_team_start_slices`
- `agent_team_unblock_slice`
- `agent_team_review_slice`
- `agent_team_integration_queue`
- `agent_team_record_integration`
- `agent_team_workflow_report`

The broader team control plane remains available through existing team, dashboard, status, message, wind-down, cancel, summary, and cleanup tools.

## Proof Boundary

`npm run smoke:workflow-orchestrator` is fixture-safe and part of `npm run ci`. It runs against packaged `dist/index.js` over MCP stdio, creates a disposable git workspace, proves blocked/unblocked workflow behavior, records degraded Opus evidence, proves final gate completion behavior, and removes the fixture. This is control-plane proof, not a live provider proof.

Live provider proof is required before claiming new real Opus sign-off behavior, new provider implementation readiness, or new model behavior. Existing opt-in live scripts remain separate from CI and must be run intentionally with the relevant confirmation flag and workspace policy.

No benchmark, model-quality, provider-ranking, long-context, or broad coding-readiness claim is made from this readiness report. There is no new live-provider capability claim.

## Verification Gate

The final accepted gate for this report is:

- `npm test -- tests/docs/workflow-readiness.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run smoke:mcp-stdio`
- `npm run smoke:workflow-orchestrator`
- `npm run smoke:package`
- invariant scan for public documentation leakage and unsafe overclaim patterns
- `npm run ci`
- `git diff --check`

`npm run ci` includes typecheck, full tests, build, install preflight, packaged stdio smoke, workflow orchestrator smoke, and package smoke.

## Stop Condition

The accepted workflow-orchestrator product goal is complete. Stop continuing this same goal after this milestone unless the user supplies a new product decision, new provider target, changed safety policy, live proof request, release task, or bug report.
