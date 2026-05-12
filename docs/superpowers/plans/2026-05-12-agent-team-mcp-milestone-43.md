# Agent Team MCP Milestone 43 Opt-In Live Claude Team Smoke Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable operator-run live smoke harness that exercises the Claude Code CLI subscription-backed team path through the packaged MCP boundary while keeping CI fixture-safe.

**Architecture:** M43 adds one script-level live harness and docs/tests around it; it does not add a new MCP tool or provider adapter. The script starts `node ./dist/index.js` through `StdioClientTransport`, calls public MCP tools in the same order an operator would use them, and emits a sanitized report. Live execution is guarded by an explicit CLI flag and workspace `policy.liveSmokeEnabled`; fixture tests use dry-run and text checks only.

**Tech Stack:** TypeScript project, Node.js ESM script, MCP SDK client, existing packaged `dist/index.js`, Vitest, existing docs tests, existing package script tests, L11 invariant scans.

---

## Scope

**Create:**

- `src/core/live-smoke.ts`
- `tests/core/live-smoke.test.ts`
- `scripts/live-smoke-claude-team.mjs`
- `tests/live-smoke-claude-team.test.ts`

**Modify:**

- `package.json`
- `tests/package-scripts.test.ts`
- `tests/docs/packaging.test.ts`
- `tests/docs/runbook.test.ts`
- `README.md`
- `CHANGELOG.md`
- `docs/runbooks/claude-team-session.md`
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-43.md`

## Non-Goals

- Do not add live provider smoke to `npm run ci`.
- Do not bypass MCP by importing provider runtimes or lifecycle internals.
- Do not add API-key fallback or infer credentials from provider-specific environment values.
- Do not make model-quality, benchmark, ranking, long-context, or provider-comparison claims.
- Do not start write-capable `slice-implementer` runs in the live smoke.
- Do not include prompts, provider session ids, secrets, command args, process ids, raw mailbox payloads, or environment values in the report.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for live-smoke opt-in guards, package script exclusion from CI, dry-run output, and docs.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases selected: docs/examples, packaged runtime, auth posture, public MCP boundary, report redaction, and live-smoke policy gating.
- [x] Invariant scans are listed.
- [x] Live provider smoke is not run in CI; the new command is itself an operator-run live smoke harness and is marked opt-in.

## Contracts

### Package Script

Add this script:

```json
{
  "scripts": {
    "smoke:claude-live": "node scripts/live-smoke-claude-team.mjs"
  }
}
```

Do not add it to `npm run ci`.

### CLI Guard

The command must fail before MCP connection unless either `--dry-run` is provided or all live conditions are true:

- `--confirm-live-provider-use`
- built runtime exists at `dist/index.js`
- `agent_team_doctor` returns ok
- doctor policy details include `liveSmokeEnabled: true`

### MCP Flow

When live confirmation is present, call public MCP tools only:

1. `agent_team_doctor`
2. `agent_team_start_parallel` with read-only `planner` and `code-reviewer` roles, provider `claude-code-cli`, bounded concurrency `2`, and short operator-facing tasks
3. `agent_team_status_many`
4. `agent_team_dashboard`
5. `agent_team_summary`
6. `agent_team_message_many`
7. `agent_team_wind_down_many`
8. final `agent_team_status_many`

### Sanitized Report

The report must include:

- `status`
- `workspaceRoot`
- `provider: "claude-code-cli"`
- `authMode: "subscription-oauth"`
- `toolFlow`
- per-run `runId`, `role`, `correlationId`, `status`, `verdict`, and evidence paths
- `dashboard` counts or state groups
- `knownLimitations`

The report must not include prompt text, task text, provider session ids, raw mailbox payloads, secrets, command args, process ids, or environment values.

## Task 1: Red Tests For Package Script And Opt-In Guard

**Files:**

- Create: `tests/live-smoke-claude-team.test.ts`
- Modify: `tests/package-scripts.test.ts`

- [x] **Step 1: Add failing tests**

Add tests proving:

```ts
expect(packageJson.scripts?.["smoke:claude-live"]).toBe(
  "node scripts/live-smoke-claude-team.mjs"
);
expect(packageJson.scripts?.ci).not.toContain("smoke:claude-live");
```

Add a subprocess test:

```ts
const result = spawnSync("node", ["scripts/live-smoke-claude-team.mjs"], {
  cwd: repoRoot,
  encoding: "utf8"
});
expect(result.status).toBe(1);
expect(result.stderr).toContain("--confirm-live-provider-use");
expect(result.stderr).toContain("--dry-run");
```

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/live-smoke-claude-team.test.ts tests/package-scripts.test.ts
```

Expected red: script and package command do not exist.

- [x] **Step 3: Implement minimal guard**

