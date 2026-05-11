# Agent Team MCP Milestone 21 Claude Agent Definition Artifacts Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist provider-owned generated Claude agent definitions under `.agent-team/providers/claude/` with manifest provenance and doctor validation.

**Architecture:** Keep generated Claude agent definitions owned by the Claude provider adapter, not MCP or core role schemas. M19 made definitions deterministic and attached them to Claude CLI `--agents`; M21 adds provider-owned artifact persistence so doctor can validate the exact generated JSON, role coverage, and hash provenance on disk. Doctor passes workspace context into provider health checks; the Claude health check materializes/validates the artifacts without invoking an LLM, changing routing, or introducing any API-key fallback.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, provider health checks, atomic JSON writes, deterministic SHA-256 provenance.

---

## File Structure

- Create `src/providers/claude-code-cli/agent-definition-store.ts`: write deterministic `agents.json` and `manifest.json` under `.agent-team/providers/claude/`.
- Modify `src/providers/types.ts`: add `workspaceRoot` to provider health-check input.
- Modify `src/doctor.ts`: pass `workspaceRoot` into provider runtime health checks.
- Modify `src/providers/claude-code-cli/runtime.ts`: materialize and validate Claude agent definition artifacts during health checks.
- Add `tests/providers/claude-code-cli/agent-definition-store.test.ts`: cover artifact paths, deterministic hashes, and validation failure on drift.
- Modify `tests/providers/claude-code-cli/runtime-health.test.ts`: cover persisted artifact health details.
- Modify `tests/doctor.test.ts`: cover provider health checks receiving workspace root.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- Doctor health checks receive the workspace root through the provider-neutral health-check contract.
- Claude provider health checks create `.agent-team/providers/claude/agents.json`.
- Claude provider health checks create `.agent-team/providers/claude/manifest.json`.
- The manifest includes provider id, definition count, role ids, SHA-256 hash, and relative artifact paths.
- Artifact validation detects drift between `agents.json` and `manifest.json`.
- The persisted definitions remain generated only by `src/providers/claude-code-cli/`.
- Runtime `--agents` behavior from M19 remains unchanged.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic/mock LLM behavior, benchmark claim, provider-specific MCP schema, or automatic workspace deletion is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: Claude Agent Artifact Store

**Files:**
- Create: `src/providers/claude-code-cli/agent-definition-store.ts`
- Add: `tests/providers/claude-code-cli/agent-definition-store.test.ts`

- [ ] **Step 1: Write failing artifact store tests**

Add tests proving:

- `ensureClaudeAgentDefinitionArtifacts({ workspaceRoot })` writes `agents.json` and `manifest.json` under `.agent-team/providers/claude/`
- the returned manifest includes `providerId: "claude-code-cli"`, role ids, definition count, relative paths, and a SHA-256 hash
- two consecutive ensures produce the same hash
- `validateClaudeAgentDefinitionArtifacts({ workspaceRoot })` fails when the persisted `agents.json` no longer matches the manifest hash

Run:

```bash
npm test -- tests/providers/claude-code-cli/agent-definition-store.test.ts
```

Expected: FAIL because the artifact store does not exist.

- [ ] **Step 2: Implement artifact store**

Create helpers in `src/providers/claude-code-cli/agent-definition-store.ts`:

- `claudeAgentDefinitionArtifacts(workspaceRoot)`
- `ensureClaudeAgentDefinitionArtifacts(input)`
- `validateClaudeAgentDefinitionArtifacts(input)`

Use `buildClaudeAgentDefinitions`, `serializeClaudeAgentDefinitions`, and `validateClaudeAgentDefinitions` from M19. Write JSON using the shared atomic JSON writer. Compute the hash with Node `crypto.createHash("sha256")` over the deterministic serialized definitions.

- [ ] **Step 3: Run focused artifact store tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/agent-definition-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/agent-definition-store.ts tests/providers/claude-code-cli/agent-definition-store.test.ts
git commit -m "feat: persist claude agent definitions"
```

## Task 2: Provider Health Workspace Context

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [ ] **Step 1: Write failing workspace-context doctor test**

Add a doctor test with a fake runtime proving:

- provider `healthCheck(input)` receives `input.workspaceRoot`
- the value equals the doctor workspace root

Run:

```bash
npm test -- tests/doctor.test.ts
```

Expected: FAIL because `ProviderHealthCheckInput` does not currently include workspace root.

- [ ] **Step 2: Add provider-neutral workspaceRoot to health input**

Update `ProviderHealthCheckInput` in `src/providers/types.ts`:

```ts
readonly workspaceRoot: string;
```

Update `runDoctor` so every provider `runtime.healthCheck` receives that workspace root.

- [ ] **Step 3: Run focused doctor tests**

Run:

```bash
npm test -- tests/doctor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/types.ts src/doctor.ts tests/doctor.test.ts
git commit -m "feat: pass workspace to provider health"
```

## Task 3: Claude Health Check Artifact Validation

**Files:**
- Modify: `src/providers/claude-code-cli/runtime.ts`
- Modify: `tests/providers/claude-code-cli/runtime-health.test.ts`

- [ ] **Step 1: Write failing Claude health artifact tests**

Add a runtime health test proving:

- successful Claude health checks include `claude-agent-definition-artifacts`
- the check details include `agentsPath`, `manifestPath`, `definitionCount`, and `definitionsHash`
- the files exist on disk after health check

Run:

```bash
npm test -- tests/providers/claude-code-cli/runtime-health.test.ts
```

Expected: FAIL because runtime health only validates generated definitions in memory.

- [ ] **Step 2: Wire artifact store into Claude runtime health**

In `src/providers/claude-code-cli/runtime.ts`:

- call `ensureClaudeAgentDefinitionArtifacts({ workspaceRoot: input.workspaceRoot })`
- return a pass check `claude-agent-definition-artifacts` with artifact paths and hash
- if the store throws, return a fail check with the error and a concrete repair message
- preserve existing CLI binary, auth, generated-definition, and subscription OAuth checks

- [ ] **Step 3: Run focused runtime health tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/runtime-health.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli/runtime.ts tests/providers/claude-code-cli/runtime-health.test.ts
git commit -m "feat: validate claude agent artifacts"
```

## Task 4: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/providers/claude-code-cli/agent-definition-store.test.ts tests/providers/claude-code-cli/runtime-health.test.ts tests/doctor.test.ts
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
rg "agent-definition|providers/claude|workspaceRoot" src tests docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-21.md
rg "allowApiKeyFallback|benchmark|embedding|mock LLM|bypassPermissions" src/providers/claude-code-cli src/core tests/providers tests/core
```

Expected: Claude artifact ownership stays inside the Claude provider; workspace root is only added to the provider-neutral health-check contract. Existing fail-closed auth and bypass-permission guards remain unchanged; no benchmark, embedding, mock LLM, API fallback, or provider-specific MCP schema is introduced.

- [ ] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-21.md
git commit -m "docs: mark claude agent artifacts milestone complete"
```
