# Agent Team Delegation Playbook Design

Date: 2026-05-13
Status: Approved for Milestone 66

## Purpose

The Agent Team plugin now has live-validated providers and workflow mechanics. The next product gap is repeatable orchestration judgment: Codex should know which agent roles and provider families to use for planning, implementation, review, UI/UX, search, junior implementation, steering, and integration without relying on ad hoc chat memory.

This design adds a reusable delegation playbook: a provider-neutral, sanitized instruction layer that Codex can consult before dispatching agents. It should feel like Superpowers for a full development team, while preserving Codex as senior engineer, orchestrator, reviewer, integrator, and final authority.

## Core Invariants

- Codex remains the final technical authority and integration owner.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- Claude Opus is preferred for planning, high-complexity architecture, security-sensitive decisions, and final senior review.
- Claude Sonnet and Codex CLI are preferred for senior implementation.
- Claude Haiku is preferred for search, reconnaissance, lightweight scans, and summaries.
- Gemini CLI is a full autonomous worker when configured, with default preference for UI, UX, frontend, product-flow, and visual/browser-oriented work.
- Ollama Claude Code profiles such as Kimi K2.6, GLM 5.1, and DeepSeek V4 Flash are junior implementation workers by default: contained, bounded, isolated, and reviewed before integration.
- Users are asked only product, CEO, trust, cost, release, permission, or practical user-impact decisions.
- The playbook does not auto-start providers, auto-merge code, delete worktrees, or claim completion.
- Public outputs must not expose internal prompts, secrets, raw provider payloads, or provider command arguments.
- The playbook may recommend providers and roles, but it must not claim model quality rankings or provider superiority without live evidence.

## Playbook Scope

The playbook covers five orchestration moments:

1. **Planning council**
   Codex drafts the plan, then requests specialist dissent and sign-off. Recommended roles are `architect`, `planner`, `test-designer`, `security-reviewer`, `performance-reviewer`, `devops-release-engineer`, `docs-dx-writer`, `ui-ux-designer` when UI exists, and Claude Opus when available.

2. **Slice assignment**
   Codex decomposes the approved plan into a slice DAG. Independent ready slices may run in parallel with bounded concurrency. Write-capable agents must use isolated retained worktrees.

3. **Provider selection guidance**
   The playbook provides role/provider preferences as structured recommendations, not hardcoded routing. Configured policy, capability gating, provider health, and request overrides still decide final routing.

4. **Mid-flight steering**
   The playbook tells Codex whether to steer through live input, durable mailbox evidence for resume, or follow-up runs. It must never imply every provider supports live steering.

5. **Review and integration**
   Codex and Claude Opus review/sign off when available and required. Specialist reviewers provide dissent. Codex integrates one reviewed slice at a time and records verification evidence before cleanup.

## Provider Preference Matrix

| Work Type | Preferred Roles | Preferred Providers | Notes |
| --- | --- | --- | --- |
| Planning and architecture | `architect`, `planner` | `claude-code-cli:opus` | Required-when-available senior review remains default. |
| High-complexity review | `code-reviewer`, `security-reviewer`, `debugger` | `claude-code-cli:opus` | Use for source-of-truth, risk, and final sign-off. |
| Execution and implementation | `slice-implementer`, `backend-engineer`, `frontend-engineer` | `claude-code-cli:sonnet`, `codex-cli` | Must write only in retained isolated worktrees. |
| UI/UX and frontend polish | `ui-ux-designer`, `frontend-engineer`, `ux-product-critic` | `gemini-cli`, `claude-code-cli:sonnet`, `codex-cli` | Gemini is preferred for UI/UX surfaces when configured and healthy. |
| Search and reconnaissance | `planner`, `debugger`, `docs-dx-writer` | `claude-code-cli:haiku` | Lightweight, read-only, evidence-gathering work only. |
| Junior contained implementation | `slice-implementer` | `ollama-claude-code:kimi-k2.6`, `ollama-claude-code:glm-5.1`, `ollama-claude-code:deepseek-v4-flash` | Low/medium-risk, narrow write scopes, senior review required before integration. |
| Test hardening | `test-designer`, `test-hardening-engineer`, `qa-engineer` | `claude-code-cli:opus`, `claude-code-cli:sonnet`, `codex-cli` | Tests must be tied to acceptance criteria and real failure modes. |
| Integration | `integration-engineer`, `code-reviewer` | `claude-code-cli:opus`, `codex-cli` | Plugin recommends order; Codex performs integration. |

## Output Shape

The structured playbook should return:

- workflow phase or requested work type
- recommended roles
- provider preference list
- concurrency guidance
- steering mode guidance
- evidence requirements
- user escalation categories
- claim boundary
- sanitized rationale

The output should be suitable for MCP exposure later, but Milestone 66 can begin as core library guidance plus docs.

## Success Criteria

- The playbook returns deterministic recommendations for planning, implementation, UI/UX, search, review, junior implementation, steering, and integration.
- Recommendations preserve provider neutrality by using capability-aware preference lists, not hidden hard routes.
- Junior-provider recommendations require isolated worktrees, bounded scope, and senior review before integration.
- Gemini is explicitly treated as a full autonomous worker when configured, with a UI/UX/frontend default preference.
- Opus/Sonnet/Haiku preferences match the accepted strategy.
- Codex-only decisions and user-escalation decisions are separated.
- Outputs are sanitized and do not include prompts, secrets, raw provider payloads, or command arguments.
- Tests prove no model-quality ranking or provider-superiority claim is emitted.
- README and workflow docs explain how Codex should use the team.

## Non-Goals

- No new provider adapter.
- No automatic provider dispatch.
- No automatic merge or source mutation.
- No benchmark, model-ranking, or model-quality claims.
- No replacement of existing router, doctor, policy, lifecycle, mailbox, workflow, or cleanup systems.