Create `scripts/live-smoke-claude-team.mjs` with argument parsing, `--dry-run`, `--cwd`, and `--confirm-live-provider-use`. Without dry-run or confirmation, print a concise error to stderr and exit with code `1`.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/live-smoke-claude-team.test.ts tests/package-scripts.test.ts
```

Expected green: package script exists, CI excludes it, and unconfirmed execution fails before live work.

## Task 2: Core Live-Smoke Plan And Redaction Contract

**Files:**

- Create: `src/core/live-smoke.ts`
- Create: `tests/core/live-smoke.test.ts`
- Modify: `scripts/live-smoke-claude-team.mjs`
- Modify: `tests/live-smoke-claude-team.test.ts`

- [x] **Step 1: Add failing core tests**

Add tests proving `buildClaudeLiveSmokeDryRunReport({ workspaceRoot })` returns:

- `status: "dry_run"`
- `liveProviderUse: false`
- `provider: "claude-code-cli"`
- `authMode: "subscription-oauth"`
- the exact public MCP `toolFlow`
- `requiredConfirmation: "--confirm-live-provider-use"`
- `policyRequirement: "policy.liveSmokeEnabled must be true"`
- two read-only planned roles: `planner` and `code-reviewer`
- no `slice-implementer`

Assert serialized output does not match:

```ts
/prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
```

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/core/live-smoke.test.ts
```

Expected red: core live-smoke planner does not exist.

- [x] **Step 3: Implement core planner**

Create `src/core/live-smoke.ts` with constants for provider/auth mode/tool flow, planned read-only roles, policy requirement, known limitations, and a `buildClaudeLiveSmokeDryRunReport` function. Keep it pure and provider-neutral at the orchestration boundary; Claude-specific values are report metadata for this concrete harness, not MCP schema.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/core/live-smoke.test.ts
```

Expected green: core dry-run report is parseable and sanitized.

## Task 3: Script Dry-Run And Opt-In Report

**Files:**

- Modify: `scripts/live-smoke-claude-team.mjs`
- Modify: `tests/live-smoke-claude-team.test.ts`

- [x] **Step 1: Add failing dry-run script tests**

Add a test that runs:

```bash
node scripts/live-smoke-claude-team.mjs --dry-run --cwd /tmp/agent-team-live-smoke
```

Assert the JSON report contains:

- `status: "dry_run"`
- `liveProviderUse: false`
- `toolFlow` exactly listing the public tools in the M43 flow
- `requiredConfirmation: "--confirm-live-provider-use"`
- `policyRequirement: "policy.liveSmokeEnabled must be true"`

Assert serialized output does not match:

```ts
/prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
```

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/live-smoke-claude-team.test.ts
```

Expected red: dry-run JSON does not exist yet.

- [x] **Step 3: Implement dry-run JSON**

Make the script import the built or source-compatible core report contract through a small local copy of the report constants if direct TypeScript imports are unavailable at script runtime. The runtime script must emit the same sanitized report shape as `src/core/live-smoke.ts` and must not connect to MCP in `--dry-run`.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/live-smoke-claude-team.test.ts
```

Expected green: dry-run report is parseable and sanitized.

## Task 4: Live MCP Harness Implementation

**Files:**

- Modify: `scripts/live-smoke-claude-team.mjs`
- Modify: `tests/live-smoke-claude-team.test.ts`

- [x] **Step 1: Add failing script-shape tests**

Add text-level assertions that the script:

- imports `Client` and `StdioClientTransport`
- uses `join(repoRoot, "dist", "index.js")`
- calls `agent_team_doctor`
- calls `agent_team_start_parallel`
- calls `agent_team_status_many`
- calls `agent_team_dashboard`
- calls `agent_team_summary`
- calls `agent_team_message_many`
- calls `agent_team_wind_down_many`
- checks `liveSmokeEnabled`
- does not contain `runClaudePrint`, `startClaudeBackgroundSession`, `requireProviderRuntime`, or `createDefaultLifecycleRegistry`

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/live-smoke-claude-team.test.ts
```

Expected red: script does not call the public MCP flow yet.

- [x] **Step 3: Implement live MCP flow**

Implement the confirmed path using `StdioClientTransport({ command: "node", args: [runtimePath], cwd: repoRoot })`. Use a small read-only team:

```js
runs: [
  {
    role: "planner",
    task: "Live smoke only: confirm the workspace can be inspected and return a concise SHIP/BLOCK/NEEDS_INPUT verdict without editing files.",
    provider: "claude-code-cli",
    correlationId: "live-planner"
  },
  {
    role: "code-reviewer",
    task: "Live smoke only: review no files in depth; confirm the provider path can return a concise SHIP/BLOCK/NEEDS_INPUT verdict without editing files.",
    provider: "claude-code-cli",
    correlationId: "live-reviewer"
  }
]
```

