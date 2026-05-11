# Agent Team MCP Milestone 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn isolated implementation worktrees into reviewable Codex handoffs by harvesting changed files, diff evidence, and cleanup state into durable sidecars/events.

**Architecture:** Keep Milestone 5's permissioned `slice-implementer` execution model: Claude Code CLI subscription OAuth, explicit write policy, retained isolated git worktrees, and source-workspace sidecars. Add a provider-neutral workspace inspection layer that reads git status/diff from the execution worktree and writes diff evidence under the source workspace `.agent-team/logs/`. Lifecycle completion, failure, wind-down, and cancellation paths use that layer to preserve implementation outputs without deleting worktrees or mutating the source checkout.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing lifecycle/mailbox/run stores, git CLI through injectable workspace inspector adapters.

---

## File Structure

- Modify `src/core/state/paths.ts`: add a stable diff evidence path helper.
- Modify `src/core/workspaces.ts`: add implementation-worktree inspection that returns changed files, status summary, and optional diff text.
- Modify `tests/core/workspaces.test.ts`: prove git status/diff command shape and parsing.
- Modify `src/core/types.ts`: add implementation handoff fields to `RunSidecar`.
- Modify `src/core/lifecycle.ts`: inject the workspace inspector and harvest worktree outputs on completed, failed/interrupted, wind-down terminalization, and cancellation paths.
- Modify `tests/core/lifecycle.test.ts`: prove changed files/diff evidence are recorded for completed, failed, and cancelled implementation runs.
- Modify `src/mcp/tools.ts` only if structured content needs explicit exposure beyond the sidecar.
- Modify `tests/mcp/tools.test.ts` only if MCP status output needs regression coverage.

## Success Criteria

- Read-only roles keep existing behavior and do not invoke implementation-worktree inspection.
- Implementation run completion inspects `executionCwd` before writing the terminal sidecar.
- Terminal implementation sidecars include `changedFiles`, `workspaceStatus`, `workspaceDiffPath`, `workspaceCleanup`, and retained execution-worktree metadata.
- Diff evidence is written under the source workspace `.agent-team/logs/`, never inside the source checkout working tree.
- Failed/interrupted implementation runs still harvest changed files and diff evidence before marking cleanup `partial`.
- Cancelled implementation runs preserve changed files and diff evidence before marking cleanup `partial`.
- Wind-down still records control intent; terminal harvesting happens when the provider settles.
- Worktrees remain retained by default; no run deletes changed files automatically.
- Empty implementation diffs are represented explicitly with empty `changedFiles` and no misleading success claim.
- The inspector uses structured git output, not heuristic model claims.
- Claude Code CLI subscription OAuth remains the only default v1 transport; no API-key fallback is introduced.
- `npm run typecheck`, `npm test`, and `npm run build` pass before merge.

## Task 1: Workspace Diff Inspector

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

## Task 2: Completion Harvesting For Implementation Runs

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
): Promise<Partial<RunSidecar>>;
```

Behavior:

- Return `{}` for sidecars without `executionCwd`.
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

## Task 3: Failure And Cancellation Harvesting

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

Use the same helper from Task 2 in:

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

## Task 4: Status And MCP Regression Coverage

**Files:**
- Modify: `tests/mcp/tools.test.ts`
- Modify: `src/mcp/tools.ts` only if the red test proves status fields are stripped.

- [ ] **Step 1: Write MCP status regression test**

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

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS if MCP already returns the sidecar whole; otherwise FAIL and wire through the missing structured fields.

- [ ] **Step 2: Implement only if the test fails**

If MCP status strips fields, preserve the full sidecar in structured content. Do not add a new tool in this milestone.

- [ ] **Step 3: Run tests**

Run:

```bash
npm test -- tests/mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "test: cover implementation handoff status"
```

## Task 5: Verification And Integration

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
