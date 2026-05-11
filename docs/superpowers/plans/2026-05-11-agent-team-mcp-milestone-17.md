# Agent Team MCP Milestone 17 Claude Role Policy Routing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route provider-neutral role context into Claude Code CLI tool and permission policy without leaking Claude-specific flags through MCP.

**Architecture:** Keep the core provider-neutral by passing role identity and semantic execution policy through the provider runtime contract, not Claude tool names. Add a Claude-owned role policy mapper inside `src/providers/claude-code-cli/` that translates `RoleId` plus `AgentExecutionPolicy` into `--allowedTools`, `--disallowedTools`, and a safe permission mode for the Claude Code CLI. Read-only roles stay default-permission and deny edit/write/bash tools. `slice-implementer` may receive edit-capable tools only when lifecycle has already allocated an isolated worktree and requested `acceptEdits`; bypass permissions and bare mode remain unavailable. Sidecars, mailboxes, verdicts, status, wind-down, cleanup, and OAuth auth checks must keep existing behavior.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, provider-neutral runtime contracts, Claude Code CLI command builder, lifecycle orchestration.

---

## File Structure

- Modify `src/core/types.ts`: add provider-neutral `AgentExecutionPolicy` and attach it to roles.
- Modify `src/core/roles.ts`: assign explicit execution policies to every role.
- Modify `src/providers/types.ts`: add optional `roleId` and `executionPolicy` to provider print/start inputs.
- Create `src/providers/claude-code-cli/role-policy.ts`: provider-owned role-to-Claude tool/permission mapper.
- Modify `src/providers/claude-code-cli/runner.ts`: apply Claude role policy for synchronous read-only dispatch.
- Modify `src/providers/claude-code-cli/background.ts`: apply Claude role policy for durable sessions.
- Modify `src/core/dispatch.ts`: pass `roleId` into provider print calls.
- Modify `src/core/lifecycle.ts`: pass `roleId` into provider start/reply calls.
- Add `tests/providers/claude-code-cli/role-policy.test.ts`: cover Claude policy mapping.
- Modify `tests/providers/claude-code-cli/runner.test.ts`: cover read-only dispatch CLI flags.
- Modify `tests/providers/claude-code-cli/background.test.ts`: cover durable read-only and implementation CLI flags.
- Modify `tests/core/dispatch.test.ts`: cover provider print receives role id.
- Modify `tests/core/lifecycle.test.ts`: cover provider start/reply receives role id.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- Core runtime contracts pass provider-neutral `roleId` and `executionPolicy` to providers.
- Every role has an explicit provider-neutral execution policy.
- Claude role policy lives under the Claude provider folder, not core roles or MCP schemas.
- Read-only roles emit `--permission-mode default`, deny edit/write/bash tools, and do not use `acceptEdits`, `bypassPermissions`, or `--bare`.
- `slice-implementer` emits edit-capable Claude tools only in isolated implementation lifecycle starts with `acceptEdits`.
- Reply/resume runs preserve the parent read-only role policy.
- `agent_team_dispatch`, `agent_team_start`, and `agent_team_reply` continue to preserve sidecars, mailboxes, verdicts, status, wind-down, and cleanup behavior.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Claude-Owned Role Policy

**Files:**
- Modify: `src/providers/types.ts`
- Create: `src/providers/claude-code-cli/role-policy.ts`
- Add: `tests/providers/claude-code-cli/role-policy.test.ts`

- [x] **Step 1: Write failing Claude role policy tests**

Add tests proving:

- planner/code-reviewer/debugger/test-designer/architect/ux-product-critic policies use `permissionMode: "default"`
- read-only policies include file-read/search tools and disallow edit/write/bash tools
- `slice-implementer` with requested `acceptEdits` includes edit-capable tools and still does not use `bypassPermissions`
- unknown future behavior is fail-closed by exhaustive `RoleId` handling

Run:

```bash
npm test -- tests/providers/claude-code-cli/role-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [x] **Step 2: Implement Claude provider policy mapper**

Add optional `roleId` to `ProviderPrintInput` and `ProviderStartSessionInput`.

Create `claudeRolePolicyFor(input)` in `src/providers/claude-code-cli/role-policy.ts` returning:

- `permissionMode`
- `allowedTools`
- `disallowedTools`

Keep all Claude tool names in this provider-owned module.

- [x] **Step 3: Run focused policy tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/role-policy.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/providers/types.ts src/providers/claude-code-cli/role-policy.ts tests/providers/claude-code-cli/role-policy.test.ts
git commit -m "feat: add claude role policy mapper"
```

## Task 2: Provider Adapter Policy Application

**Files:**
- Modify: `src/providers/claude-code-cli/runner.ts`
- Modify: `src/providers/claude-code-cli/background.ts`
- Modify: `tests/providers/claude-code-cli/runner.test.ts`
- Modify: `tests/providers/claude-code-cli/background.test.ts`

- [x] **Step 1: Write failing adapter policy tests**

Add tests proving:

- `runClaudePrint({ roleId: "code-reviewer" })` passes `--allowedTools` and `--disallowedTools`
- print mode remains read-only and never passes `acceptEdits`, `bypassPermissions`, or `--bare`
- background planner sessions pass read-only tool policy
- background slice implementation sessions pass edit-capable tools only with `permissionMode: "acceptEdits"`
- background slice implementation sessions still do not pass `bypassPermissions` or `--bare`

Run:

```bash
npm test -- tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts
```

Expected: FAIL because adapters ignore role policy.

- [x] **Step 2: Apply role policy in Claude adapters**

In both adapter paths:

- resolve the Claude role policy when `roleId` is present
- pass `allowedTools` and `disallowedTools` into `buildClaudeCommand`
- let explicit lifecycle permission mode choose implementation `acceptEdits`, but never synthesize `bypassPermissions`
- preserve existing auth inspection, stream parsing, log rotation, stdin, resume, and no-bare behavior

- [x] **Step 3: Run focused adapter tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/runner.ts src/providers/claude-code-cli/background.ts tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts
git commit -m "feat: route claude role policies"
```

## Task 3: Core Role Context Plumbing

**Files:**
- Modify: `src/core/dispatch.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`

- [x] **Step 1: Write failing core plumbing tests**

Add tests proving:

- read-only dispatch passes `roleId` into `runtime.runPrint`
- lifecycle start passes the requested role id into `startSession`
- slice implementation starts pass `roleId: "slice-implementer"` with `permissionMode: "acceptEdits"`
- reply/resume runs pass the parent read-only role id into `startSession`

Run:

```bash
npm test -- tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

Expected: FAIL because core providers receive prompts and permission mode but not role identity.

- [x] **Step 2: Pass provider-neutral role id through core**

Update dispatch and lifecycle provider calls to include `roleId`.

Do not add Claude tool names to core code, MCP schemas, sidecars, or docs generated for tool users.

- [x] **Step 3: Run focused core tests**

Run:

```bash
npm test -- tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/core/dispatch.ts src/core/lifecycle.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
git commit -m "feat: pass role context to providers"
```

## Task 4: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/role-policy.test.ts tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

Expected: PASS.

- [x] **Step 3: Review provider-neutral boundaries**

Run:

```bash
rg "allowedTools|disallowedTools|Bash|Edit|Write|MultiEdit|NotebookEdit" src/core src/mcp
rg "roleId" src/providers src/core tests/providers tests/core
```

Expected: Claude tool names stay out of core and MCP; core only passes provider-neutral role identity and execution policy.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-17.md
git commit -m "docs: mark role policy milestone complete"
```
