# Agent Team MCP Milestone 39 Durable Team Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional durable team records that group related run ids for easier operator workflows while preserving per-run sidecars as the source of truth.

**Architecture:** M39 introduces a small provider-neutral team record store under `.agent-team/teams/` plus MCP tools to create, read, and list team records. Team records contain correlation/index metadata only: team id, optional display metadata, workspace/run refs, timestamps, and the team record evidence path. They do not copy run status, verdicts, mailbox data, provider prompts, command details, or cleanup state; callers still use existing per-run status, summary, message, wind-down, cancel, and cleanup tools for lifecycle behavior.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP SDK metadata, existing atomic JSON helpers, durable `.agent-team/` state, no live provider calls.

---

## Scope

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/state/paths.ts`
- Create: `src/core/state/team-store.ts`
- Create: `src/core/team-records.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts` if server registration tests require explicit expected order changes only
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Create: `tests/core/state/team-store.test.ts`
- Create: `tests/core/team-records.test.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `tests/package-runtime.test.ts`
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-39.md`

**Non-goals:**

- Do not add team-id variants of status, summary, message, wind-down, cancel, or cleanup in M39.
- Do not make `agent_team_start_parallel` create team records implicitly.
- Do not copy mutable run state into team records.
- Do not expose internal prompts, provider command details, process ids, provider-specific schemas, or secrets.
- Do not add provider adapters, live provider smoke, model-quality claims, benchmark claims, or automatic provider comparison.
- Do not delete, mutate, cancel, wind down, message, or clean up any run from team record tools.
- Do not make team records the source of truth for lifecycle state.

## Team Record Contract

Team records live at:

```text
.agent-team/teams/<teamId>.json
```

Record shape:

```ts
export interface AgentTeamRunRef {
  readonly runId: string;
  readonly cwd: string;
  readonly correlationId?: string;
}

export interface AgentTeamRecord {
  readonly teamId: string;
  readonly name?: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runs: readonly AgentTeamRunRef[];
  readonly evidencePath: string;
}
```

MCP tools:

- `agent_team_create_team`
  - Input: `{ runs: [{ runId, cwd?, correlationId? }], cwd?, name?, description? }`
  - Behavior: validates all run refs, verifies each referenced run sidecar exists before writing, rejects duplicate `{cwd, runId}` refs, writes one atomic team record, and returns the record.
- `agent_team_get_team`
  - Input: `{ teamId, cwd? }`
  - Behavior: reads one team record and returns it.
- `agent_team_list_teams`
  - Input: `{ cwd? }`
  - Behavior: lists team records for a workspace in deterministic created-time then team-id order.

The returned `runs` array is intentionally shaped so callers can pass it directly into existing `agent_team_status_many`, `agent_team_summary`, `agent_team_message_many`, `agent_team_wind_down_many`, or `agent_team_cancel_many` after adding any tool-specific fields such as messages.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for new behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Input validation: missing required fields, empty strings, non-object run refs, duplicate run refs, invalid cwd/name/description/correlation fields.
- MCP handlers: validation returns `validation_error` before state writes; unknown tools remain explicit; injected dependencies are not called on invalid input.
- State stores: atomic writes, deterministic list order, corrupt JSON surfaced as `StateCorruptionError`, no hidden repair.
- Corruption recovery: MCP team tools surface recovery through the shared recovery path when team record or referenced run sidecar JSON is corrupt.
- Documentation: public docs explain team records without depending on chat history or exposing internal prompts.
- Boundary scan: fallback, bypass, benchmark/model-quality, provider-specific schema, cleanup, and process-kill shortcuts are reviewed.

Live provider smoke is not required for M39 because durable team records are local state metadata only. Fixture state tests and packaged MCP smoke prove mechanics without invoking any provider or making provider-quality claims.

## Success Criteria

- `.agent-team/teams/<teamId>.json` records are written atomically and read back through a focused team store.
- Team ids are generated with a stable `team_` prefix and never collide with run ids.
- Team records contain only grouping metadata and evidence path; they do not copy run statuses, verdicts, mailbox records, provider internals, prompts, or cleanup decisions.
- `agent_team_create_team` validates all referenced runs before writing the team record.
- Duplicate run refs are rejected before side effects.
- Corrupt referenced run sidecars and corrupt team records return shared `state_corrupt` recovery evidence in MCP tools.
- `agent_team_get_team` reads one team record without touching run sidecars or invoking lifecycle/provider code.
- `agent_team_list_teams` returns deterministic summaries without invoking lifecycle/provider code.
- MCP metadata, server registration tests, package runtime tests, and packaged stdio smoke include the new tools.
- Existing batch tools are not changed to accept team ids in M39.
- README, runbook, changelog if needed, and roadmap describe team records as optional grouping metadata.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Red Tests For Store And Core Team Record Creation

**Files:**

- Create: `tests/core/state/team-store.test.ts`
- Create: `tests/core/team-records.test.ts`
- Modify: `src/core/types.ts`

- [ ] **Step 1: Write failing team store tests**

Add tests proving:

- `writeTeamRecord()` writes `.agent-team/teams/<teamId>.json` atomically and `readTeamRecord()` reads it back.
- `listTeamRecords()` returns records sorted by `createdAt`, then `teamId`.
- corrupt team JSON throws `StateCorruptionError` with `kind: "json"` and the corrupt path.
- `teamRecordPath(workspace, teamId)` points under `.agent-team/teams/`.

Run:

```bash
npm test -- tests/core/state/team-store.test.ts
```

Expected red: team store helpers and team path helpers do not exist yet.

- [ ] **Step 2: Write failing core team-record tests**

Add tests proving:

- `createAgentTeamRecord()` verifies every referenced run sidecar before writing.
- duplicate `{cwd, runId}` refs are rejected before writes.
- record output keeps caller order and preserves per-run `correlationId`.
- generated ids start with `team_`.
- team record creation does not call lifecycle, provider, mailbox, cleanup, or summary helpers.

Run:

```bash
npm test -- tests/core/team-records.test.ts
```

Expected red: core team-record creation module and types do not exist yet.

## Task 2: Implement Durable Team Record Store And Core Creation

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/state/paths.ts`
- Create: `src/core/state/team-store.ts`
- Create: `src/core/team-records.ts`

