# Agent Team MCP Milestone 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agent_team_doctor` a truthful workspace preflight for subscription-backed Claude Code CLI runs, explicit write-mode readiness, provider routing, and build-gated local CI.

**Architecture:** Keep doctor as a provider-neutral orchestration check with Claude Code CLI as the first provider-specific adapter. The top-level doctor loads the same workspace config as MCP lifecycle tools, fails closed on auth ambiguity unless API-key fallback is explicitly configured, validates `.agent-team` writability, checks git worktree support only when write mode requires it, and proves configured providers can satisfy the role registry. MCP remains a thin validation layer that passes the requested workspace into the shared doctor pipeline.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing config/router/workspace/provider modules, injectable filesystem and git adapters for deterministic tests.

---

## File Structure

- Modify `src/doctor.ts`: expand doctor input, load workspace config, aggregate config/auth/state/git/routing checks, and preserve exact fix guidance in check details.
- Modify `src/core/workspaces.ts`: add a reusable git/worktree readiness inspector.
- Modify `src/core/types.ts`: add small doctor readiness types only if needed by shared helpers.
- Modify `src/mcp/tools.ts`: validate optional doctor `cwd` and call `runDoctor({ workspaceRoot })`.
- Modify `package.json`: make `npm run ci` include build so local and GitHub gates match.
- Modify `tests/doctor.test.ts`: cover config loading, auth fail-closed policy, writable state checks, git readiness, and routing readiness.
- Modify `tests/core/workspaces.test.ts`: cover git/worktree inspector command shape and failures.
- Modify `tests/mcp/tools.test.ts`: cover doctor `cwd` plumbing and validation.
- Create `tests/package-scripts.test.ts`: assert `npm run ci` includes typecheck, tests, and build.

## Success Criteria

- `agent_team_doctor` accepts an optional `cwd` and checks that workspace, defaulting to process cwd.
- Doctor loads `.agent-team/config.json` with the same parser as lifecycle and provider listing.
- Invalid config JSON or unsafe write config is a `fail` check and makes `report.ok === false`.
- `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is a `fail` for subscription OAuth when `auth.allowApiKeyFallback` is false.
- The same auth variables are only a `warn` when `auth.allowApiKeyFallback` is explicitly true.
- Doctor checks `.agent-team` can be created and written in the target workspace.
- Write-enabled workspaces check `git --version`, source root resolution, and `git worktree list --porcelain`.
- Read-only workspaces do not fail just because worktree support is unneeded.
- Doctor reports whether configured providers satisfy every role; unavailable `slice-implementer` under default write-disabled config is a warning, not a failure.
- Write-enabled workspaces fail doctor if `slice-implementer` cannot route to a provider with edit and workspace isolation capabilities.
- MCP doctor uses shared JSON result shape and does not leak provider prompts.
- `npm run ci` includes `npm run build`.
- No API-key fallback, provider-specific bypass, benchmark mock, or heuristic model-quality behavior is introduced.
- `npm run typecheck`, `npm test`, and `npm run build` pass before merge.

## Task 1: Config And Auth-Aware Doctor

**Files:**
- Modify: `src/doctor.ts`
- Test: `tests/doctor.test.ts`

- [ ] **Step 1: Write failing doctor config/auth tests**

Add tests proving:

- invalid workspace config produces a `config` fail check and `ok: false`.
- default missing config is accepted and reports write mode disabled.
- API override variables fail in subscription mode when `allowApiKeyFallback` is false.
- API override variables warn, but do not fail, when `allowApiKeyFallback` is true.

Run:

```bash
npm test -- tests/doctor.test.ts
```

Expected: FAIL because `runDoctor` does not load workspace config or enforce auth policy.

- [ ] **Step 2: Implement config/auth aggregation**

Extend `DoctorInput`:

```ts
readonly workspaceRoot?: string;
readonly loadConfig?: typeof loadAgentTeamConfig;
```

Behavior:

- Resolve `workspaceRoot ?? process.cwd()`.
- Load config with `loadAgentTeamConfig`.
- Add a `config` pass check with `writeMode` and `allowApiKeyFallback` details.
- If config loading throws, add a `config` fail check and continue with defaults for remaining non-mutating checks.
- Convert Claude environment warnings into:
  - `fail` when `config.auth.allowApiKeyFallback` is false.
  - `warn` when `config.auth.allowApiKeyFallback` is true.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/doctor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/doctor.ts tests/doctor.test.ts
git commit -m "feat: make doctor config and auth aware"
```

## Task 2: Workspace State And Git Worktree Readiness

