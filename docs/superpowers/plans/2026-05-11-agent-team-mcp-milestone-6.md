# Agent Team MCP Milestone 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make isolated implementation runs truthfully usable from MCP by loading workspace config for lifecycle tools and harvesting changed-file evidence from retained worktrees.

**Architecture:** Keep Milestone 5's permissioned `slice-implementer` model: Claude Code CLI subscription OAuth, explicit write policy, retained isolated git worktrees, and source-workspace sidecars. First fix the control-plane gap where provider listing can see `.agent-team/config.json` but `agent_team_start` still uses a default write-disabled lifecycle singleton. Then add a provider-neutral workspace inspection layer that reads git status/diff from the execution worktree and writes diff evidence under the source workspace `.agent-team/logs/`; lifecycle completion, failure, and cancellation paths use that layer without deleting worktrees or mutating the source checkout.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing lifecycle/mailbox/run stores, git CLI through injectable workspace inspector adapters.

---

## File Structure

- Modify `src/mcp/tools.ts`: construct config-aware lifecycle managers per workspace for default tool handling.
- Modify `tests/mcp/tools.test.ts`: prove default `agent_team_start` honors workspace write config and status exposes handoff fields.
- Modify `src/core/state/paths.ts`: add a stable diff evidence path helper.
- Modify `src/core/workspaces.ts`: add implementation-worktree inspection that returns changed files, status summary, and optional diff text.
- Modify `tests/core/workspaces.test.ts`: prove git status/diff command shape and parsing.
- Modify `src/core/types.ts`: add implementation handoff fields to `RunSidecar`.
- Modify `src/core/lifecycle.ts`: inject the workspace inspector and harvest worktree outputs on completed, failed/interrupted, and cancellation paths.
- Modify `tests/core/lifecycle.test.ts`: prove changed files/diff evidence are recorded for completed, failed, and cancelled implementation runs.
- Modify `.github/workflows/ci.yml`: add build to CI so the plugin `dist/index.js` target is checked.

## Success Criteria

- `agent_team_list_providers` and default `agent_team_start` use the same workspace config.
- A workspace with `.agent-team/config.json` write mode enabled can start `slice-implementer` through default MCP handlers.
- A workspace without write mode still rejects `slice-implementer` before provider start.
- Read-only roles keep existing behavior and do not invoke implementation-worktree inspection.
- Implementation run completion inspects `executionCwd` before writing the terminal sidecar.
- Terminal implementation sidecars include `changedFiles`, `workspaceStatus`, `workspaceDiffPath`, `workspaceCleanup`, and retained execution-worktree metadata.
- Diff evidence is written under the source workspace `.agent-team/logs/`, never inside the source checkout working tree.
- Failed/interrupted implementation runs harvest changed files and diff evidence before marking cleanup `partial`.
- Cancelled implementation runs preserve changed files and diff evidence before marking cleanup `partial`.
- Wind-down still records control intent; terminal harvesting happens when the provider settles.
- Worktrees remain retained by default; no run deletes changed files automatically.
- Empty implementation diffs are represented explicitly with empty `changedFiles` and no misleading success claim.
- The inspector uses structured git output, not heuristic model claims.
- Claude Code CLI subscription OAuth remains the only default v1 transport; no API-key fallback is introduced.
- CI runs typecheck, tests, and build.
- `npm run typecheck`, `npm test`, and `npm run build` pass before merge.

## Task 1: Config-Aware MCP Lifecycle

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing MCP config tests**

Add tests proving:

- default `agent_team_start` loads `.agent-team/config.json` from `cwd` and can start `slice-implementer` when write mode is enabled.
- default `agent_team_start` rejects `slice-implementer` when write mode is missing.
- injected lifecycle dependencies still bypass default lifecycle construction for unit tests.

Use a fake `startSession` dependency by adding a lifecycle factory dependency:

```ts
createToolHandlers({
  cwd: () => workspace,
  lifecycleFactory: (config) => new AgentLifecycleManager({
    config,
    createRunId: () => "run_slice_mcp",
    allocateWorkspace: async () => ({
      sourceCwd: workspace,
      executionCwd: `${workspace}-worktree`,
      branchName: "agent-team/run_slice_mcp",
      baseRef: "HEAD",
      isolation: "git-worktree",
      retention: "retain-until-integrated",
      cleanup: "retained"
    }),
    startSession: () => fakeHandle(done.promise)
  })
});
```

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: FAIL because default lifecycle handling is not config-aware and no lifecycle factory exists.

- [ ] **Step 2: Implement config-aware lifecycle factory**

Extend `ToolDependencies` with:

```ts
readonly lifecycleFactory?: (config: AgentTeamConfig) => AgentLifecycleManager;
```

Behavior:

- If `deps.lifecycle` is supplied, keep using it for all lifecycle tools.
- Otherwise load config with `loadAgentTeamConfig(workspaceRoot)` for tools that operate on a workspace.
- Construct a fresh `AgentLifecycleManager({ config })` or call `deps.lifecycleFactory(config)`.
- Use that manager for `agent_team_start`, `agent_team_reply`, `agent_team_message`, `agent_team_status`, `agent_team_cancel`, and `agent_team_wind_down`.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "fix: make MCP lifecycle config-aware"
```

## Task 2: Workspace Diff Inspector

**Files:**
- Modify: `src/core/state/paths.ts`
- Modify: `src/core/workspaces.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/workspaces.test.ts`

- [ ] **Step 1: Write failing workspace inspector tests**

Add tests proving:

- `workspaceDiffPath("/repo", "run_1")` returns `/repo/.agent-team/logs/run_1.diff.patch`.
- `inspectImplementationWorkspace` calls `git -C <executionCwd> status --porcelain=v1` and `git -C <executionCwd> diff --binary`.
- changed files are parsed from porcelain output for modified, added, deleted, renamed, and untracked files.
- an empty worktree returns `changedFiles: []`, `statusSummary: []`, and no diff text.
- git errors throw `WorkspaceLeaseError` with a clear message.

Run:

```bash
npm test -- tests/core/workspaces.test.ts
```

Expected: FAIL because the inspector and diff path helper do not exist.

- [ ] **Step 2: Implement inspector and types**

Add:

```ts
export interface ImplementationWorkspaceInspection {
  readonly changedFiles: readonly string[];
  readonly statusSummary: readonly string[];
  readonly diffText?: string;
}

export async function inspectImplementationWorkspace(input: {
  readonly executionCwd: string;
  readonly execFile?: ExecFileLike;
}): Promise<ImplementationWorkspaceInspection>;
```

Parsing rules:

- For porcelain lines, use the path segment after the two status columns.
- For rename lines containing `old -> new`, record the new path.
- Keep ordering stable and remove duplicates.
- Only include `diffText` when `git diff --binary` returns non-empty output.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test -- tests/core/workspaces.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/state/paths.ts src/core/workspaces.ts src/core/types.ts tests/core/workspaces.test.ts
git commit -m "feat: inspect implementation worktree diffs"
```

## Task 3: Completion Harvesting For Implementation Runs

**Files:**
- Modify: `src/core/lifecycle.ts`
- Modify: `src/core/types.ts`
- Test: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle completion tests**

Add tests proving:

- completed `slice-implementer` runs call the injected workspace inspector with `executionCwd`.
- the terminal sidecar records `changedFiles`, `workspaceStatus`, `workspaceDiffPath`, and `workspaceCleanup: "retained"`.
- diff text is written to `workspaceDiffPath` and that path appears in `evidencePaths`.
- completed read-only runs do not call the workspace inspector.
- completed implementation runs with no diff record `changedFiles: []` and no `workspaceDiffPath`.

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because lifecycle completion does not harvest implementation worktrees.

- [ ] **Step 2: Implement completion harvesting**

Extend lifecycle dependencies:

```ts
readonly inspectWorkspace?: typeof inspectImplementationWorkspace;
```