- [ ] **Step 1: Add team record types**

Add `AgentTeamRunRef`, `AgentTeamRecord`, `AgentTeamCreateRequest`, `AgentTeamCreateResult`, `AgentTeamGetRequest`, and `AgentTeamListResult` to `src/core/types.ts`.

- [ ] **Step 2: Add team state paths**

Add:

```ts
export function teamsDir(workspaceRoot: string): string;
export function teamRecordPath(workspaceRoot: string, teamId: string): string;
```

Use `.agent-team/teams/<teamId>.json`.

- [ ] **Step 3: Implement team store**

Implement:

```ts
export async function writeTeamRecord(workspaceRoot: string, record: AgentTeamRecord): Promise<void>;
export async function readTeamRecord(workspaceRoot: string, teamId: string): Promise<AgentTeamRecord>;
export async function listTeamRecords(workspaceRoot: string): Promise<readonly AgentTeamRecord[]>;
```

Use `writeJsonAtomic()` and `readJsonFile()`. When the teams directory is absent, `listTeamRecords()` returns `[]`.

Run:

```bash
npm test -- tests/core/state/team-store.test.ts
```

- [ ] **Step 4: Implement core create/get/list helpers**

Implement `src/core/team-records.ts` with:

- `createAgentTeamRecord(request, deps)`
- `getAgentTeamRecord(request, deps)`
- `listAgentTeamRecords(workspaceRoot, deps)`

`createAgentTeamRecord()` must read every referenced run sidecar first, reject duplicates before writes, then write exactly one record.

Run:

```bash
npm test -- tests/core/team-records.test.ts
```

## Task 3: Add MCP Tools And Contract Tests

**Files:**

- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `tests/mcp/server.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`
- Modify: `tests/package-runtime.test.ts`

- [ ] **Step 1: Write failing MCP metadata and validation tests**

Add tests proving:

- `listToolNames()` includes `agent_team_create_team`, `agent_team_get_team`, and `agent_team_list_teams` in the tool list after `agent_team_summary`.
- tool metadata includes provider-neutral titles/descriptions and schemas.
- create validation rejects empty runs, non-object runs, empty run ids, invalid cwd, duplicate run refs, empty name, and empty description before state writes.
- get validation rejects missing/empty `teamId`.
- list validation rejects non-string `cwd`.
- public schemas do not add provider-specific fields.

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

Expected red: tools, schemas, parser, and server metadata do not exist yet.

- [ ] **Step 2: Implement MCP schemas and handlers**

Add parsers and handlers that delegate to `createAgentTeamRecord()`, `getAgentTeamRecord()`, and `listAgentTeamRecords()`.

State corruption from referenced run sidecars or team records must be converted through `recoverStateCorruption()` with operation name matching the MCP tool.

Run:

```bash
npm test -- tests/mcp/tools.test.ts tests/mcp/server.test.ts
```

- [ ] **Step 3: Update package smoke**

Update `scripts/smoke-mcp-stdio.mjs` and `tests/package-runtime.test.ts` so packaged stdio smoke requires the three team tools and their required fields.

Run:

```bash
npm test -- tests/package-runtime.test.ts
npm run build
npm run smoke:mcp-stdio
```

## Task 4: Docs, Roadmap, And Verification

**Files:**

- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-39.md`

- [ ] **Step 1: Update user-facing docs**

Document:

- team records are optional durable grouping metadata
- per-run sidecars remain source of truth
- create a team after `agent_team_start_parallel`
- use returned `runs` refs with existing status/summary/message/wind-down/cancel tools
- cleanup remains per-run and explicit
- team tools do not invoke providers or lifecycle control actions

- [ ] **Step 2: Update roadmap**

Mark M39 complete only after proof is captured and move near-term recommendation to M40/M41/M42.

- [ ] **Step 3: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/state/team-store.test.ts tests/core/team-records.test.ts tests/mcp/tools.test.ts tests/mcp/server.test.ts tests/package-runtime.test.ts tests/docs/runbook.test.ts tests/docs/packaging.test.ts
```

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

- [ ] **Step 5: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode|routing|rolePins|providerOrder|family:|model:|capability:" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison|ranking" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema" src tests docs README.md CHANGELOG.md
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|teamId|agent_team_.*team" src tests docs README.md CHANGELOG.md
```

- [ ] **Step 6: Mark plan complete and commit**

After all proof is captured, mark the L11 gates and task checkboxes complete in this plan, then commit the implementation branch.

## Verification Evidence

- Baseline before implementation: pending.
- Red proof: pending.
- Focused milestone proof: pending.
- Full proof: pending.
- Packaged stdio smoke: pending.
- Invariant scans: pending.
