---
name: codex-agent-team-orchestrator
description: Use when the user asks Codex to delegate work to Agent Team, coordinate multiple AI agents, run planning consensus, steer in-flight agents, review slices, or integrate agent-produced code through the Agent Team MCP plugin.
---

# Codex Agent Team Orchestrator

Use this skill to operate Agent Team directly from Codex through MCP tools. The active Codex session coordinates execution and integration. The selected sole reviewer or unanimous panel has decision authority; the coordinator never overrides its verdicts.

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

## Operator Discovery

Before using Agent Team, verify that the current Codex session exposes the public MCP tools. Use `tool_search` for `agent_team_doctor` or another `agent_team_*` tool when the tools are not already visible. If no `agent_team_*` tools are callable, the plugin MCP is not loaded in this session; tell the user to run `/reload-plugins` or restart Codex before claiming direct Agent Team orchestration is available.

When debugging or changing Agent Team itself, read the source repo, not only this skill. The skill path is normally in the installed cache, while the editable source repo is the current workspace or local plugin marketplace checkout. Compare source repo and installed cache when behavior differs, then rebuild/reinstall/reload before trusting the live tool surface.

If a tool call returns `Transport closed`, treat it as a live MCP transport failure. Run the install preflight and stdio smoke from the installed cache or source repo when shell access is available, then reload/restart Codex and rerun `agent_team_doctor`; native subagents are a supported execution route, but they do not replace the durable MCP workflow record. Restore the MCP connection before claiming workflow gates, provider routing, mailbox steering or cleanup are recorded.

## Workspace Compatibility Preflight

Before the first delegation in a workspace, after a plugin update, or when reopening an older workflow, read the target workspace's `.agent-team/config.json` and relevant Agent Team setup guidance. A successful config load or `schemaVersion: 1` does not prove that provider names, executable paths, model pins, or saved workflow targets are current.

Follow [workspace configuration migration](references/workspace-configuration.md). Apply known mechanical migrations to the actual workspace files, preserving user overrides and permissions; compatibility aliases alone leave stale instructions on disk. Check saved draft workflow targets too. Keep a reviewable diff or local backup, and report the changed fields without exposing credentials. Do not replace the whole config with a default template.

Run `agent_team_list_providers` and `agent_team_doctor` with the same explicit workspace `cwd` after edits and before dispatch. Gemini subscription runs must resolve to `agy`; if the live server still advertises `gemini-cli`, reload the plugin or start a new Codex session before continuing. An unavailable pinned model or a change in decision authority requires resolving that choice, not silently substituting a model. Repeat this check when workspace configuration changes, not on every status poll.

## Direct MCP Orchestration Loop

1. Complete the workspace compatibility preflight, persist applicable migrations, then run `agent_team_list_providers` and `agent_team_doctor` for the target workspace before live dispatch. Check policy fields such as `allowedRoles`, `allowedProviderSelectors`, `allowWriteMode`, and `allowedWorktreeRoots`.
2. Create a durable workflow with `agent_team_create_workflow`, then select planning/review decision makers and an implementation default with `agent_team_configure_orchestration`. Read [native and cross-provider orchestration](references/orchestration.md) for exact schemas and execution boundaries.
3. Call `agent_team_prepare_assignments` for planning. Reuse a runtime-confirmed matching active model/effort; otherwise use host-native agents or the exact provider. Record their artifact-bound votes with `agent_team_plan_consensus`.
4. Prepare implementation assignments. Use native host tools for native routes and `agent_team_start_slices` for provider routes, with bounded concurrency. Record native results through `agent_team_record_native_implementation`.
5. Monitor progress with `agent_team_status_many`, `agent_team_summary`, `agent_team_get_workflow`, or `agent_team_dashboard`.
6. Steer in-flight agents with `agent_team_message_many` when their transport supports mailbox steering.
7. Unblock dependency-gated slices with `agent_team_unblock_slice` and concrete dependency evidence.
8. Prepare independent review assignments, gather every selected vote on the same revision, then record them with `agent_team_review_slice`.
9. Read merge order and risk with `agent_team_integration_queue`.
10. Integrate manually as Codex after reviewing retained isolated worktrees and diffs.
11. Record integration and final verification with `agent_team_record_integration`.
12. Read completion evidence with `agent_team_workflow_report`.
13. Run `agent_team_cleanup` only after integration evidence is saved and retained worktrees are no longer needed.

Batch calls must preserve ordered per-item results, partial-failure evidence, per-run or per-slice addressability, and bounded concurrency.

`policy.liveSmokeEnabled` gates live-smoke harnesses and opt-in proof scripts. For normal direct MCP starts, doctor readiness, provider and role allowlists, write-mode policy, and the user's live-operation intent are the governing checks; do not require a harness flag when Codex is operating the public tools directly.

`agent_team_start_slices` returns per-slice evidence that Codex should retain in the working notes: `runId`, `sidecarPath`, `logPath`, `transcriptPath`, and `mailboxPaths`. Treat those paths as the durable handoff contract for status polling, review, mailbox steering, and cleanup.

