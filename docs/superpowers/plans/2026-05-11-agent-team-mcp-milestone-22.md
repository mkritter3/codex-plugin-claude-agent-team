# Agent Team MCP Milestone 22 Claude Agent Artifact Drift Guard Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude agent definition artifacts fail closed on drift instead of silently overwriting corrupted or stale provider-owned state.

**Architecture:** M21 added provider-owned generated Claude artifacts under `.agent-team/providers/claude/`, but runtime health currently calls the write path directly. M22 adds a validate-or-create boundary in the Claude provider store: missing artifacts are created, valid artifacts are trusted, and existing artifacts with hash or schema drift return a failed provider health check with repair guidance. The MCP/core surface stays provider-neutral; only the Claude adapter owns Claude artifact semantics.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, provider health checks, atomic JSON writes, deterministic SHA-256 provenance.

---

## File Structure

- Modify `src/providers/claude-code-cli/agent-definition-store.ts`: add a validate-or-create helper and artifact action metadata.
- Modify `src/providers/claude-code-cli/runtime.ts`: use the validate-or-create helper for runtime health checks.
- Modify `tests/providers/claude-code-cli/agent-definition-store.test.ts`: cover missing, valid, and drifted artifact behavior.
- Modify `tests/providers/claude-code-cli/runtime-health.test.ts`: cover runtime health failing closed on drift.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- Missing Claude artifact files are created under `.agent-team/providers/claude/`.
- Already-valid Claude artifact files are validated without being rewritten.
- Drifted `agents.json` or `manifest.json` causes a failed `claude-agent-definition-artifacts` health check.
- Failed drift health details include the artifact paths, the validation error, and repair guidance.
- Existing `ensureClaudeAgentDefinitionArtifacts` remains available as the explicit write/repair path.
- Runtime `--agents` behavior from M19 remains unchanged.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Validate-Or-Create Artifact Store

**Files:**
- Modify: `src/providers/claude-code-cli/agent-definition-store.ts`
- Modify: `tests/providers/claude-code-cli/agent-definition-store.test.ts`

- [x] **Step 1: Write failing validate-or-create store tests**

Add tests proving:

- `ensureValidClaudeAgentDefinitionArtifacts({ workspaceRoot })` creates missing artifacts and returns `action: "created"`
- a second call with unchanged artifacts returns `action: "validated"` and preserves the original file modification time
- drifted persisted definitions reject with `ClaudeAgentDefinitionArtifactError`

Run:

```bash
npm test -- tests/providers/claude-code-cli/agent-definition-store.test.ts
```

Expected: FAIL because `ensureValidClaudeAgentDefinitionArtifacts` does not exist.

- [x] **Step 2: Implement validate-or-create helper**

In `src/providers/claude-code-cli/agent-definition-store.ts`:

- add `type ClaudeAgentDefinitionArtifactAction = "created" | "validated" | "repaired"`
- add `readonly action: ClaudeAgentDefinitionArtifactAction` to `ClaudeAgentDefinitionArtifactResult`
- keep `ensureClaudeAgentDefinitionArtifacts` as the explicit writer and have it return `action: "created"`
- add `ensureValidClaudeAgentDefinitionArtifacts({ workspaceRoot })`
- have it call `validateClaudeAgentDefinitionArtifacts` first
- if validation succeeds, return the validated result with `action: "validated"`
- if validation fails because either artifact file is missing, call `ensureClaudeAgentDefinitionArtifacts`
- if validation fails for hash/schema/JSON drift, rethrow a `ClaudeAgentDefinitionArtifactError`

Do not add heuristic repair for drift in this helper; explicit repair remains the write helper.

- [x] **Step 3: Run focused store tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/agent-definition-store.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/agent-definition-store.ts tests/providers/claude-code-cli/agent-definition-store.test.ts
git commit -m "feat: guard claude agent artifact drift"
```

## Task 2: Runtime Health Drift Failure

**Files:**
- Modify: `src/providers/claude-code-cli/runtime.ts`
- Modify: `tests/providers/claude-code-cli/runtime-health.test.ts`

- [x] **Step 1: Write failing runtime health drift test**

Add a runtime health test proving:

- initial health creates valid artifacts
- mutating persisted `agents.json` after creation makes the next health check include `claude-agent-definition-artifacts` with `status: "fail"`
- failure details include relative `agentsPath`, relative `manifestPath`, a concrete error, and a repair hint
- the CLI auth command still runs when Claude exists, so artifact drift is surfaced alongside auth state instead of hiding other checks

Run:

```bash
npm test -- tests/providers/claude-code-cli/runtime-health.test.ts
```

Expected: FAIL because runtime health currently overwrites drifted artifacts.

- [x] **Step 2: Use validate-or-create in runtime health**

In `src/providers/claude-code-cli/runtime.ts`:

- import `ensureValidClaudeAgentDefinitionArtifacts`
- call it from `checkClaudeAgentDefinitionArtifacts`
- include `action` in pass-check details
- on failure, include relative artifact paths from `claudeAgentDefinitionArtifacts(input.workspaceRoot)` when possible
- keep the existing Claude CLI binary, auth, generated-definition, subscription OAuth, and missing-CLI behavior

- [x] **Step 3: Run focused runtime health tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/runtime-health.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/runtime.ts tests/providers/claude-code-cli/runtime-health.test.ts
git commit -m "feat: fail claude health on artifact drift"
```

## Task 3: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/agent-definition-store.test.ts tests/providers/claude-code-cli/runtime-health.test.ts tests/doctor.test.ts
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

- [x] **Step 3: Review boundary and safety invariants**

Run:

```bash
rg "ensureValidClaudeAgentDefinitionArtifacts|claude-agent-definition-artifacts|providers/claude|action: \"validated\"|action: \"created\"" src tests docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-22.md
rg "allowApiKeyFallback|benchmark|embedding|mock LLM|bypassPermissions" src/providers/claude-code-cli src/core tests/providers tests/core
```

Expected: drift validation stays inside the Claude provider; existing fail-closed auth and bypass-permission guards remain unchanged; no benchmark, embedding, mock LLM, API fallback, or provider-specific MCP schema is introduced.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-22.md
git commit -m "docs: mark claude artifact drift guard milestone complete"
```
