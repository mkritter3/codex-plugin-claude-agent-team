# Agent Team MCP Milestone 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `slice-implementer` real only behind explicit write policy, isolated retained worktrees, durable sidecars/mailboxes, and Claude Code CLI subscription OAuth.

**Architecture:** Add provider-neutral config and execution-workspace primitives before enabling write-capable roles. Provider capabilities become policy-aware: by default Claude Code CLI remains subscription-backed and read-oriented, and `edits`/`workspaceIsolation` are exposed only when `.agent-team/config.json` explicitly enables isolated implementation runs. Writable lifecycle runs allocate a retained git worktree, run the provider inside that execution cwd, keep orchestration state in the source workspace, and preserve changed files for Codex review.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing lifecycle/mailbox/run stores, Claude Code CLI background transport, git worktree CLI through injectable adapters.

---

## File Structure

- Create `src/core/config.ts`: load `.agent-team/config.json`, validate write policy, default fail-closed.
- Create `tests/core/config.test.ts`: prove config defaults and invalid config behavior.
- Create `src/core/workspaces.ts`: allocate retained isolated git worktrees through injected command runners; expose source/execution workspace metadata.
- Create `tests/core/workspaces.test.ts`: prove worktree path selection, git command calls, and fail-closed cleanup behavior.
- Modify `src/core/types.ts`: add write-policy config types, execution workspace sidecar fields, and optional `executionCwd` in start results.
- Modify `src/providers/index.ts`: make provider listing policy-aware instead of unconditionally advertising write capabilities.
- Modify `tests/core/router.test.ts`: prove `slice-implementer` is unroutable without explicit write policy and routable with policy-enabled capabilities.
- Modify `src/core/prompts.ts`: add an implementation prompt variant with isolated workspace rules and verdict protocol.
- Modify `tests/core/prompts.test.ts`: prove the implementation prompt names source/execution workspaces and forbids source checkout mutation.
- Modify `src/core/lifecycle.ts`: permit `slice-implementer` only through policy-enabled providers and isolated worktree leases; keep source workspace sidecars/mailboxes.
- Modify `tests/core/lifecycle.test.ts`: prove default rejection, isolated worktree child execution, sidecar fields, and provider cwd.
- Modify `src/providers/claude-code-cli/background.ts`: pass provider permission mode from lifecycle; preserve `--bare` denial and subscription env checks.
- Modify `tests/providers/claude-code-cli/background.test.ts`: prove write-mode uses `acceptEdits` only when lifecycle asks for isolated implementation execution.
- Modify `src/mcp/tools.ts`: expose policy-aware providers and lifecycle behavior without adding new tool names in this milestone.
- Modify `tests/mcp/tools.test.ts`: prove provider listing reflects policy and `agent_team_start` can return `executionCwd`.
- Modify `.codex-plugin/plugin.json`: add a write-capability prompt only after implementation runs are policy-gated.

## Success Criteria

- No write-capable provider capabilities are advertised by default.
- Missing `.agent-team/config.json` keeps implementation roles fail-closed.
- `writeMode.enabled: true` plus `writeMode.requireIsolatedWorktree: true` is required before `slice-implementer` can route.
- API-key fallback remains disabled unless explicitly configured; this milestone does not implement API-key fallback.
- `slice-implementer` allocates a git worktree outside the source checkout, records it as `executionCwd`, and runs Claude there.
- Main/source checkout is never used as the provider cwd for writable roles.
- Run sidecars remain under the source workspace `.agent-team/runs/`.
- Implementation sidecars record source workspace, execution workspace, isolation mode, retention policy, and cleanup status.
- Implementation worktrees are retained by default; no changed files are automatically deleted.
- Read-only roles continue to run in-place and keep their existing behavior.
- Claude background runs still block `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in subscription mode.
- Claude background runs still avoid `--bare`.
- Claude write-mode uses a permission mode only after isolated workspace allocation succeeds.
- `agent_team_list_providers` reports policy-aware capabilities.
- `npm run typecheck`, `npm test`, and `npm run build` pass before merge.

## Task 1: Config And Policy-Aware Provider Capabilities

**Files:**
- Create: `src/core/config.ts`
- Modify: `src/core/types.ts`
- Modify: `src/providers/index.ts`
- Test: `tests/core/config.test.ts`
- Test: `tests/core/router.test.ts`

- [x] **Step 1: Write failing config and routing tests**

Add tests proving:

- `loadAgentTeamConfig("/repo")` returns write mode disabled when `.agent-team/config.json` is missing.
- invalid config JSON fails closed with a clear config error.
- default `listProviders()` does not include `edits` or `workspaceIsolation`.
- policy-enabled provider listing includes `edits` and `workspaceIsolation`.
- `selectProvider({ roleId: "slice-implementer" })` fails with default provider capabilities and succeeds with policy-enabled capabilities.

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts
```