After rebuilding or reinstalling the plugin, use `/reload-plugins` or restart Codex, then rerun `agent_team_doctor`. The live server should report `mcp-runtime.details.workflowWriteScopeAllowsEmpty: true`; if it does not, or if Agent Team tools return `Transport closed`, reload/restart before continuing. Because stale Agent Team MCP server processes can keep serving old schemas even when the repo build is current, treat `mcp-runtime` as the direct MCP schema proof for the running server.

## Planning Rules

Planning is consensus-driven, not yes-man approval. Each role advocates from its specialty. Stop as soon as the selected authority approves. The limit is 10 rounds by default, up to 15 only when the team is close and one or two issues remain. Never spend rounds merely to reach the limit. Escalate unresolved material disagreement after 15 rounds.

For configured workflows, the explicit decision roster replaces legacy Opus defaults. Do not add an extra Opus or Astra seat. If the sole selected reviewer is Astra, Astra decides. If the user chooses a panel, every member must approve; unavailable members do not disappear from the roster.

No provider should make benchmark, model-quality, provider-ranking, or capability claims unless backed by explicit opt-in live proof for that exact claim. Keep no provider ranking as the default posture.

## Provider Routing

Honor explicit native/provider assignments first. Preserve the user-selected coordinator, including Astra for visual work. Native planning reuses the active model only when model and effort match; independent review remains separate. For legacy or unpinned advisory calls, the built-in provider order prefers Ollama-native Claude Code first for read-oriented roles, then Claude Code CLI, Ollama Cloud chat-completions, AGY, and Codex CLI. Use provider selectors and workspace policy instead of hard-coded credentials.

For Claude Code CLI profiles, omitting `providers.claudeCodeCli.profiles` inherits the built-in Opus profile. Set `profiles: []` intentionally disables that default senior-review profile.

Legacy provider defaults (the configured decision roster takes precedence):

- Claude Code CLI Opus (`claude-code-cli:opus`): default read-only senior review profile for architecture, planning, high-complexity review, and final senior sign-off when Claude Code CLI is available.
- Sonnet, Codex, or another write-validated senior implementer: bounded implementation in retained isolated worktrees.
- Haiku or another fast low-risk profile: search-style reconnaissance, summarization, and documentation lookup.
- Gemini via AGY: UI and UX review; implementation only after AGY write validation. Use provider `agy` and confirm exact model IDs with `agy models`.
- GLM 5.2 through Ollama-native Claude Code (`ollama-claude-code:glm-5.2`): preferred junior implementation or review when doctor shows local Ollama and Claude Code are ready and the provider is healthy; isolated implementation still requires normal write-mode policy.
- Kimi K2.7 Code through Ollama-native Claude Code (`ollama-claude-code:kimi-k2.7-code`): research, review, or bounded junior implementation when doctor shows local Ollama and Claude Code are ready and the provider is healthy; isolated implementation still requires normal write-mode policy.

Ollama Claude Code defaults to `launchMode: "ollama-launch"`, which uses the locally authenticated Ollama installation and does not require `OLLAMA_API_KEY` when Ollama is already signed in. Doctor can verify local CLIs and warns that cloud model access is not live-proved until an opt-in model smoke succeeds. `launchMode: "direct-api"` is the explicit fallback for direct remote API access and is the only Ollama Claude Code mode that requires `OLLAMA_API_KEY`.

If a provider becomes unstable, record cooldown or degraded evidence and prefer healthier providers until a later doctor check or live proof restores confidence. Do not silently fall back to API keys unless workspace config explicitly allows it.

For Ollama Claude Code, prefer exact provider ids or `family:ollama-claude-code`. Do not use broad `model:*` selectors for GLM/Kimi when both `ollama-cloud:*` and `ollama-claude-code:*` families are configured; ambiguous selectors fail closed by design.

## Steering

Use `agent_team_message_many` for mid-flight steering when an agent is active and mailbox-capable. Steering should be specific: new constraints, dependency evidence, blocker resolution, or course correction. Avoid dumping unrelated context into every agent.

If a transport cannot receive mid-flight steering, record that limitation and steer through the next resumable turn or review cycle. A steering result of `recorded_for_resume` is durable evidence, not live delivery; account for that in review and do not assume the active agent saw it before completion.

## Integration

Implementation agents write only in retained isolated worktrees. The selected authority reviews each slice; Codex checks its approval, changed files, test evidence and current artifact digest, then integrates. The plugin reports queue order and evidence; it does not automatically merge.

Every integrated slice needs durable verification evidence before it can be treated as complete. Test-first and test-hardening slices are first-class work, not optional polish.

The workflow report is the final completion gate. A slice run reaching a terminal status is not enough: `agent_team_workflow_report` should be treated as complete only after planning is approved and final integration evidence has been recorded for every slice.

## Safety

Public MCP schemas and plugin text must not reveal private instructions, secrets, provider payload bodies, or provider-specific implementation details. Keep sidecars, mailboxes, verdicts, status, wind-down, cleanup, recovery, and evidence first-class.

When in doubt, choose the path that leaves better evidence for review, preserves user trust, and lets Codex make a clear final engineering decision.
