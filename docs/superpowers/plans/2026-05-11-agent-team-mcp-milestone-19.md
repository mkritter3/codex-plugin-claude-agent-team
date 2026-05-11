# Agent Team MCP Milestone 19 Claude Agent Definitions Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate provider-owned Claude Code agent definitions and route them through the Claude CLI adapter without leaking Claude-specific agent config through MCP or core orchestration.

**Architecture:** Keep Codex-facing roles provider-neutral in `src/core/roles.ts`, then translate them inside `src/providers/claude-code-cli/` into Claude `--agents` JSON plus the selected `--agent` role. The generated definitions reuse the existing Claude-owned role policy mapper for tools and permission defaults, so read-only roles remain read-only and `slice-implementer` remains edit-capable only through the existing isolated lifecycle permission path. Doctor validates the generated definitions are complete and serializable; runtime command construction consumes the same provider-owned generator.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, Claude Code CLI command builder, provider-owned role policy mapper, doctor health checks.

---

## File Structure

- Create `src/providers/claude-code-cli/agents.ts`: generate deterministic Claude `--agents` JSON definitions from provider-neutral roles and Claude-owned role policies.
- Modify `src/providers/claude-code-cli/types.ts`: add optional `agentName` and `agents` command inputs.
- Modify `src/providers/claude-code-cli/commands.ts`: serialize `--agents` and route the selected `--agent` role.
- Modify `src/providers/claude-code-cli/runner.ts`: pass generated agent definitions and selected role into print-mode commands.
- Modify `src/providers/claude-code-cli/background.ts`: pass generated agent definitions and selected role into background/resume commands.
- Modify `src/providers/claude-code-cli/doctor.ts`: expose generated-definition validation as Claude provider health checks.
- Add `tests/providers/claude-code-cli/agents.test.ts`: cover generated definition shape, role coverage, and fail-closed validation.
- Modify `tests/providers/claude-code-cli/commands.test.ts`: cover `--agents` and `--agent` flag construction.
- Modify `tests/providers/claude-code-cli/runner.test.ts`: cover print-mode generated agent routing.
- Modify `tests/providers/claude-code-cli/background.test.ts`: cover background generated agent routing.
- Modify `tests/providers/claude-code-cli/doctor.test.ts`: cover generated-definition doctor checks.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- Claude agent definitions are generated only under `src/providers/claude-code-cli/`.
- Every provider-neutral role has a generated Claude definition with a stable name matching the role id.
- Generated definitions include `description`, `prompt`, `tools`, and `disallowedTools` where the existing Claude role policy supplies them.
- Read-only generated definitions disallow edit/write/bash tools and do not enable `bypassPermissions`.
- `slice-implementer` generated definitions do not bypass isolated lifecycle write policy; edit permission still requires the existing `acceptEdits` path from lifecycle.
- `buildClaudeCommand` emits `--agents <json>` and `--agent <roleId>` only when provider code explicitly supplies them.
- Print and background Claude paths pass generated definitions when `roleId` is present.
- Doctor reports a pass/fail generated-definition check without invoking any LLM or benchmark behavior.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## References

- Claude CLI reference: `--agents` defines custom subagents dynamically via JSON and `--agent` selects an agent for the current session.
- Claude subagents docs: `--agents` JSON supports frontmatter fields including `description`, `prompt`, `tools`, `disallowedTools`, `permissionMode`, `model`, and related options.
- Accepted design: generated Claude agent definitions live behind the Claude provider boundary and must not become MCP schema surface.

## Task 1: Claude-Owned Agent Definition Generator

**Files:**
- Create: `src/providers/claude-code-cli/agents.ts`
- Add: `tests/providers/claude-code-cli/agents.test.ts`

- [ ] **Step 1: Write failing generated-definition tests**

Add tests proving:

- generated definitions include every role from `listRoles()`
- each definition is keyed by role id
- read-only roles include read/search tools and disallow edit/write/bash tools
- `slice-implementer` has a generated definition but does not set `permissionMode: "bypassPermissions"`
- validation fails when a role definition is missing

Run:

```bash
npm test -- tests/providers/claude-code-cli/agents.test.ts
```

Expected: FAIL because the agent-definition generator does not exist.

- [ ] **Step 2: Implement generated-definition module**

Create provider-owned helpers:

- `buildClaudeAgentDefinitions(roles = listRoles())`
- `serializeClaudeAgentDefinitions(definitions)`
- `validateClaudeAgentDefinitions(definitions, roles = listRoles())`