Expected: FAIL because config loading and policy-aware provider capabilities do not exist yet.

- [x] **Step 2: Implement config loader and provider capability policy**

Add:

```ts
export interface AgentTeamConfig {
  readonly writeMode: {
    readonly enabled: boolean;
    readonly requireIsolatedWorktree: boolean;
  };
  readonly auth: {
    readonly allowApiKeyFallback: boolean;
  };
}
```

Defaults:

```ts
{
  writeMode: { enabled: false, requireIsolatedWorktree: true },
  auth: { allowApiKeyFallback: false }
}
```

Change provider listing to accept optional config:

```ts
export function listProviders(input: { readonly config?: AgentTeamConfig } = {}): readonly AgentProviderDescriptor[];
```

Only include `edits` and `workspaceIsolation` when `config.writeMode.enabled === true && config.writeMode.requireIsolatedWorktree === true`.

- [x] **Step 3: Run tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/config.ts src/core/types.ts src/providers/index.ts tests/core/config.test.ts tests/core/router.test.ts
git commit -m "feat: add policy-aware provider capabilities"
```

## Task 2: Isolated Worktree Lease Primitive

**Files:**
- Create: `src/core/workspaces.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/workspaces.test.ts`

- [x] **Step 1: Write failing worktree tests**

Add tests proving:

- `allocateIsolatedWorktree` runs `git rev-parse --show-toplevel`, `git worktree add`, and returns a lease with `sourceCwd`, `executionCwd`, `branchName`, and retention policy.
- execution worktree paths are outside the source checkout, under a sibling `.agent-team-worktrees/<repo-name>/<run-id>` directory.
- allocation fails if git cannot resolve the source root.
- cleanup without `force` refuses to remove retained worktrees.

Run:

```bash
npm test -- tests/core/workspaces.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement worktree allocator**

Implement:

```ts
export interface WorkspaceLease {
  readonly sourceCwd: string;
  readonly executionCwd: string;
  readonly branchName: string;
  readonly baseRef: string;
  readonly isolation: "git-worktree";
  readonly retention: "retain-until-integrated";
  readonly cleanup: "retained";
}

export async function allocateIsolatedWorktree(input: {
  readonly sourceCwd: string;
  readonly runId: string;
  readonly execFile?: ExecFileLike;
}): Promise<WorkspaceLease>;
```

Use branch name `agent-team/<runId>` and base ref `HEAD`. Do not delete the worktree automatically.

- [x] **Step 3: Run tests**

Run:

```bash
npm test -- tests/core/workspaces.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/workspaces.ts src/core/types.ts tests/core/workspaces.test.ts
git commit -m "feat: add isolated worktree leases"
```

## Task 3: Implementation Prompt And Claude Permission Mode

**Files:**
- Modify: `src/core/prompts.ts`
- Modify: `src/providers/claude-code-cli/background.ts`
- Modify: `src/providers/claude-code-cli/types.ts`
- Test: `tests/core/prompts.test.ts`
- Test: `tests/providers/claude-code-cli/background.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- `buildImplementationPrompt` includes source workspace, execution workspace, task, role, and verdict protocol.
- the prompt says edits may occur only inside the isolated execution workspace.
- `startClaudeBackgroundSession({ permissionMode: "acceptEdits" })` passes `--permission-mode acceptEdits`.
- default background runs continue to pass `--permission-mode default`, `--exclude-dynamic-system-prompt-sections`, and no `--bare`.

Run:

```bash
npm test -- tests/core/prompts.test.ts tests/providers/claude-code-cli/background.test.ts
```

Expected: FAIL until prompt and provider input support are added.

- [x] **Step 2: Implement prompt and permission mode plumbing**

Add:

```ts
export interface BuildImplementationPromptInput {
  readonly role: AgentRole;
  readonly task: string;
  readonly sourceCwd: string;
  readonly executionCwd: string;
}
```

Extend background session input with:

```ts
readonly permissionMode?: ClaudePermissionMode;
```

Use `permissionMode ?? "default"` when building the Claude command.

- [x] **Step 3: Run tests**

Run:

```bash
npm test -- tests/core/prompts.test.ts tests/providers/claude-code-cli/background.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/prompts.ts src/providers/claude-code-cli/background.ts src/providers/claude-code-cli/types.ts tests/core/prompts.test.ts tests/providers/claude-code-cli/background.test.ts
git commit -m "feat: add isolated implementation prompt"
```

## Task 4: Lifecycle Slice Implementer Start Path

**Files:**
- Modify: `src/core/lifecycle.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing lifecycle tests**

