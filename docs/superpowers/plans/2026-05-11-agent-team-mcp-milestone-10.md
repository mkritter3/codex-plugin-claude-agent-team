# Agent Team MCP Milestone 10 Provider Runtime Boundary Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move provider execution, background session start, environment inspection, and doctor health checks behind a provider-neutral runtime boundary while keeping Claude Code CLI subscription OAuth as the only bundled v1 transport.

**Architecture:** Provider descriptors remain the routing surface and provider runtimes become the execution surface. Core dispatch, lifecycle, and doctor resolve a runtime by selected provider id, then call shared runtime methods for print runs, background sessions, environment inspection, and health checks. The first registry contains only `claude-code-cli`; missing runtimes fail closed instead of silently falling back to Claude or API-key behavior.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing provider descriptors/router/lifecycle/doctor modules, existing Claude Code CLI runner/background/doctor adapter internals.

---

## File Structure

- Create `src/providers/runtime.ts`: provider-neutral runtime interface, registry helpers, and fail-closed runtime lookup.
- Create `src/providers/claude-code-cli/runtime.ts`: Claude Code CLI runtime adapter wrapping the existing runner, background starter, and environment inspector.
- Modify `src/providers/types.ts`: add provider-neutral print, session-start, environment-inspection, and health-check contracts.
- Modify `src/providers/index.ts`: keep descriptor exports and re-export runtime registry helpers from one provider entrypoint.
- Modify `src/core/dispatch.ts`: replace direct Claude runner/environment imports with selected-provider runtime calls.
- Modify `src/core/lifecycle.ts`: replace the hardcoded default Claude background starter with selected-provider runtime session starts.
- Modify `src/doctor.ts`: replace direct Claude environment/CLI checks with provider runtime health and environment checks.
- Add `tests/providers/runtime.test.ts`: cover bundled runtime registry and fail-closed lookup.
- Modify `tests/core/dispatch.test.ts`: cover fake provider runtime selection and auth-precedence blocking through runtime inspection.
- Modify `tests/core/lifecycle.test.ts`: cover runtime-based background starts for a fake provider.
- Modify `tests/doctor.test.ts`: cover runtime health checks and missing-runtime failures.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- `src/core/dispatch.ts` has no imports from `src/providers/claude-code-cli/*`.
- `src/core/lifecycle.ts` has no imports from `src/providers/claude-code-cli/*`.
- `src/doctor.ts` has no imports from `src/providers/claude-code-cli/*`.
- `claude-code-cli` remains the only bundled runtime and still defaults to `subscription-oauth`.
- Runtime lookup is provider-id based and fails closed when no runtime exists.
- Dispatch keeps the same sidecar, mailbox event, log, verdict, and failed-run behavior.
- Lifecycle keeps the same sidecar, mailbox, live stdin, wind-down, cancellation, workspace retention, and cleanup behavior.
- Doctor keeps config/state/git/routing checks and reports provider runtime health without Claude-specific core imports.
- No API-key fallback, benchmark heuristic, mock model-quality claim, new provider, or automatic worktree cleanup is introduced.
- `npm run typecheck`, `npm test`, and `npm run build` pass in the implementation worktree before merge.

## Task 1: Provider Runtime Contract

**Files:**
- Create: `src/providers/runtime.ts`
- Create: `src/providers/claude-code-cli/runtime.ts`
- Modify: `src/providers/types.ts`
- Modify: `src/providers/index.ts`
- Test: `tests/providers/runtime.test.ts`

- [x] **Step 1: Write failing runtime registry tests**

Add tests proving:

- `listProviderRuntimes()` returns the bundled Claude Code CLI runtime.
- `getProviderRuntime("claude-code-cli")` returns a runtime whose descriptor uses `authMode: "subscription-oauth"`.
- `requireProviderRuntime("missing-provider")` throws a clear missing-runtime error.

Run:

```bash
npm test -- tests/providers/runtime.test.ts
```

Expected: FAIL because no provider runtime registry exists.

- [x] **Step 2: Implement runtime types and Claude runtime**

Add provider-neutral contracts for:

- `ProviderPrintInput`
- `ProviderPrintResult`
- `ProviderStartSessionInput`
- `ProviderEnvironmentInspection`
- `ProviderEnvironmentInspectionInput`
- `ProviderHealthCheckInput`
- `ProviderHealthCheck`
- `AgentProviderRuntime`

Implement `claudeCodeCliRuntime` by wrapping:

- `claudeCodeCliProvider`
- `inspectClaudeEnvironment`
- `runClaudePrint`
- `startClaudeBackgroundSession`
- a Claude CLI health check that reports `claude-cli` pass/fail using injected executable/version probes

Add registry helpers:

- `listProviderRuntimes()`
- `getProviderRuntime(providerId, options?)`
- `requireProviderRuntime(providerId, options?)`

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/providers/runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/providers/runtime.ts src/providers/claude-code-cli/runtime.ts src/providers/types.ts src/providers/index.ts tests/providers/runtime.test.ts
git commit -m "feat: add provider runtime registry"
```

## Task 2: Provider-Neutral Dispatch

**Files:**
- Modify: `src/core/dispatch.ts`
- Modify: `tests/core/dispatch.test.ts`

- [x] **Step 1: Write failing dispatch runtime tests**

Add tests proving:

- dispatch can route to a fake provider descriptor and call the matching fake runtime instead of Claude.
- fake runtime output still writes the raw log and parsed verdict into the existing sidecar path.
- subscription OAuth override warnings from the selected runtime block execution before `runPrint`.

Run:

```bash
npm test -- tests/core/dispatch.test.ts
```

Expected: FAIL because dispatch imports `runClaudePrint` and `inspectClaudeEnvironment` directly.

- [x] **Step 2: Implement runtime-based dispatch**

Update `DispatchDependencies` to accept runtime registry overrides. After selecting the provider:

- resolve the runtime for `provider.id`
- call `runtime.inspectEnvironment({ authMode: provider.authMode, env })`
- call `runtime.runPrint({ prompt, cwd, timeoutMs, env })`
- keep the existing queued/running/completed/failed sidecar and mailbox events
- keep the existing raw log format
- report provider run failures with provider-neutral copy

Do not add fallback runtimes or API-key behavior.

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/dispatch.test.ts tests/providers/runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/dispatch.ts tests/core/dispatch.test.ts
git commit -m "feat: dispatch through provider runtimes"
```

## Task 3: Provider-Neutral Lifecycle Starts

**Files:**
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing lifecycle runtime tests**

Add tests proving:

- `AgentLifecycleManager.startRun` uses the selected provider runtime's `startSession`.
- `AgentLifecycleManager.replyRun` resumes through the selected provider runtime's `startSession`.
- the existing explicit `startSession` dependency still overrides runtime lookup for narrow unit tests.

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected: FAIL because lifecycle imports the Claude background starter directly.

- [x] **Step 2: Implement runtime-based lifecycle session starts**

Update lifecycle dependencies to accept runtime registry overrides. Replace the constructor's Claude default with a helper that:

- returns `deps.startSession` when explicitly provided
- otherwise resolves the runtime for the selected provider id
- calls `runtime.startSession(...)`

Preserve all existing state, mailbox, live message, cancellation, wind-down, workspace evidence, and completion behavior.

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts tests/providers/runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/lifecycle.ts tests/core/lifecycle.test.ts
git commit -m "feat: start lifecycle sessions through provider runtimes"
```

## Task 4: Provider Runtime Health In Doctor

**Files:**
- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [x] **Step 1: Write failing doctor runtime tests**

Add tests proving:

- doctor uses runtime health output for the selected provider's CLI/version readiness.
- doctor uses runtime environment inspection for auth precedence warnings.
- doctor fails closed when a configured provider descriptor has no runtime.

Run:

```bash
npm test -- tests/doctor.test.ts
```

Expected: FAIL because doctor imports Claude environment inspection directly and performs Claude CLI checks itself.

- [x] **Step 2: Implement runtime-based doctor checks**

Update doctor to:

- resolve a runtime for each configured provider
- call `runtime.healthCheck({ env, findExecutable, getVersion })`
- call `runtime.inspectEnvironment(...)`
- keep config, state directory, git-worktree, role-routing, and warning aggregation behavior
- add a failing `provider-runtime:<provider-id>` check when a provider has no runtime

Do not introduce API fallback unless `config.auth.allowApiKeyFallback` already changes auth-precedence from fail to warn.

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/doctor.test.ts tests/providers/runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/doctor.ts tests/doctor.test.ts
git commit -m "feat: check provider runtime health in doctor"
```

## Task 5: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/providers/runtime.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts tests/doctor.test.ts
```

Expected: PASS.

- [x] **Step 2: Run provider-boundary grep**

Run:

```bash
rg "providers/claude-code-cli" src/core src/doctor.ts
```

Expected: no matches.

- [x] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: PASS.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-10.md
git commit -m "docs: mark provider runtime milestone complete"
```
