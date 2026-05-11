# Agent Team MCP Milestone 11 Packaged Stdio Smoke Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the packaged `dist/index.js` entrypoint can launch as a real MCP stdio server and serve safe provider-neutral tool calls through the official MCP SDK client.

**Architecture:** Keep unit tests for internal server wiring, and add a separate post-build smoke script for the production-shaped stdio boundary. The smoke script will spawn `node ./dist/index.js` with `StdioClientTransport`, connect an SDK `Client`, list tools, call a safe metadata tool, validate structured content, close the transport, and fail loudly with captured stderr if the server cannot launch or respond. CI will run this smoke only after `npm run build`, because `dist/index.js` is intentionally a build artifact.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP SDK `Client`, MCP SDK `StdioClientTransport`, existing package `bin` and `.mcp.json` runtime contract.

---

## File Structure

- Create `scripts/smoke-mcp-stdio.mjs`: post-build stdio smoke against `dist/index.js`.
- Modify `package.json`: add `smoke:mcp-stdio` and run it after build in `npm run ci`.
- Modify `tests/package-scripts.test.ts`: assert CI order is typecheck, tests, build, then MCP stdio smoke.
- Modify `tests/package-runtime.test.ts`: assert `.mcp.json`, package bin, and smoke script all target the same built runtime boundary.
- Modify this plan file after implementation to mark completed tasks.

## Success Criteria

- Smoke script fails before implementation because `npm run smoke:mcp-stdio` is missing.
- `npm run smoke:mcp-stdio` runs only against built `dist/index.js`; it does not use `tsx`, source imports, or test-only handlers.
- Smoke connects with the official MCP SDK stdio client transport.
- Smoke verifies `agent_team_list_roles` is listed and callable.
- Smoke verifies structured content includes the provider-neutral role registry, without invoking Claude or any model.
- Smoke closes the client/transport and does not leave a server process behind.
- CI runs smoke after build, preserving the build artifact dependency.
- Claude Code CLI subscription OAuth remains the primary v1 transport, but the smoke does not require Claude credentials.
- No API-key fallback, heuristic LLM behavior, benchmark mock, provider addition, or automatic worktree cleanup is introduced.
- `npm run typecheck`, `npm test`, `npm run build`, and `npm run smoke:mcp-stdio` pass in the implementation worktree before merge.

## Task 1: Package Script Contract

**Files:**
- Modify: `package.json`
- Modify: `tests/package-scripts.test.ts`
- Modify: `tests/package-runtime.test.ts`

- [x] **Step 1: Write failing package script tests**

Add tests proving:

- `package.json` contains `smoke:mcp-stdio`.
- `npm run ci` runs `npm run build` before `npm run smoke:mcp-stdio`.
- `.mcp.json` and package `bin` continue to point at `./dist/index.js`.

Run:

```bash
npm test -- tests/package-scripts.test.ts tests/package-runtime.test.ts
```

Expected: FAIL because the smoke script is not yet declared.

- [x] **Step 2: Add script declarations**

Update `package.json`:

- add `"smoke:mcp-stdio": "node scripts/smoke-mcp-stdio.mjs"`
- update `"ci"` to `"npm run typecheck && npm test && npm run build && npm run smoke:mcp-stdio"`

Keep the existing build, test, start, and bin fields unchanged.

- [x] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/package-scripts.test.ts tests/package-runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add package.json tests/package-scripts.test.ts tests/package-runtime.test.ts
git commit -m "test: require packaged mcp stdio smoke in ci"
```

## Task 2: Stdio Smoke Script

**Files:**
- Create: `scripts/smoke-mcp-stdio.mjs`

- [x] **Step 1: Write the smoke script**

Create a Node ESM script that:

- verifies `dist/index.js` exists
- starts `node ./dist/index.js` through `StdioClientTransport`
- connects a `Client({ name: "agent-team-smoke", version: "0.1.0" })`
- calls `client.listTools()`
- asserts `agent_team_list_roles` is present
- calls `client.callTool({ name: "agent_team_list_roles", arguments: {} })`
- asserts `structuredContent.roles` contains `planner`
- closes the client
- prints `MCP stdio smoke passed.`

- [x] **Step 2: Verify smoke fails before build if dist is missing**

Run:

```bash
rm -rf dist
npm run smoke:mcp-stdio
```

Expected: FAIL with a clear message explaining `dist/index.js` is missing and `npm run build` should be run first.

- [x] **Step 3: Verify smoke passes after build**

Run:

```bash
npm run build
npm run smoke:mcp-stdio
```

Expected: PASS and prints `MCP stdio smoke passed.`

- [x] **Step 4: Commit**

```bash
git add scripts/smoke-mcp-stdio.mjs
git commit -m "test: add packaged mcp stdio smoke"
```

## Task 3: Verification And Merge Readiness

**Files:**
- Modify only if verification finds issues.

- [x] **Step 1: Run focused package tests**

Run:

```bash
npm test -- tests/package-scripts.test.ts tests/package-runtime.test.ts
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

- [x] **Step 3: Review stdio boundary**

Run:

```bash
rg "tsx|src/index|createToolHandlers" scripts/smoke-mcp-stdio.mjs .mcp.json
```

Expected: no source/test-only runtime shortcuts in the smoke path.

- [x] **Step 4: Commit final plan checkbox update**

Mark completed checklist items in this file and commit the update.

```bash
git add docs/superpowers/plans/2026-05-11-agent-team-mcp-milestone-11.md
git commit -m "docs: mark packaged stdio smoke milestone complete"
```
