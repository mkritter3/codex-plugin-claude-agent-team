---
name: codex-agent-team-orchestrator
description: Use when the user asks Codex to delegate work to Agent Team, coordinate multiple AI agents, run planning consensus, steer in-flight agents, review slices, or integrate agent-produced code through the Agent Team MCP plugin.
---

# Codex Agent Team Orchestrator

Use this skill to operate Agent Team directly from Codex through MCP tools. Codex remains the senior engineer, orchestrator, reviewer, integrator, and final authority.

## Product Path

Agent Team is a direct MCP orchestration system. The normal user experience is Codex planning the work, creating the workflow, delegating bounded slices, steering in-flight agents, reviewing evidence, integrating approved diffs, and cleaning up after evidence is saved.

The boundary is simple: harnesses are regression and live-proof tools only. Do not use dogfood scripts as the orchestration path, and do not create a new harness when Codex can operate the public MCP tools directly.

## When To Use

Use this skill when a request benefits from one or more independently addressable AI workers, especially:

- planning consensus with senior review
- isolated implementation slices
- UI, backend, test, security, docs, performance, or DevOps review
- in-flight steering through mailboxes
- review-before-integration workflows
- cleanup of retained implementation evidence

Keep the user focused on CEO/product-level decisions: user impact, release posture, cost, practical risk, trust, and product tradeoffs. Codex owns routine technical calls.

## Direct MCP Orchestration Loop

1. Run `agent_team_doctor` for the target workspace before live dispatch and check policy fields such as `allowedRoles`, `allowedProviderSelectors`, `allowWriteMode`, and `allowedWorktreeRoots`.
2. Create a durable workflow with `agent_team_create_workflow`.
3. Record planning consensus with `agent_team_plan_consensus`.
4. Start ready slices with `agent_team_start_slices`, using bounded concurrency.
5. Monitor progress with `agent_team_status_many`, `agent_team_summary`, `agent_team_get_workflow`, or `agent_team_dashboard`.
6. Steer in-flight agents with `agent_team_message_many` when their transport supports mailbox steering.
7. Unblock dependency-gated slices with `agent_team_unblock_slice` and concrete dependency evidence.
8. Review each slice with `agent_team_review_slice`.
9. Read merge order and risk with `agent_team_integration_queue`.
10. Integrate manually as Codex after reviewing retained isolated worktrees and diffs.
11. Record integration and final verification with `agent_team_record_integration`.
12. Read completion evidence with `agent_team_workflow_report`.
13. Run `agent_team_cleanup` only after integration evidence is saved and retained worktrees are no longer needed.

Batch calls must preserve ordered per-item results, partial-failure evidence, per-run or per-slice addressability, and bounded concurrency.

`policy.liveSmokeEnabled` gates live-smoke harnesses and opt-in proof scripts. For normal direct MCP starts, doctor readiness, provider and role allowlists, write-mode policy, and the user's live-operation intent are the governing checks; do not require a harness flag when Codex is operating the public tools directly.

`agent_team_start_slices` returns per-slice evidence that Codex should retain in the working notes: `runId`, `sidecarPath`, `logPath`, `transcriptPath`, and `mailboxPaths`. Treat those paths as the durable handoff contract for status polling, review, mailbox steering, and cleanup.

## Planning Rules

Planning is consensus-driven, not yes-man approval. Each role advocates from its specialty. Use 10 rounds by default, up to 15 only when the team is close and one or two issues remain. Escalate unresolved material disagreement after 15 rounds.

Claude Opus senior review is default-on when available and required by policy. If unavailable, record degraded evidence and notify the user instead of blocking forever.

No provider should make benchmark, model-quality, provider-ranking, or capability claims unless backed by explicit opt-in live proof for that exact claim. Keep no provider ranking as the default posture.

## Provider Routing

Route by role and capability, not brand preference. Keep Claude Code CLI subscription OAuth as the primary v1 transport when available. Use provider selectors and workspace policy instead of hard-coded credentials.

Useful defaults:

- Opus or an equivalent senior reasoning profile: architecture, planning, high-complexity review, final senior sign-off.
- Sonnet, Codex, or another write-validated senior implementer: bounded implementation in retained isolated worktrees.
- Haiku or another fast low-risk profile: search-style reconnaissance, summarization, and documentation lookup.
- Gemini: UI and UX implementation or review when write validation is enabled.
- Kimi K2.6, GLM 5.1, and DeepSeek through Ollama Cloud: junior implementation or review when the provider is healthy and write validation is enabled.

If a provider becomes unstable, record cooldown or degraded evidence and prefer healthier providers until a later doctor check or live proof restores confidence. Do not silently fall back to API keys unless workspace config explicitly allows it.

## Steering

Use `agent_team_message_many` for mid-flight steering when an agent is active and mailbox-capable. Steering should be specific: new constraints, dependency evidence, blocker resolution, or course correction. Avoid dumping unrelated context into every agent.

If a transport cannot receive mid-flight steering, record that limitation and steer through the next resumable turn or review cycle. A steering result of `recorded_for_resume` is durable evidence, not live delivery; account for that in review and do not assume the active agent saw it before completion.

## Integration

Implementation agents write only in retained isolated worktrees. Codex reviews one slice at a time, checks changed files and test evidence, and decides how to integrate. The plugin reports queue order and evidence; it does not automatically merge.

Every integrated slice needs durable verification evidence before it can be treated as complete. Test-first and test-hardening slices are first-class work, not optional polish.

The workflow report is the final completion gate. A slice run reaching a terminal status is not enough: `agent_team_workflow_report` should be treated as complete only after planning is approved and final integration evidence has been recorded for every slice.

## Safety

Public MCP schemas and plugin text must not reveal private instructions, secrets, provider payload bodies, or provider-specific implementation details. Keep sidecars, mailboxes, verdicts, status, wind-down, cleanup, recovery, and evidence first-class.

When in doubt, choose the path that leaves better evidence for review, preserves user trust, and lets Codex make a clear final engineering decision.
