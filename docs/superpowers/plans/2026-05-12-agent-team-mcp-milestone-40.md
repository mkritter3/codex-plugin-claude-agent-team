# Agent Team MCP Milestone 40 Team Dashboard Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact read-only MCP dashboard/report surface for an agent team so Codex can inspect team health, waiting work, latest activity, evidence, retained worktrees, and cleanup status in one operator-friendly call.

**Architecture:** M40 adds `agent_team_dashboard`, a provider-neutral read-only MCP tool over the existing durable state readers. The dashboard accepts either a durable `teamId` or explicit run refs, resolves team records when needed, delegates per-run inspection to the existing summary pipeline, and formats a compact structured dashboard plus a text report without calling providers or lifecycle control actions. It does not mutate sidecars, mailboxes, worktrees, cleanup state, provider sessions, or prompts.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP SDK metadata, existing `.agent-team/` sidecars/team records/mailboxes, existing `summarizeAgentTeam()` evidence reader, no live provider calls.

---

## Scope

**Files:**

- Modify: `src/core/types.ts`
- Create: `src/core/team-dashboard.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Create: `tests/core/team-dashboard.test.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `tests/package-runtime.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-40.md`

**Non-goals:**

- Do not add a browser UI, TUI, local web server, or daemon.
- Do not add write/control buttons or tool behavior that messages, replies, cancels, winds down, cleans up, resumes, starts, or deletes runs.
- Do not make dashboard output a model-quality, benchmark, ranking, or provider-comparison surface.
- Do not expose internal prompt text, prompt hashes, generated agent definitions, provider command details, provider session ids, raw payloads, process ids, or secrets.
- Do not copy mutable run state into team records or make team records lifecycle-authoritative.
- Do not add provider adapters, live provider smoke, or API-key fallback.
- Do not change existing batch tool semantics.

## Dashboard Contract

MCP tool:

- `agent_team_dashboard`
  - Input: `{ teamId?: string, runs?: [{ runId, cwd?, correlationId? }], cwd?, concurrency? }`
  - Behavior:
    - Requires exactly one source: either `teamId` or non-empty `runs`.
    - When `teamId` is provided, reads the team record from `cwd` and uses its ordered `runs` refs.
    - When `runs` is provided, top-level `cwd` defaults into child refs.
    - Delegates state inspection to `summarizeAgentTeam()` with bounded concurrency.
    - Preserves ordered per-run results, partial failures, and state-corruption recovery evidence from summary.
    - Returns a dashboard object plus a compact text report.

Suggested output shape:

```ts
export interface AgentTeamDashboardRequest {
  readonly cwd: string;
  readonly teamId?: string;
  readonly runs?: readonly AgentTeamSummaryRunRequest[];
  readonly concurrency: number;
}

export interface AgentTeamDashboardCounts {
  readonly total: number;
  readonly running: number;
  readonly awaitingInput: number;
  readonly windingDown: number;
  readonly terminal: number;
  readonly failed: number;
  readonly detached: number;
  readonly cleanupBlocked: number;
  readonly retainedWorktree: number;
  readonly recovered: number;
}

export interface AgentTeamDashboardRow {
  readonly index: number;
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
  readonly status: "ok" | "failed" | "state_corrupt";
  readonly role?: RoleId;
  readonly provider?: string;
  readonly runStatus?: RunStatus;
  readonly operationalState?: AgentTeamSummaryOperationalState;
  readonly updatedAt?: string;
  readonly awaitingInputSince?: string;
  readonly latestActivity?: string;
  readonly pendingQuestion?: boolean;
  readonly retainedWorktree?: boolean;
  readonly cleanupBlocked?: boolean;
  readonly cleanupStatus?: "retained" | "removed" | "not_applicable";
  readonly evidencePaths?: readonly string[];
  readonly mailboxPaths?: readonly string[];
  readonly workspaceDiffPath?: string;
  readonly changedFiles?: readonly string[];
  readonly error?: string;
  readonly recovery?: unknown;
}

export interface AgentTeamDashboardResult {
  readonly status: "ok" | "partial_failure";
  readonly source: { readonly kind: "team"; readonly teamId: string; readonly evidencePath: string } | { readonly kind: "runs" };
  readonly generatedAt: string;
  readonly counts: AgentTeamDashboardCounts;
  readonly rows: readonly AgentTeamDashboardRow[];
  readonly report: string;
  readonly summary: AgentTeamSummaryResult;
}
```

`report` is for humans and should be deterministic, compact, and evidence-oriented, for example:

