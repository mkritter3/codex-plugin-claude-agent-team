# Agent Team MCP Milestone 16 Explicit Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make retained implementation worktree cleanup a first-class, explicit, durable MCP operation.

**Architecture:** Keep cleanup orchestration in provider-neutral lifecycle code and keep the existing low-level git worktree remover in `src/core/workspaces.ts`. Cleanup must never happen implicitly during completion, cancellation, failure, or status reads. The MCP tool records cleanup intent in `control.jsonl`, requires a terminal implementation run with retained worktree metadata, requires explicit force confirmation, removes only the execution worktree, updates the sidecar to `workspaceCleanup: "removed"`, and appends an event record. Read-only runs, detached active-looking runs, missing metadata, already removed worktrees, and unforced cleanup attempts fail closed with durable evidence where possible.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP tool metadata, lifecycle manager, provider-neutral workspace cleanup helpers, atomic sidecar updates, JSONL mailboxes.

---

## File Structure

- Modify `src/core/types.ts`: add cleanup request/result types.
- Modify `src/core/lifecycle.ts`: add `cleanupRunWorkspace` with force gating, terminal-run validation, durable control/event records, and sidecar updates.
- Modify `src/mcp/tools.ts`: add `agent_team_cleanup` parsing and handler wiring.
- Modify `src/mcp/schemas.ts`: add cleanup input schema metadata.
- Modify `tests/core/lifecycle.test.ts`: cover successful cleanup and fail-closed cleanup cases.
- Modify `tests/mcp/tools.test.ts`: cover tool validation and lifecycle delegation.
- Modify `tests/mcp/server.test.ts`: cover advertised cleanup tool metadata.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `agent_team_cleanup` is listed, advertised, validated, and handled through the MCP surface.
- Cleanup requires `force: true`; unforced requests do not remove worktrees.
- Cleanup requires a terminal implementation run with `sourceCwd`, `executionCwd`, and `workspaceIsolation: "git-worktree"`.
- Cleanup refuses non-terminal runs, read-only runs without worktree metadata, and runs already marked `workspaceCleanup: "removed"`.
- Successful cleanup calls the shared `cleanupIsolatedWorktree` helper, updates the sidecar to `workspaceCleanup: "removed"`, and preserves logs, mailboxes, sidecars, diffs, verdicts, and other evidence.
- Cleanup intent is appended to `control.jsonl`; successful cleanup is appended to `events.jsonl`.
- Failures from the git worktree remover do not mark cleanup removed; they append a warning and return a failed cleanup result.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific cleanup logic, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Lifecycle Cleanup Contract

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle cleanup tests**

Add tests proving:

- successful cleanup of a completed implementation run requires `force: true`
- cleanup appends `cleanup_requested` to `control.jsonl`
- successful cleanup appends `workspace_cleanup_removed` to `events.jsonl`
- successful cleanup updates only cleanup sidecar fields and preserves verdict/evidence metadata
- unforced cleanup returns a blocked result and does not call the remover
- non-terminal implementation runs are refused
- read-only runs without worktree metadata are refused
- already removed worktrees are refused idempotently
- remover failures append a warning and keep `workspaceCleanup: "retained"`

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because the lifecycle cleanup method and cleanup result types do not exist.

- [ ] **Step 2: Implement provider-neutral lifecycle cleanup**

Add `AgentCleanupRequest` and `AgentCleanupResult` types. Add an injectable `cleanupWorkspace` dependency defaulting to `cleanupIsolatedWorktree`.

Implement `cleanupRunWorkspace(request)` to:

- read the sidecar
- append a `cleanup_requested` control record
- require `force: true`
- require terminal status
- require git-worktree metadata
- refuse already removed worktrees
- call the shared cleanup helper with a `WorkspaceLease`
- transition the sidecar to `workspaceCleanup: "removed"`
- append a `workspace_cleanup_removed` event
- on remover failure, append a warning to the sidecar and return a failed result without claiming removal

- [ ] **Step 3: Run focused lifecycle tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/types.ts src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: add lifecycle workspace cleanup"
```

## Task 2: MCP Cleanup Tool Surface

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write failing MCP cleanup tests**

Add tests proving:

- `agent_team_cleanup` is present in `listToolNames`
- server metadata advertises `runId`, optional `cwd`, and required `force`
- invalid `runId`, invalid `cwd`, and missing/non-boolean `force` return validation errors
- valid cleanup calls `lifecycle.cleanupRunWorkspace`
- cleanup uses the configured lifecycle registry/factory for the workspace root

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: FAIL because the tool is not registered or handled.

- [ ] **Step 2: Implement MCP cleanup schema and handler**

Add `agent_team_cleanup` to:

- `TOOL_NAMES`
- `LifecycleLike`
- tool argument parser
- `handleToolCall`
- `TOOL_METADATA_BY_NAME`

Keep the handler thin: parse arguments, resolve cwd, get the lifecycle, delegate to `cleanupRunWorkspace`, and return the lifecycle result as JSON.

- [ ] **Step 3: Run focused MCP tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts src/mcp/schemas.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts
git commit -m "feat: expose workspace cleanup tool"
```

## Task 3: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

Expected: PASS.

- [ ] **Step 3: Review provider-neutral boundaries**

Run:

```bash
rg "agent_team_cleanup|cleanupRunWorkspace|cleanupIsolatedWorktree|workspace_cleanup_removed" src tests
rg "CLAUDE|claude|Claude" src/core/lifecycle.ts src/core/workspaces.ts src/mcp/tools.ts src/mcp/schemas.ts
```

Expected: cleanup orchestration remains provider-neutral; Claude-specific code is not touched.

- [ ] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-16.md
git commit -m "docs: mark cleanup milestone complete"
```