Implement a private helper:

```ts
private async implementationEvidence(
  workspaceRoot: string,
  runId: string,
  sidecar: RunSidecar
): Promise<{
  readonly sidecar: Partial<RunSidecar>;
  readonly evidencePaths: readonly string[];
}>;
```

Behavior:

- Return empty sidecar/evidence additions for sidecars without `executionCwd`.
- Inspect the execution workspace.
- Write non-empty diff text to `workspaceDiffPath(workspaceRoot, runId)`.
- Return `changedFiles`, `workspaceStatus`, optional `workspaceDiffPath`, `workspaceCleanup: "retained"`, and evidence path additions.
- On inspector failure, preserve a warning and do not throw away the provider verdict.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts src/core/types.ts tests/core/lifecycle.test.ts
git commit -m "feat: harvest implementation completion evidence"
```

## Task 4: Failure And Cancellation Harvesting

**Files:**
- Modify: `src/core/lifecycle.ts`
- Test: `tests/core/lifecycle.test.ts`

- [ ] **Step 1: Write failing failure/cancellation tests**

Add tests proving:

- failed/interrupted implementation runs harvest changed files and diff evidence before terminal sidecar write.
- cancelled implementation runs harvest changed files and diff evidence before terminal sidecar write.
- inspector failure during cancellation does not block cancellation; sidecar gets a warning and `cleanup: "partial"`.
- read-only cancellation does not invoke the inspector.

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL until failed/cancelled paths use the shared harvesting helper.

- [ ] **Step 2: Implement failure and cancellation harvesting**

Use the same helper from Task 3 in:

- provider completion status other than `"completed"`
- `cancelRun` transition to `"cancelled"`

Ensure `cleanup` remains `"partial"` for failed/interrupted/cancelled runs while `workspaceCleanup` remains `"retained"`.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: preserve implementation evidence on stop"
```

## Task 5: Status And CI Regression Coverage

**Files:**
- Modify: `tests/mcp/tools.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `src/mcp/tools.ts` only if the red test proves status fields are stripped.

- [ ] **Step 1: Write MCP status and CI regression tests**

Add a test proving `agent_team_status` returns implementation handoff fields already present in a persisted sidecar:

```ts
await writeRunSidecar(workspace, {
  runId: "run_impl_status",
  role: "slice-implementer",
  provider: "claude-code-cli",
  status: "completed",
  createdAt: "2026-05-11T00:00:00.000Z",
  updatedAt: "2026-05-11T00:00:01.000Z",
  capabilitiesUsed: ["structuredOutput", "tools", "edits", "sessionResume", "cancellation", "workspaceIsolation"],
  evidencePaths: ["/repo/.agent-team/logs/run_impl_status.diff.patch"],
  executionCwd: "/tmp/.agent-team-worktrees/repo/run_impl_status",
  changedFiles: ["src/core/config.ts"],
  workspaceStatus: ["M src/core/config.ts"],
  workspaceDiffPath: "/repo/.agent-team/logs/run_impl_status.diff.patch",
  workspaceCleanup: "retained"
});
```

Add a lightweight CI workflow test or direct YAML assertion proving `.github/workflows/ci.yml` includes `npm run build`.

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS for MCP if status already returns the sidecar whole; CI assertion fails until build is added.

- [ ] **Step 2: Implement CI build and preserve MCP status fields**

Add:

```yaml
- run: npm run build
```

after `npm test` in `.github/workflows/ci.yml`.

If MCP status strips fields, preserve the full sidecar in structured content. Do not add a new tool in this milestone.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "test: cover implementation handoff status"
```

## Task 6: Verification And Integration

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/core/workspaces.test.ts tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
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

- [ ] **Step 3: Review diff**

Run:

```bash
git status --short
git diff --stat main..HEAD
```

Expected: only planned files changed.

- [ ] **Step 4: Merge and push**

Fast-forward merge the verified worktree branch into `main`, push, and remove the temporary implementation worktree.
