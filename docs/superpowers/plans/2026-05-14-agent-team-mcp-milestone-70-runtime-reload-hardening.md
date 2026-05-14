# Agent Team MCP Milestone 70 Runtime Reload Hardening Plan

**Goal:** Make stale MCP runtime/cache drift visible and recoverable after rebuilds, so Codex can tell whether it is operating the current Agent Team schema before relying on direct orchestration.

**Architecture:** Keep the public MCP product path unchanged. Add runtime self-evidence to `agent_team_doctor`, extend install/runbook/operator guidance, and keep schema compatibility checks provider-neutral. Do not add a new orchestration harness or provider-specific bypass.

**Tech Stack:** TypeScript, Node.js ESM, Zod MCP metadata, Vitest, existing doctor/install preflight/runbook/operator skill surfaces.

## Success Criteria

- `agent_team_doctor` reports `mcp-runtime` evidence with current process metadata and direct workflow schema compatibility.
- The direct create-workflow public schema accepts read-only slices with `writeScope: []`.
- Install preflight warns, with sanitized evidence, when Agent Team MCP server processes are already running and may keep stale schemas alive.
- The runbook and Codex operator skill tell operators to rebuild, reload plugins, rerun doctor, and handle `Transport closed` or stale validation by restarting stale MCP processes.
- No public schema or docs expose secrets, internal prompts, raw provider payloads, or provider-specific implementation details.

## TDD Plan

1. Add MCP schema test proving `agent_team_create_workflow` accepts `writeScope: []` for read-only slices.
2. Add doctor test requiring `mcp-runtime.workflowWriteScopeAllowsEmpty === true`.
3. Add install preflight test for sanitized running-process evidence.
4. Add docs/skill tests requiring the reload troubleshooting terms.
5. Implement the smallest shared checks and docs changes to pass.

## Verification

- `npm test -- tests/doctor.test.ts tests/mcp/tools.test.ts tests/install-check.test.ts tests/docs/runbook.test.ts tests/plugin-operator-skill.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run install:check`
- `npm run smoke:mcp-stdio`
- `npm run smoke:package`
- invariant scans
- `npm run ci`

## Evidence Notes

- Live MCP proof after killing stale server processes requires Codex plugin reload/restart before more MCP tool calls are possible.
- If the live tool transport reports `Transport closed`, restart or `/reload-plugins`, then rerun `agent_team_doctor` and confirm `mcp-runtime` before direct workflow operations.
