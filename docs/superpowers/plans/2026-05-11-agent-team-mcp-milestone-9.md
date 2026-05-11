# Agent Team MCP Milestone 9 Lifecycle Registry Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep live agent controls attached across MCP tool calls in the production server path, so Milestone 8 message, cancel, wind-down, and status behavior works outside unit-test injection.

**Architecture:** Introduce a process-local lifecycle registry keyed by canonical workspace root and the loaded workspace config identity. MCP tool handlers will resolve lifecycle managers through this registry instead of constructing a fresh `AgentLifecycleManager` for every call. The registry preserves active provider handles for live controls while still loading workspace-specific config before manager creation, preventing write-mode capability drift.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing MCP tool handler, lifecycle manager, config loader, run-store status reconciliation, Claude Code CLI background handle.

---

## File Structure

- Create `src/core/lifecycle-registry.ts`: lifecycle registry keyed by workspace root plus normalized config identity, with injectable manager factory for tests.
- Modify `src/mcp/tools.ts`: use the registry for default lifecycle resolution while preserving explicit lifecycle/lifecycleFactory test hooks.
- Modify `src/mcp/server.ts`: create one registry-backed handler set per MCP server process instead of calling the stateless `handleToolCall` helper for each tool invocation.
- Modify `tests/mcp/tools.test.ts`: cover registry reuse across start/status/message/cancel/wind-down, workspace config separation, and factory reuse boundaries.
- Add or modify `tests/mcp/server.test.ts`: cover the server wiring uses one handler instance across registered tool callbacks.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `agent_team_start` followed by `agent_team_message` through default MCP tool handlers can return `delivered_live` without injecting a lifecycle object per call.
- `agent_team_status` through default MCP tool handlers sees active handle snapshots for in-flight runs and only marks `detached` after the process lacks a live handle.
- `agent_team_cancel` and `agent_team_wind_down` through default MCP tool handlers call the active handle from the original start.
- Workspace config is still loaded before creating a lifecycle manager, and different workspace/config identities do not share a manager.
- A repeated tool call for the same workspace/config identity reuses the existing manager and avoids losing active run handles.
- Existing explicit `lifecycle` and `lifecycleFactory` test/dependency hooks continue to work.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, model-quality heuristic, benchmark mock, new provider, or automatic worktree deletion is introduced.
- `npm run typecheck`, `npm test`, and `npm run build` pass in the implementation worktree before merge.

## Task 1: Lifecycle Registry

**Files:**
- Create: `src/core/lifecycle-registry.ts`
- Test: `tests/core/lifecycle-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

Add tests proving:

- The same workspace root and same config identity returns the same lifecycle manager instance.
- Different workspace roots return different lifecycle manager instances.
- Changing `writeMode.enabled`, `writeMode.requireIsolatedWorktree`, or `auth.allowApiKeyFallback` returns a different lifecycle manager instance.

Run:

```bash
npm test -- tests/core/lifecycle-registry.test.ts
```

Expected: FAIL because no lifecycle registry module exists.

- [ ] **Step 2: Implement the registry**

Create `LifecycleRegistry` with:

- constructor dependency `createLifecycle?: (config: AgentTeamConfig) => LifecycleLike`
- `get(workspaceRoot: string, config: AgentTeamConfig): LifecycleLike`
- key format based on `resolve(workspaceRoot)` plus sorted JSON of the config fields

Keep the file focused on registry ownership only. It should not load config, touch MCP, or inspect provider state.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/lifecycle-registry.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/lifecycle-registry.ts tests/core/lifecycle-registry.test.ts
git commit -m "feat: add lifecycle registry"
```

## Task 2: Registry-Backed Tool Handlers

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing tool continuity tests**

Add tests proving:

- default `createToolHandlers` reuses one lifecycle manager for repeated calls in the same workspace/config identity.
- `agent_team_start` followed by `agent_team_message` reaches the same lifecycle instance and can report `delivered_live`.
- changing loaded workspace config creates a new lifecycle instance rather than mutating an existing manager.
- explicit injected `lifecycle` still bypasses the registry.

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL because default lifecycle resolution creates a fresh manager per call.

- [ ] **Step 2: Implement registry-backed resolution**

Update `createToolHandlers` dependencies to accept:

- `lifecycleRegistry?: LifecycleRegistry`
- existing `lifecycleFactory?: (config: AgentTeamConfig) => LifecycleLike`

In `lifecycleFor(workspaceRoot)`:

- return explicit `deps.lifecycle` when present
- load config for the workspace
- return `deps.lifecycleRegistry?.get(workspaceRoot, config)` when present
- otherwise use a module/process-local default registry that creates `AgentLifecycleManager`

Preserve existing validation, dispatch, doctor, list roles, and list providers behavior.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/lifecycle-registry.test.ts tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: reuse lifecycle managers across mcp tool calls"
```

## Task 3: Server Uses One Handler Set

**Files:**
- Modify: `src/mcp/server.ts`
- Test: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write failing server wiring test**

Add a test with a fake server registration surface proving all registered tool callbacks close over one `createToolHandlers()` result rather than calling stateless `handleToolCall()` on every invocation.

Run:

```bash
npm test -- tests/mcp/server.test.ts
```

Expected: FAIL because server currently imports and calls the stateless helper in each registered callback.

- [ ] **Step 2: Implement single handler set wiring**

Update `createAgentTeamServer` to:

- call `createToolHandlers()` once
- register each tool callback against that handler set
- keep tool names, titles, and descriptions unchanged

Keep `handleToolCall` exported for lightweight tests and direct local use, backed by the same module-local registry semantics from Task 2.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/mcp/server.test.ts tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.test.ts
git commit -m "fix: keep mcp server lifecycle handlers live"
```

## Task 4: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/lifecycle-registry.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Review registry scope**

Run:

```bash
rg "new AgentLifecycleManager" src/mcp src/core/lifecycle-registry.ts
```

Expected: only registry-owned creation remains in the MCP default path.

- [ ] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-9.md
git commit -m "docs: mark lifecycle registry milestone complete"
```
