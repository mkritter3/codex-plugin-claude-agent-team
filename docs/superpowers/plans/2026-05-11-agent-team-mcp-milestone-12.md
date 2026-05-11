# Agent Team MCP Milestone 12 Tool Schema Contract Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose explicit MCP input schemas for every Agent Team tool so the packaged server advertises a truthful, provider-neutral request contract at the product boundary.

**Architecture:** Keep the existing tool parser functions as the runtime fail-closed validation layer, and add a separate MCP schema module for the SDK registration surface. Server registration will attach Zod-backed schemas and provider-neutral descriptions to each tool without exposing provider prompts or Claude-specific internals. The packaged stdio smoke will verify the built server advertises these schemas through `listTools`.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP SDK `McpServer.registerTool`, Zod schema objects, existing MCP tool handlers, packaged stdio smoke.

---

## File Structure

- Create `src/mcp/schemas.ts`: Zod-backed input schema definitions and metadata for all MCP tools.
- Modify `src/mcp/server.ts`: register tools with schema metadata instead of title/description only.
- Modify `scripts/smoke-mcp-stdio.mjs`: assert listed tools expose expected input schemas from the built stdio server.
- Modify `package.json` and `package-lock.json`: add explicit direct `zod` dependency if needed by the new schema module.
- Modify `tests/mcp/server.test.ts`: prove every registered tool receives an input schema and the same shared handler set.
- Modify `tests/mcp/tools.test.ts`: preserve handler-level validation and provider-neutral tool names.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- Every tool from `listToolNames()` registers with a non-empty MCP `inputSchema`.
- `agent_team_dispatch` and `agent_team_start` schemas require `role` and `task`.
- `agent_team_message` schema requires `runId` and `message`.
- `agent_team_reply`, `agent_team_status`, `agent_team_cancel`, and `agent_team_wind_down` schemas require the appropriate run id fields.
- Metadata remains provider-neutral and does not expose Claude-specific prompts or internal prompt text.
- Handler-level validation remains intact and tests continue to cover invalid arguments.
- Packaged stdio smoke verifies the built server exposes expected tool schemas through `client.listTools()`.
- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback, heuristic LLM behavior, benchmark mock, provider addition, or automatic worktree cleanup is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass in the implementation worktree before merge.

## Task 1: MCP Schema Metadata

**Files:**
- Create: `src/mcp/schemas.ts`
- Modify: `src/mcp/server.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing server schema tests**

Add tests proving:

- each registered tool receives metadata with an `inputSchema`
- `agent_team_dispatch` metadata includes `role` and `task`
- `agent_team_message` metadata includes `runId` and `message`
- metadata descriptions do not include provider prompt wording

Run:

```bash
npm test -- tests/mcp/server.test.ts
```

Expected: FAIL because server registration currently passes only title and description.

- [ ] **Step 2: Implement schema module and registration**

Create `src/mcp/schemas.ts` with:

- `TOOL_METADATA_BY_NAME`
- Zod-backed object schemas for all tool inputs
- concise provider-neutral descriptions

Update `src/mcp/server.ts` to use the metadata map when registering tools.

If importing `zod` directly, add it as an explicit runtime dependency.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/mcp/server.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/schemas.ts src/mcp/server.ts tests/mcp/server.test.ts package.json package-lock.json
git commit -m "feat: register mcp tool input schemas"
```

## Task 2: Packaged Schema Smoke

**Files:**
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Modify: `tests/package-runtime.test.ts`

- [ ] **Step 1: Write failing packaged schema smoke assertions**

Update the smoke expectations so `client.listTools()` proves:

- `agent_team_dispatch` has required `role` and `task`
- `agent_team_message` has required `runId` and `message`
- `agent_team_list_roles` has an object schema even though it has no required args

Run:

```bash
npm run build
npm run smoke:mcp-stdio
```

Expected: FAIL before schema registration is wired into the packaged server.

- [ ] **Step 2: Implement smoke schema assertions**

Update `scripts/smoke-mcp-stdio.mjs` to inspect `tools.tools[].inputSchema` and assert required fields without calling Claude or starting model work.

- [ ] **Step 3: Run focused verification**

Run:

```bash
npm test -- tests/package-runtime.test.ts
npm run build
npm run smoke:mcp-stdio
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-mcp-stdio.mjs tests/package-runtime.test.ts
git commit -m "test: assert packaged mcp tool schemas"
```

## Task 3: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/mcp/server.test.ts tests/mcp/tools.test.ts tests/package-runtime.test.ts
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

- [ ] **Step 3: Review schema content**

Run:

```bash
rg "Claude|prompt|system prompt|claude-code-cli" src/mcp/schemas.ts scripts/smoke-mcp-stdio.mjs
```

Expected: no provider-specific prompt leakage in schema metadata.

- [ ] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-12.md
git commit -m "docs: mark tool schema milestone complete"
```
