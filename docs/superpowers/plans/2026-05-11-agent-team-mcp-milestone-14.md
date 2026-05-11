# Agent Team MCP Milestone 14 Doctor Runtime Readiness Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agent_team_doctor` a truthful runtime preflight for host readiness, MCP module loadability, and Claude Code CLI subscription-backed execution before users dispatch live sidecars.

**Status:** Selected as Milestone 14 after Milestone 13 completed the outbox plus `awaiting-input` mailbox slice. This is now the next runtime-readiness implementation target.

**Architecture:** Keep doctor orchestration provider-neutral. Host checks belong in `src/doctor.ts`; provider-specific auth readiness belongs behind the provider runtime health contract. Claude Code CLI remains the primary v1 transport, and the doctor should fail closed when the CLI is missing or `claude auth status` cannot confirm an authenticated CLI session. Auth override warnings continue to flow through the existing provider environment inspection path so future providers can add their own checks without coupling the doctor core to Claude internals.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing doctor command injection seams, Claude Code CLI runtime adapter, MCP server module import check.

---

## File Structure

- Modify `src/doctor.ts`: add host Node version and MCP server loadability checks; pass a generic provider command runner into runtime health checks.
- Modify `src/providers/types.ts`: extend provider health input with a provider-neutral command runner contract.
- Modify `src/providers/claude-code-cli/runtime.ts`: check `claude auth status` through the injected command runner and report actionable fix details.
- Modify `src/providers/claude-code-cli/doctor.ts`: include `CLAUDE_CODE_OAUTH_TOKEN` in subscription override detection.
- Modify `.github/workflows/ci.yml`: run the shared `npm run ci` gate so packaged stdio smoke executes in CI.
- Modify `tests/doctor.test.ts`: cover host readiness, MCP loadability, and command-runner wiring.
- Modify `tests/providers/claude-code-cli/doctor.test.ts`: cover the expanded OAuth override warning.
- Add or modify `tests/providers/claude-code-cli/runtime-health.test.ts`: cover Claude CLI auth readiness failures without invoking the real CLI.
- Modify `tests/package-scripts.test.ts` and `tests/mcp/tools.test.ts`: lock GitHub CI to the shared packaged smoke gate.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- Doctor reports a `node-version` check and fails closed below the package `engines.node` floor.
- Doctor reports an `mcp-server-loadable` check and fails closed if the MCP server module cannot be loaded.
- Provider health checks receive a generic command runner rather than shelling out independently.
- Claude Code CLI health reports both binary/version readiness and `claude auth status` readiness.
- Missing or failed Claude CLI auth includes actionable fix details without introducing API-key fallback.
- `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN` all warn in subscription OAuth mode.
- GitHub CI runs `npm run ci`, which includes typecheck, tests, build, and packaged stdio smoke.
- No heuristic/mock LLM behavior, benchmark claims, provider-specific doctor coupling, or automatic cleanup behavior is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Host Doctor Readiness

**Files:**
- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [x] **Step 1: Write failing doctor host-readiness tests**

Add tests proving:

- `node-version` passes on Node 22+ and fails below Node 22
- `mcp-server-loadable` fails when the injected loadability check throws
- ordinary provider/runtime tests can inject passing host checks without touching real package artifacts

Run:

```bash
npm test -- tests/doctor.test.ts
```

Expected: FAIL because the doctor does not report these checks yet.

- [x] **Step 2: Implement provider-neutral host checks**

Update `runDoctor` to:

- parse an injectable `nodeVersion` with `process.versions.node` as the default
- report `node-version` against the package Node 22 runtime floor
- import/check the MCP server module through an injectable `checkMcpServerLoadable` function
- report clear fix details when either check fails

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/doctor.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/doctor.ts tests/doctor.test.ts
git commit -m "feat: add doctor host readiness checks"
```

## Task 2: Provider Command Runner And Claude Auth Readiness

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/doctor.ts`
- Modify: `src/providers/claude-code-cli/runtime.ts`
- Add or modify: `tests/providers/claude-code-cli/runtime-health.test.ts`
- Modify: `tests/doctor.test.ts`

- [x] **Step 1: Write failing provider health tests**

Add tests proving:

- Claude runtime health calls the injected command runner with `claude auth status`
- failed auth status returns a `claude-auth` failure with command and fix details
- successful auth status returns a `claude-auth` pass
- doctor passes the same generic command runner into runtime health checks

Run:

```bash
npm test -- tests/providers/claude-code-cli/runtime-health.test.ts tests/doctor.test.ts
```

Expected: FAIL because provider health cannot run command-based auth checks yet.

- [x] **Step 2: Implement command runner contract**

Update provider health input to include a generic command runner result with:

- `ok`
- `stdout`
- `stderr`
- `exitCode`

Add the default doctor command runner through `execFile`, pass it into runtime health checks, and keep provider runtimes responsible for their own provider-specific commands.

- [x] **Step 3: Implement Claude auth health**

Update the Claude Code CLI runtime health check to:

- preserve the existing `claude-cli` binary/version check
- run `claude auth status`
- fail closed when auth status exits non-zero
- report fix details that keep subscription OAuth primary and do not suggest API-key fallback

- [x] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/runtime-health.test.ts tests/doctor.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/providers/types.ts src/doctor.ts src/providers/claude-code-cli/runtime.ts tests/providers/claude-code-cli/runtime-health.test.ts tests/doctor.test.ts
git commit -m "feat: verify claude cli auth in doctor"
```

## Task 3: Subscription Override Coverage

**Files:**
- Modify: `src/providers/claude-code-cli/doctor.ts`
- Modify: `tests/providers/claude-code-cli/doctor.test.ts`

- [x] **Step 1: Write failing override test**

Add `CLAUDE_CODE_OAUTH_TOKEN` to the subscription override warning expectations.

Run:

```bash
npm test -- tests/providers/claude-code-cli/doctor.test.ts
```

Expected: FAIL until the override list includes the token.

- [x] **Step 2: Implement override warning**

Update Claude environment inspection to warn when `CLAUDE_CODE_OAUTH_TOKEN` is present in subscription OAuth mode.

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/doctor.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/doctor.ts tests/providers/claude-code-cli/doctor.test.ts
git commit -m "fix: warn on claude oauth token override"
```

## Task 4: Verification And Merge Readiness

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/package-scripts.test.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify only other files if verification finds issues.

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/doctor.test.ts tests/providers/claude-code-cli/doctor.test.ts tests/providers/claude-code-cli/runtime-health.test.ts
```

Expected: PASS.

- [x] **Step 2: Add CI packaged smoke gate**

Update GitHub CI to run the shared `npm run ci` script and add/adjust tests proving CI does not omit the packaged stdio smoke gate.

Run:

```bash
npm test -- tests/package-scripts.test.ts tests/mcp/tools.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

Expected: PASS.

- [x] **Step 4: Review provider-neutral boundaries**

Run:

```bash
rg "claude auth status|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN" src/doctor.ts
rg "runCommand|ProviderCommand" src/providers src/doctor.ts
```

Expected: no Claude-specific command names or env var lists in `src/doctor.ts`; provider-specific readiness remains in the Claude runtime/doctor modules.

- [x] **Step 5: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-14.md
git commit -m "docs: mark doctor readiness milestone complete"
```