```text
Team team_20260512: 2 runs, 1 running, 1 awaiting input, 1 retained worktree.
[0] run_a planner running updated 2026-05-12T10:00:00.000Z evidence sidecar=/repo/.agent-team/runs/run_a.json log=/repo/.agent-team/logs/run_a.log
[1] run_b code-reviewer awaiting-input question=true updated 2026-05-12T10:01:00.000Z evidence sidecar=/repo/.agent-team/runs/run_b.json
```

The report must not include internal prompts, prompt hashes, provider session ids, hidden instructions, raw mailbox payloads, or provider-specific command details.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for new behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Input validation: missing both `teamId` and `runs`, both sources present, empty strings, non-object children, invalid safe ids, invalid cwd, invalid concurrency, invalid correlation id.
- MCP handlers: validation returns `validation_error` before state reads; unknown tools remain explicit; injected dependencies are not called on invalid input.
- State stores: team record reads remain strict; corrupt team JSON surfaces through shared recovery in the dashboard tool.
- Corruption recovery: corrupt team record or per-run sidecar/mailbox produces `state_corrupt` evidence without hiding later runs.
- Documentation: user docs explain the dashboard as read-only operator visibility and do not expose internal prompts.
- Boundary scan: fallback, bypass, benchmark/model-quality, provider-specific schema, prompt leakage, cleanup, process-kill, and dashboard/control shortcuts are reviewed.

Live provider smoke is not required for M40 because the dashboard is a local read-only state/reporting surface. Fixture sidecar, mailbox, and team-record tests prove mechanics without invoking any provider or making provider-quality claims.

## Success Criteria

- `agent_team_dashboard` appears in tool names, MCP metadata, server registration tests, package runtime tests, and packaged stdio smoke.
- Dashboard input accepts exactly one source: `teamId` or explicit `runs`.
- `teamId` uses the existing safe `team_` id validation and reads strict team records.
- Explicit `runs` uses safe `run_` ids and top-level `cwd` defaulting.
- Dashboard delegates per-run state/evidence inspection to `summarizeAgentTeam()` or a shared helper rather than duplicating sidecar/mailbox readers.
- Results preserve input order, per-run addressability, bounded concurrency, partial failures, and recovery evidence.
- Dashboard rows show run state, awaiting-input signal, latest activity summary, evidence paths, retained worktree status, cleanup status, and changed files where present.
- The text report is deterministic and compact.
- Public output does not include prompt hashes, provider session ids, internal prompt text, hidden instructions, provider commands, raw mailbox payloads, process ids, or secrets.
- The tool is read-only and does not invoke lifecycle control, provider runtime, cleanup, git mutation, message, reply, wind-down, cancel, start, or resume actions.
- README, runbook, changelog, and roadmap describe the dashboard as read-only operator visibility.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Red Tests For Core Dashboard Projection

**Files:**

- Create: `tests/core/team-dashboard.test.ts`
- Modify: `src/core/types.ts`

- [ ] **Step 1: Write failing dashboard projection tests**

Add tests proving:

- `buildAgentTeamDashboard()` turns an existing `AgentTeamSummaryResult` into counts, rows, and deterministic report text.
- Awaiting-input runs set `pendingQuestion: true` and include `awaitingInputSince`.
- Latest activity prefers `currentActivity.summary`, then newest `recentActivities[].summary`, then `outputSummary`/verdict summary if represented by summary evidence.
- Evidence paths include sidecar, log, transcript, workspace diff, extra evidence paths, and mailbox paths, but not raw mailbox payloads.
- Rows never expose `promptHash` or `providerSessionId`.
- Failed and recovered summary items remain ordered rows and contribute to `failed`/`recovered` counts.

Run:

```bash
npm test -- tests/core/team-dashboard.test.ts
```

Expected red: `src/core/team-dashboard.ts` and dashboard types do not exist yet.

## Task 2: Implement Core Dashboard Builder

**Files:**

- Modify: `src/core/types.ts`
- Create: `src/core/team-dashboard.ts`

- [ ] **Step 1: Add dashboard types**

Add `AgentTeamDashboardRequest`, `AgentTeamDashboardSource`, `AgentTeamDashboardCounts`, `AgentTeamDashboardRow`, and `AgentTeamDashboardResult` to `src/core/types.ts`.

- [ ] **Step 2: Implement dashboard projection**

Create `src/core/team-dashboard.ts` with:

```ts
export function buildAgentTeamDashboard(input: {
  readonly source: AgentTeamDashboardSource;
  readonly summary: AgentTeamSummaryResult;
  readonly generatedAt: string;
}): AgentTeamDashboardResult;
```

Implementation rules:

- Build counts from summary groups and result item statuses.
- Preserve `summary.runs` order exactly.
- Use only already-sanitized summary fields.
- Collect evidence pointers only: sidecar/log/transcript/workspace diff/evidence/mailbox paths/changed files.
- Derive `cleanupStatus` as `removed`, `retained`, or `not_applicable`.
- Produce deterministic report lines.

Run:

```bash
npm test -- tests/core/team-dashboard.test.ts
```

Expected green: core dashboard projection tests pass.

## Task 3: Add MCP Dashboard Tool With Team Record Resolution

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add tests proving:

- `listToolNames()` includes `agent_team_dashboard` after `agent_team_list_teams`.
- MCP metadata has provider-neutral title/description and input schema.
- Validation rejects missing both sources, both `teamId` and `runs`, invalid safe ids, empty run arrays, non-object run refs, invalid cwd, invalid concurrency, and invalid correlation ids before durable reads.
- With `teamId`, handler reads one team record and uses its `runs` refs.
- With explicit `runs`, handler does not read team records.
- Handler delegates state inspection through `summarizeAgentTeam()` dependencies or the shared summary helper, preserving recovery and partial failures.
- Invalid inputs do not call lifecycle/provider/control dependencies.
- Public metadata does not add provider-specific schema fields or prompt fields.

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected red: `agent_team_dashboard` tool, schema, parser, and handler do not exist.

- [ ] **Step 2: Implement schemas and handler**

Add `dashboardInputSchema` and metadata in `src/mcp/schemas.ts`.

In `src/mcp/tools.ts`, add parsing and handler logic:

- Parse exactly one source.
- Reuse safe `team_` and `run_` id validators.
- Use default concurrency bounds from existing summary/status tools.
- For `teamId`, call `getAgentTeamRecord()` and map its `runs` to summary run refs.
- Call `summarizeAgentTeam()` with existing state readers and recovery wrapper.
- Call `buildAgentTeamDashboard()`.
- Wrap `StateCorruptionError` through `recoverStateCorruption()` with operation `agent_team_dashboard`.
- Do not call lifecycle control, provider runtime, cleanup, message, reply, cancel, wind-down, or start paths.

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected green: MCP dashboard contract and registration tests pass.

## Task 4: Package Smoke And Docs

**Files:**

- Modify: `scripts/smoke-mcp-stdio.mjs`
- Modify: `tests/package-runtime.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-40.md`

- [ ] **Step 1: Write/update failing package and docs tests**

Add test expectations proving:

- packaged stdio smoke asserts `agent_team_dashboard`.
- README lists dashboard in the basic workflow and describes it as read-only.
- runbook shows dashboard usage after team record creation and before control actions.
- docs do not describe dashboard as a control surface or model-quality report.

Run:

```bash
npm test -- tests/package-runtime.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts
```

Expected red: package smoke and docs do not mention `agent_team_dashboard` yet.

- [ ] **Step 2: Update package smoke and docs**

Update docs to say:

- dashboard is read-only operator visibility.
- team records remain grouping metadata.
- per-run sidecars remain lifecycle source of truth.
- control actions still use explicit message/reply/wind-down/cancel/cleanup tools.
- live provider smoke is not required for dashboard mechanics.

Run:

```bash
npm test -- tests/package-runtime.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts
```

Expected green: package/docs tests pass.

## Task 5: Verification, Roadmap, And Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-40.md`

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/team-dashboard.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

- [ ] **Step 3: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode|routing|rolePins|providerOrder|family:|model:|capability:" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison|ranking" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema|promptHash|providerSessionId" src tests docs README.md CHANGELOG.md
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|agent_team_dashboard|dashboard.*cancel|dashboard.*wind_down|dashboard.*cleanup" src tests docs README.md CHANGELOG.md
```

- [ ] **Step 4: Mark milestone complete**

Update this plan with verification evidence and mark checkboxes complete only after proof is captured.

Update roadmap:

- Change current baseline to completed through Milestone 40.
- Add dashboard to baseline.
- Add M40 status: complete, read-only, evidence-oriented.
- Move near-term recommendation to M41/M42 plus the next scoped milestone if present.

- [ ] **Step 5: Commit implementation branch**

Run:

```bash
git diff --check
git status --short
git add src/core/types.ts src/core/team-dashboard.ts src/mcp/schemas.ts src/mcp/tools.ts scripts/smoke-mcp-stdio.mjs tests/core/team-dashboard.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts README.md docs/runbooks/claude-team-session.md CHANGELOG.md docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-40.md
git commit -m "feat: add team dashboard report"
```

## Verification Evidence

- Baseline before implementation: pending.
- Red proof: pending.
- Focused milestone proof: pending.
- Full proof: pending.
- Packaged stdio smoke: pending.
- Invariant scans: pending.