Use `claudeRolePolicyFor` for tools and disallowed tools. Keep Claude field names and prompt wording in this provider folder.

- [ ] **Step 3: Run focused generator tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/agents.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/agents.ts tests/providers/claude-code-cli/agents.test.ts
git commit -m "feat: generate claude agent definitions"
```

## Task 2: Claude Command Routing

**Files:**
- Modify: `src/providers/claude-code-cli/types.ts`
- Modify: `src/providers/claude-code-cli/commands.ts`
- Modify: `tests/providers/claude-code-cli/commands.test.ts`

- [ ] **Step 1: Write failing command tests**

Add tests proving:

- `buildClaudeCommand` emits `--agents` followed by valid JSON when definitions are supplied
- `buildClaudeCommand` emits `--agent <roleId>` when an agent name is supplied
- commands without definitions do not emit `--agents` or `--agent`

Run:

```bash
npm test -- tests/providers/claude-code-cli/commands.test.ts
```

Expected: FAIL because command input does not support agent definitions.

- [ ] **Step 2: Implement command flag support**

Add optional `agentName` and `agents` to `ClaudeCommandInput`.

In `buildClaudeCommand`:

- push `--agents` with `JSON.stringify(input.agents)` when supplied
- push `--agent` with `input.agentName` when supplied
- preserve existing `--allowedTools`, `--disallowedTools`, permission mode, resume, no-bare, and stream behavior

- [ ] **Step 3: Run focused command tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/commands.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/types.ts src/providers/claude-code-cli/commands.ts tests/providers/claude-code-cli/commands.test.ts
git commit -m "feat: route claude generated agents"
```

## Task 3: Runtime And Doctor Integration

**Files:**
- Modify: `src/providers/claude-code-cli/runner.ts`
- Modify: `src/providers/claude-code-cli/background.ts`
- Modify: `src/providers/claude-code-cli/doctor.ts`
- Modify: `tests/providers/claude-code-cli/runner.test.ts`
- Modify: `tests/providers/claude-code-cli/background.test.ts`
- Modify: `tests/providers/claude-code-cli/doctor.test.ts`

- [ ] **Step 1: Write failing runtime and doctor tests**

Add tests proving:

- print mode with `roleId: "code-reviewer"` passes `--agents` and `--agent code-reviewer`
- background mode with `roleId: "planner"` passes `--agents` and `--agent planner`
- background resume preserves `--resume` while also passing generated definitions for the selected role
- doctor reports `claude-agent-definitions` as passing when generation validates

Run:

```bash
npm test -- tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts tests/providers/claude-code-cli/doctor.test.ts
```

Expected: FAIL because runtime paths do not pass generated agent definitions and doctor does not check them.

- [ ] **Step 2: Wire runtime generation**

In print and background adapters:

- when `roleId` is present, call `buildClaudeAgentDefinitions()`
- pass the definitions as `agents`
- pass `agentName: roleId`
- preserve role policy, auth inspection, timeout behavior, session resume, log rotation, stdin, cancellation, and no-bare behavior

- [ ] **Step 3: Add doctor generated-definition check**

In Claude provider health checks:

- build definitions
- validate role coverage
- return a pass check with definition count when valid
- return a fail check if validation throws
- do not invoke Claude, an LLM, embeddings, or model-quality benchmarks

- [ ] **Step 4: Run focused integration tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts tests/providers/claude-code-cli/doctor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude-code-cli/runner.ts src/providers/claude-code-cli/background.ts src/providers/claude-code-cli/doctor.ts tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts tests/providers/claude-code-cli/doctor.test.ts
git commit -m "feat: attach claude agents to runtime"
```

## Task 4: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/agents.test.ts tests/providers/claude-code-cli/commands.test.ts tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts tests/providers/claude-code-cli/doctor.test.ts
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

- [ ] **Step 3: Review boundary and safety invariants**

Run:

```bash
rg "--agents|--agent|ClaudeAgent" src tests docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-19.md
rg "bypassPermissions|allowApiKeyFallback|benchmark|embedding|mock LLM" src/providers/claude-code-cli tests/providers/claude-code-cli
```

Expected: Claude-specific agent config stays under the Claude provider and tests. No new API fallback, benchmark, embedding, mock LLM, or bypass-permission path is introduced.

- [ ] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-19.md
git commit -m "docs: mark claude agent definitions milestone complete"
```
