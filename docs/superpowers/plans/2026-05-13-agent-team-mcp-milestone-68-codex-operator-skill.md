# Agent Team MCP Milestone 68: Codex Operator Skill

## Goal

Make direct Codex orchestration the explicit product path for the Agent Team plugin. The plugin should teach a loaded Codex session how to plan, delegate, steer, review, integrate, and clean up agent-team work through public MCP tools, while keeping dogfood and live-smoke scripts as regression evidence only.

## Context

Milestone 67 proved the live dogfood workflow can run provider-backed agents in isolated worktrees and record cleanup evidence. That proof is valuable, but it must not become the user-facing orchestration path. The product goal is for Codex to operate the agent team from the conversation through MCP tools.

Current gap:

- `.codex-plugin/plugin.json` exposes MCP but does not ship a plugin skill.
- Default plugin prompts still frame Claude as the primary visible actor.
- Packaging does not include a `skills/` surface.
- Docs mention the workflow loop, but do not clearly separate direct orchestration from harness-based regression proof.

## Success Criteria

- The plugin manifest exposes a `skills` directory.
- The package includes the skill files in `npm pack`.
- A Codex operator skill documents the direct MCP orchestration loop:
  - `agent_team_doctor`
  - `agent_team_create_workflow`
  - `agent_team_plan_consensus`
  - `agent_team_start_slices`
  - `agent_team_status_many`
  - `agent_team_message_many`
  - `agent_team_unblock_slice`
  - `agent_team_review_slice`
  - `agent_team_integration_queue`
  - `agent_team_record_integration`
  - `agent_team_workflow_report`
  - `agent_team_cleanup`
- The skill states that Codex remains the senior engineer, orchestrator, reviewer, integrator, and final authority.
- The skill states that harness scripts are regression/live-proof tools only, not the orchestration path.
- Public plugin text stays provider-neutral and does not expose internal prompts, secrets, raw provider payloads, or provider-specific implementation details.
- Tests fail before implementation and pass after implementation.

## Non-Goals

- No new runtime harness for orchestration.
- No provider ranking, model-quality claim, or benchmark claim.
- No API-key fallback behavior change.
- No automatic merge or cleanup of retained implementation worktrees.

## Implementation Plan

1. Add tests for the plugin operator surface.
   - Assert `.codex-plugin/plugin.json` declares `"skills": "./skills/"`.
   - Assert `package.json` files include `skills`.
   - Assert `scripts/smoke-package.mjs` requires the operator skill in packed artifacts.
   - Assert the operator skill includes the public workflow tools, Codex authority, product-level escalation, steering, integration, cleanup, and harness boundary.
2. Add the Codex operator skill.
   - Create `skills/codex-agent-team-orchestrator/SKILL.md`.
   - Keep the skill concise, operational, and MCP-first.
   - Make provider routing guidance capability-oriented and neutral.
3. Update package and plugin metadata.
   - Add plugin `skills` pointer.
   - Add `skills` to package files.
   - Update default prompts away from "ask Claude" and toward Codex-led agent-team workflows.
4. Update docs.
   - Add a README section that clarifies direct Codex orchestration versus regression harnesses.
   - Add the same boundary to the runbook so future validation does not drift back into harness-as-product thinking.
5. Verify and integrate.
   - Focused tests for package/plugin/runbook surface.
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `npm run smoke:mcp-stdio`
   - `npm run smoke:package`
   - `npm run ci`

## Rollback

Revert this milestone if the plugin client cannot load a packaged skill directory from the declared `skills` field. MCP runtime behavior remains unaffected because this slice changes packaging, docs, and Codex-facing operating instructions only.