Add tests proving:

- `startRun({ role: "slice-implementer" })` fails when write mode is disabled.
- with write mode enabled, lifecycle allocates a worktree before provider start.
- provider `cwd` is the isolated execution worktree, not the source workspace.
- sidecar is written under the source workspace and includes `sourceCwd`, `executionCwd`, `workspaceIsolation`, `workspaceRetention`, and `workspaceCleanup`.
- provider start failure preserves the retained worktree metadata and marks the run failed.
- read-only roles still do not allocate a worktree.

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL until lifecycle supports policy-enabled implementation starts.

- [x] **Step 2: Implement lifecycle integration**

Extend lifecycle dependencies with config and worktree allocator injection:

```ts
readonly config?: AgentTeamConfig;
readonly allocateWorkspace?: typeof allocateIsolatedWorktree;
```

Behavior:

- read-only roles keep existing flow
- non-read-only roles require `config.writeMode.enabled === true`
- non-read-only roles require provider capabilities including `edits` and `workspaceIsolation`
- allocate worktree before writing the running sidecar
- build implementation prompt with source and execution cwd
- call provider with `cwd: executionCwd`, `workspaceRoot: sourceCwd`, and `permissionMode: "acceptEdits"`
- keep mailboxes, logs, and sidecars rooted in the source workspace

- [x] **Step 3: Run tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts src/core/types.ts tests/core/lifecycle.test.ts
git commit -m "feat: enable isolated slice implementer runs"
```

## Task 5: MCP Surface And Plugin Prompt Update

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `.codex-plugin/plugin.json`
- Test: `tests/mcp/tools.test.ts`

- [x] **Step 1: Write failing MCP tests**

Add tests proving:

- `agent_team_list_providers` returns policy-aware provider capabilities.
- injected lifecycle `startRun` can return `executionCwd`.
- `agent_team_start` exposes `executionCwd` in structured content for implementation runs.
- plugin prompt suggestions include an implementation handoff only after the implementation path exists.

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL until MCP dependency wiring and plugin metadata are updated.

- [x] **Step 2: Implement MCP policy wiring**

Thread loaded config into provider listing. Preserve existing tool names; do not add cleanup or merge tools in this milestone.

- [x] **Step 3: Run tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/mcp/tools.ts .codex-plugin/plugin.json tests/mcp/tools.test.ts
git commit -m "feat: expose isolated implementation runs"
```

## Task 6: Verification And Integration

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/workspaces.test.ts tests/core/router.test.ts tests/core/prompts.test.ts tests/providers/claude-code-cli/background.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: PASS.

- [x] **Step 3: Review diff**

Run:

```bash
git status --short
git diff --stat main..HEAD
```

Expected: only planned files changed.

- [x] **Step 4: Merge and push**

Fast-forward merge the verified worktree branch into `main`, push, and remove the temporary implementation worktree.

## Completed Implementation Evidence

- Planned on `main` in commit `fc5cc79 docs: plan isolated slice implementer milestone`.
- Implemented in isolated worktree `.worktrees/milestone-5-isolated-slice` on branch `codex/milestone-5-isolated-slice`.
- Focused verification passed: `npm test -- tests/core/config.test.ts tests/core/workspaces.test.ts tests/core/router.test.ts tests/core/prompts.test.ts tests/providers/claude-code-cli/background.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts` (7 files, 49 tests).
- Full verification initially found one legacy synchronous-dispatch regression, fixed in `fcd6d79 fix: keep read-only dispatch fail-closed`.
- Full verification then passed: `npm run typecheck`, `npm test` (19 files, 88 tests), and `npm run build`.