Use `timeoutMs` from `--timeout-ms` with a conservative default of `120000`, `concurrency: 2`, and status polling bounded by `--max-wait-ms`.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/live-smoke-claude-team.test.ts
```

Expected green: script shape proves packaged MCP boundary and public tool flow.

## Task 5: Docs And Runbook

**Files:**

- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [x] **Step 1: Add failing docs tests**

Require docs to mention:

- `npm run smoke:claude-live`
- `--confirm-live-provider-use`
- `policy.liveSmokeEnabled`
- `not part of CI`
- `sanitized report`
- `Claude Code CLI subscription OAuth`

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected red: docs do not describe the M43 live harness.

- [x] **Step 3: Update docs**

Add concise operator instructions showing:

```bash
npm run build
npm run smoke:claude-live -- --dry-run --cwd /absolute/workspace
npm run smoke:claude-live -- --confirm-live-provider-use --cwd /absolute/workspace
```

Document that `.agent-team/config.json` must set:

```json
{
  "policy": {
    "liveSmokeEnabled": true
  }
}
```

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected green: docs explain opt-in live smoke without making provider-quality claims.

## Task 6: Verification, Evidence, And Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-43.md`

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/core/live-smoke.test.ts tests/live-smoke-claude-team.test.ts tests/package-scripts.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

- [x] **Step 3: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|subscription OAuth|authMode|smoke:claude-live" src tests docs README.md CHANGELOG.md package.json scripts
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core scripts
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison|ranking" src tests docs README.md CHANGELOG.md scripts
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema|promptHash|providerSessionId|payload|secret|process id|command args|migration payload" src tests docs README.md CHANGELOG.md scripts
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|auto-migrate|auto migrate|state-layout" src tests docs README.md CHANGELOG.md scripts
```

- [x] **Step 4: Update verification evidence**

Record red proof, focused proof, full proof, packaged smoke, and invariant scan interpretation in this plan.

- [x] **Step 5: Commit implementation**

Run:

```bash
git diff --check
git status --short
git add scripts tests package.json README.md CHANGELOG.md docs
git commit -m "feat: add opt-in live Claude team smoke harness"
```

## Verification Evidence

- Baseline before implementation: `npm test` passed with 53 test files and 423 tests before M43 implementation work.
- Red proof:
  - `npm test -- tests/live-smoke-claude-team.test.ts tests/package-scripts.test.ts` failed before the package script and guard script existed.
  - `npm test -- tests/core/live-smoke.test.ts` failed before `src/core/live-smoke.ts` existed.
  - `npm test -- tests/live-smoke-claude-team.test.ts` failed before dry-run JSON, public MCP client wiring, and bounded `--max-wait-ms` status polling existed.
  - `npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts` failed before README/runbook/changelog documented the opt-in live smoke.
- Focused milestone proof: `npm test -- tests/core/live-smoke.test.ts tests/live-smoke-claude-team.test.ts tests/package-scripts.test.ts tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` passed with 6 files and 15 tests.
- Full proof:
  - `npm run typecheck` passed.
  - `npm test` passed with 55 test files and 428 tests.
  - `npm run build` passed.
  - `npm run ci` passed; it ran typecheck, all 428 tests, build, packaged stdio smoke, and package dry-run smoke.
- Packaged smoke:
  - `npm run smoke:mcp-stdio` passed with `MCP stdio smoke passed.`
  - `npm run smoke:package` passed with `Package smoke passed.`
  - `npm run smoke:claude-live -- --dry-run --cwd /tmp` passed and emitted `liveProviderUse: false`, `provider: "claude-code-cli"`, `authMode: "subscription-oauth"`, the public tool flow, the confirmation flag, the policy requirement, read-only planned roles, and sanitized limitations.
  - `node scripts/live-smoke-claude-team.mjs` exited `1` with the fail-closed confirmation/dry-run guidance.
- Invariant scans: auth/fallback, permission/bypass, model-claim, prompt/schema leakage, and cleanup/process scans were run. Matches were expected historical guardrails, tests, docs, provider-local internals, and pre-existing cleanup/process behavior. M43 introduced no API-key fallback, no bypass-permission path, no public provider-specific MCP schema, no prompt/session/payload leakage in the live-smoke report, no unsupported provider-ranking claim, no live provider use in CI, no automatic cleanup shortcut, and no process-kill shortcut.
- Subagent review: Hooke reviewed the diff read-only and found no blocking issues around public MCP/schema leakage, opt-in live execution, package allowlist, provider-neutral boundaries, or unsupported claim surfaces.
