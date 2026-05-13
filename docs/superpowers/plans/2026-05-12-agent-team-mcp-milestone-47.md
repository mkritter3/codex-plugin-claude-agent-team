# Agent Team MCP Milestone 47 Live Capability Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the current Claude-backed agent-team control plane across every operational control path before adding more write-capable providers.

**Architecture:** Add a repeatable operator-run live validation harness that drives only public packaged MCP tools. The harness should exercise direct dispatch, parallel starts, active mailbox delivery, wind-down, cancellation, isolated implementation worktrees, retained diff handoff, team records, dashboard, summary, cleanup, and policy failure paths without calling provider internals or weakening subscription OAuth.

**Tech Stack:** TypeScript/Node.js ESM scripts, MCP SDK stdio client, Vitest fixture tests, existing Agent Team MCP tools, Claude Code CLI subscription OAuth, `.agent-team/` sidecars/mailboxes/logs, git worktrees.

---

## File Structure

- Modify: `package.json`
  - Add `smoke:claude-live-matrix` pointing at a new operator-run script.
- Create: `scripts/live-smoke-claude-capability-matrix.mjs`
  - Packaged MCP stdio client that runs the live matrix with explicit confirmation.
- Create: `tests/live-smoke-claude-capability-matrix.test.ts`
  - Fixture tests for opt-in behavior, sanitized report shape, public tool flow, and CLI wiring.
- Modify: `tests/package-scripts.test.ts`
  - Assert the new live matrix script is excluded from `npm run ci`.
- Modify: `tests/docs/runbook.test.ts`
  - Require the runbook to mention the live matrix smoke and its opt-in posture.
- Modify: `tests/docs/packaging.test.ts`
  - Require README packaging docs to mention the live matrix smoke without making it a CI gate.
- Modify: `README.md`
  - Document the live matrix command, prerequisites, evidence shape, and limitations.
- Modify: `docs/runbooks/claude-team-session.md`
  - Add the capability matrix as the recommended pre-provider-expansion live validation.
- Modify: `CHANGELOG.md`
  - Add an unreleased note for the validation harness once implemented.
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
  - Mark Milestone 47 complete after implementation and verification.

## Success Criteria

- Live matrix refuses to run unless `--dry-run` or `--confirm-live-provider-use` is supplied.
- Live execution requires `policy.liveSmokeEnabled === true`.
- Live execution uses `dist/index.js` through MCP stdio and only public MCP tools.
- The matrix covers:
  - direct read-only `agent_team_dispatch`
  - bounded read-only `agent_team_start_parallel`
  - `agent_team_create_team`, `agent_team_dashboard`, and `agent_team_summary`
  - active `slice-implementer` isolated worktree start
  - mailbox delivery to an active run
  - graceful wind-down of an active run
  - explicit cancellation of an active run
  - retained worktree evidence with changed file list and diff path
  - explicit cleanup of retained implementation worktrees
  - policy failure for a disallowed write root
- Reports include run ids, roles, provider ids, statuses, evidence paths, changed files, cleanup states, and known limitations.
- Reports do not include prompts, secrets, provider session ids, raw provider payloads, process ids, command args, or environment values.
- The harness makes no model-quality, benchmark, ranking, or practical long-context claim.

## Task 1: Add Failing Script And Package Tests

**Files:**
- Modify: `package.json`
- Modify: `tests/package-scripts.test.ts`
- Create: `tests/live-smoke-claude-capability-matrix.test.ts`

- [ ] **Step 1: Add failing package script assertions**

Update `tests/package-scripts.test.ts` to assert:

```ts
expect(packageJson.scripts?.["smoke:claude-live-matrix"]).toBe(
  "node scripts/live-smoke-claude-capability-matrix.mjs"
);
expect(packageJson.scripts?.ci).not.toContain("smoke:claude-live-matrix");
```

- [ ] **Step 2: Add failing live matrix script tests**

Create `tests/live-smoke-claude-capability-matrix.test.ts` with tests that read the script and assert it contains:

```ts
[
  "agent_team_doctor",
  "agent_team_dispatch",
  "agent_team_start_parallel",
  "agent_team_message",
  "agent_team_wind_down",
  "agent_team_cancel",
  "agent_team_status_many",
  "agent_team_create_team",
  "agent_team_dashboard",
  "agent_team_summary",
  "agent_team_cleanup",
  "--confirm-live-provider-use",
  "--dry-run",
  "policy.liveSmokeEnabled",
  "knownLimitations"
]
```

Also assert the script text does not contain `claude ` command execution or provider-internal imports.

- [ ] **Step 3: Run tests to verify red**

Run:

```bash
npm test -- tests/package-scripts.test.ts tests/live-smoke-claude-capability-matrix.test.ts
```

Expected: fail because `smoke:claude-live-matrix` and the script do not exist.

## Task 2: Implement The Dry-Run And Public Tool Flow Skeleton

**Files:**
- Modify: `package.json`
- Create: `scripts/live-smoke-claude-capability-matrix.mjs`

- [ ] **Step 1: Add package script**

Add:

```json
"smoke:claude-live-matrix": "node scripts/live-smoke-claude-capability-matrix.mjs"
```