**Files:**
- Modify: `src/core/workspaces.ts`
- Modify: `src/doctor.ts`
- Test: `tests/core/workspaces.test.ts`
- Test: `tests/doctor.test.ts`

- [ ] **Step 1: Write failing workspace readiness tests**

Add tests proving:

- `inspectGitWorktreeSupport({ workspaceRoot, execFile })` calls `git --version`, `git -C <workspaceRoot> rev-parse --show-toplevel`, and `git -C <root> worktree list --porcelain`.
- git failures return a structured failed inspection instead of throwing raw errors.
- doctor fails when the state directory cannot be written.
- doctor checks git/worktree support for write-enabled config.
- doctor does not require worktree support for default read-only config.

Run:

```bash
npm test -- tests/core/workspaces.test.ts tests/doctor.test.ts
```

Expected: FAIL because no reusable readiness inspector or writable-state check exists.

- [ ] **Step 2: Implement workspace readiness**

Add to `src/core/workspaces.ts`:

```ts
export interface GitWorktreeSupportInspection {
  readonly ok: boolean;
  readonly gitVersion?: string;
  readonly sourceRoot?: string;
  readonly worktreeList?: string;
  readonly message?: string;
}
```

Implement:

```ts
export async function inspectGitWorktreeSupport(input: {
  readonly workspaceRoot: string;
  readonly execFile?: ExecFileLike;
}): Promise<GitWorktreeSupportInspection>;
```

In `src/doctor.ts`, add injectable:

```ts
readonly ensureWritableState?: (workspaceRoot: string) => Promise<void>;
readonly inspectGitWorktreeSupport?: typeof inspectGitWorktreeSupport;
```

Default `ensureWritableState` should create `.agent-team/`, write a small probe file, and remove it.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/workspaces.test.ts tests/doctor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/workspaces.ts src/doctor.ts tests/core/workspaces.test.ts tests/doctor.test.ts
git commit -m "feat: add workspace doctor preflight checks"
```

## Task 3: Provider Routing Readiness And MCP Doctor CWD

**Files:**
- Modify: `src/doctor.ts`
- Modify: `src/mcp/tools.ts`
- Test: `tests/doctor.test.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing routing and MCP tests**

Add tests proving:

- default write-disabled config reports `slice-implementer` unavailable as `warn`, while read-only roles pass.
- write-enabled config fails if no provider can satisfy `slice-implementer`.
- write-enabled config passes when default Claude provider exposes edit and workspace isolation capabilities.
- `agent_team_doctor` passes optional `cwd` into `runDoctor`.
- invalid doctor `cwd` returns `validation_error`.

Run:

```bash
npm test -- tests/doctor.test.ts tests/mcp/tools.test.ts
```

Expected: FAIL because doctor does not validate role routing and MCP doctor ignores cwd.

- [ ] **Step 2: Implement routing readiness and MCP plumbing**

In `runDoctor`, build providers with `listProviders({ config })` and iterate `listRoles()`.

Rules:

- For read-only roles, provider routing failures are `fail`.
- For `slice-implementer` when write mode is disabled, report `warn` with message `slice-implementer is unavailable until isolated write mode is enabled.`
- For `slice-implementer` when write mode is enabled, routing failure is `fail`.

In `src/mcp/tools.ts`:

- Add optional dependency `doctor?: typeof runDoctor`.
- For `agent_team_doctor`, validate optional `cwd` string and call `doctor({ workspaceRoot })`.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/doctor.test.ts tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/doctor.ts src/mcp/tools.ts tests/doctor.test.ts tests/mcp/tools.test.ts
git commit -m "feat: report provider routing readiness"
```

## Task 4: Local CI Script Parity

**Files:**
- Modify: `package.json`
- Create: `tests/package-scripts.test.ts`

- [ ] **Step 1: Write failing package script test**

Create a test proving `scripts.ci` includes all three commands in order:

```text
npm run typecheck
npm test
npm run build
```

Run:

```bash
npm test -- tests/package-scripts.test.ts
```

Expected: FAIL because `npm run ci` currently omits build.

- [ ] **Step 2: Update `npm run ci`**

Change:

```json
"ci": "npm run typecheck && npm test"
```

to:

```json
"ci": "npm run typecheck && npm test && npm run build"
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/package-scripts.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json tests/package-scripts.test.ts
git commit -m "test: align local ci script with build gate"
```

## Task 5: Verification And Integration

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused Milestone 7 tests**

Run:

```bash
npm test -- tests/doctor.test.ts tests/core/workspaces.test.ts tests/mcp/tools.test.ts tests/package-scripts.test.ts
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