- [ ] **Step 2: Implement dry-run output**

Create a script with:

```js
const TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_dispatch",
  "agent_team_start_parallel",
  "agent_team_message",
  "agent_team_wind_down",
  "agent_team_cancel",
  "agent_team_status_many",
  "agent_team_create_team",
  "agent_team_dashboard",
  "agent_team_summary",
  "agent_team_cleanup"
];

const KNOWN_LIMITATIONS = [
  "This smoke proves control-plane mechanics only; it makes no provider ranking, benchmark, or model-quality claim.",
  "Live provider use is operator-triggered and is not part of CI.",
  "Implementation changes remain in retained isolated worktrees until Codex reviews and integrates them."
];
```

The script should print a JSON dry-run report when `--dry-run` is present and exit non-zero unless either `--dry-run` or `--confirm-live-provider-use` is supplied.

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm test -- tests/package-scripts.test.ts tests/live-smoke-claude-capability-matrix.test.ts
```

Expected: pass.

## Task 3: Implement Live Matrix Execution

**Files:**
- Modify: `scripts/live-smoke-claude-capability-matrix.mjs`

- [ ] **Step 1: Connect through packaged MCP stdio**

Use `@modelcontextprotocol/sdk/client/index.js` and `@modelcontextprotocol/sdk/client/stdio.js` with:

```js
const runtimePath = join(repoRoot, "dist", "index.js");
const transport = new StdioClientTransport({
  command: "node",
  args: [runtimePath],
  cwd: repoRoot,
  stderr: "pipe"
});
```

- [ ] **Step 2: Add doctor and policy gate**

Call `agent_team_doctor` with the selected `cwd`. Require `doctor.ok === true` and `policy.liveSmokeEnabled === true`.

- [ ] **Step 3: Add read-only proof calls**

Call:

```js
agent_team_dispatch({ role: "planner", provider: "claude-code-cli", task: "Live matrix direct proof only..." })
agent_team_start_parallel({ provider: "claude-code-cli", concurrency: 2, runs: [...] })
```

Poll with `agent_team_status_many` until both read-only runs are terminal.

- [ ] **Step 4: Add isolated implementation proof**

Start a `slice-implementer` task that creates one proof file in the execution worktree and waits for terminal status. Capture `executionCwd`, `changedFiles`, `workspaceStatus`, `workspaceCleanup`, `logPath`, and `transcriptPath`.

- [ ] **Step 5: Add mailbox, wind-down, and cancel proofs**

Start two long-running `slice-implementer` runs with tasks that wait for operator instruction. Use:

```js
agent_team_message({ runId, message: "Please acknowledge this mailbox update and finish with a SHIP verdict." })
agent_team_wind_down({ runId })
agent_team_cancel({ runId })
```

Poll status and report the resulting terminal or requested-control states. If a run retains a worktree, call `agent_team_cleanup({ force: true })`.

- [ ] **Step 6: Add team records and dashboard/summary proof**

Create a team from completed read-only and implementation runs, then call dashboard and summary for that team or explicit run list. Report counts and groups only.

- [ ] **Step 7: Add sanitized report**

Emit one JSON report containing only:

```ts
{
  status,
  liveProviderUse,
  workspaceRoot,
  provider,
  authMode,
  toolFlow,
  directProof,
  runs,
  team,
  dashboard,
  summary,
  cleanup,
  knownLimitations
}
```

Do not emit prompts, provider session ids, raw payloads, env values, endpoints, process ids, or command args.

## Task 4: Add Docs And Runbook Coverage

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [ ] **Step 1: Add failing docs tests**

Update docs tests to require:

```text
npm run smoke:claude-live-matrix
capability matrix
not part of CI
--confirm-live-provider-use
mailbox
wind-down
cancel
cleanup
isolated worktree
no provider ranking
```

- [ ] **Step 2: Run docs tests to verify red**

Run:

```bash
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected: fail until docs are updated.

- [ ] **Step 3: Update docs**

Document the command:

```bash
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:claude-live-matrix -- --confirm-live-provider-use --cwd /absolute/path/to/workspace
```

Explain that it is opt-in, excluded from CI, and validates control-plane behavior rather than provider quality.

- [ ] **Step 4: Mark roadmap status**

Mark Milestone 47 complete only after focused tests, typecheck, full tests, build, packaged smokes, invariant scans, and `npm run ci` pass.

## Verification Plan

Run before integration:

```bash
npm test -- tests/package-scripts.test.ts tests/live-smoke-claude-capability-matrix.test.ts
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

Optional operator-run live proof:

```bash
npm run smoke:claude-live-matrix -- --dry-run --cwd /absolute/path/to/workspace
npm run smoke:claude-live-matrix -- --confirm-live-provider-use --cwd /absolute/path/to/workspace
```

## Self-Review

- Spec coverage: This plan covers live validation before provider expansion, mailbox delivery, wind-down, cancellation, implementation handoff, cleanup, dashboard, summary, and sanitized evidence.
- Placeholder scan: No TODO/TBD placeholders remain.
- Type consistency: Script names, package script names, public MCP tool names, and report fields are consistent across tasks.
