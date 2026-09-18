# Agent Team MCP Milestone 46 Real Claude Call Reliability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the real Claude Code CLI subscription-backed path so operator live smoke reports only true terminal success, uses MCP request timeouts that match provider timeouts, preserves cleanup/cancellation evidence on failures, and proves at least one real Claude call can be reached through the packaged MCP boundary without internal-provider shortcuts.

**Architecture:** M46 stays above the existing MCP product boundary. It hardens the opt-in live Claude harness and supporting script utilities while leaving provider routing, lifecycle ownership, public MCP schemas, and core sidecar formats intact. The implementation borrows proven lifecycle patterns from `third-party-projects/the-clawd-code/src`: terminal-state predicates exclude nonterminal wind-down states, task-output polling returns timeout/not-ready instead of success, and cancellation/cleanup is evidence-preserving rather than destructive.

**Tech Stack:** Node.js ESM scripts, MCP SDK stdio client request options, existing public MCP tools, Vitest, packaged `dist/index.js`, Claude Code CLI subscription OAuth, existing `npm run ci` pipeline.

---

## Scope

**Create:**

- `scripts/live-smoke-claude-utils.mjs`
- `tests/live-smoke-claude-utils.test.ts`

**Modify:**

- `scripts/live-smoke-claude-team.mjs`
- `src/providers/claude-code-cli/background.ts`
- `src/providers/claude-code-cli/commands.ts`
- `src/providers/claude-code-cli/types.ts`
- `src/core/state/run-store.ts`
- `tests/providers/claude-code-cli/background.test.ts`
- `tests/live-smoke-claude-team.test.ts`
- `tests/core/lifecycle.test.ts`
- `README.md`
- `CHANGELOG.md`
- `docs/runbooks/claude-team-session.md`
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-46.md`

## Non-Goals

- Do not add or change public MCP tools or schemas.
- Do not add API-key fallback or infer provider credentials.
- Do not change provider routing, role policy, generated prompts, or capability descriptors.
- Do not make benchmark, ranking, reasoning, model-quality, or long-context claims.
- Do not add live Claude usage to CI.
- Do not delete logs, sidecars, transcripts, mailboxes, retained worktrees, or failure evidence during smoke cleanup.
- Do not copy the third-party Claude UI/task runtime wholesale; use it only as prior art for lifecycle semantics.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for terminal-state handling, smoke report status, MCP timeout options, lingering-run cancellation evidence, dry-run redaction, stream-json background input, wind-down/timeout finalization, and docs/runbook updates.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases selected: nonterminal `running`/`winding-down` statuses, terminal failure statuses, empty run refs, request timeout alignment, cleanup after smoke failure, report redaction, packaged runtime boundary, Claude stream-json stdin shape, wind-down timeout race, and no live provider use in CI.
- [x] Invariant scans are listed.
- [x] Live provider smoke is required before claiming real Claude reachability for this milestone; it remains opt-in and outside CI.

## Contracts

### Terminal Semantics

The live Claude smoke must distinguish:

- **Successful terminal:** every tracked run is `completed`.
- **Terminal but failed:** at least one tracked run is `failed`, `expired`, or `cancelled`.
- **Nonterminal:** any tracked run is `running`, `pending`, `awaiting-input`, `winding-down`, `detached`, missing, or otherwise unknown.

`winding-down` is explicitly nonterminal. It is evidence that a graceful stop was requested, not evidence that the run completed.

### MCP Request Timeout Alignment

Every live MCP call that may block on provider execution must pass explicit SDK request options derived from the operator timeout:

```js
client.callTool(request, {
  resultSchema: undefined,
  timeout: timeoutMs + bufferMs,
  maxTotalTimeout: timeoutMs + bufferMs,
  resetTimeoutOnProgress: true
});
```

The harness must not rely on the SDK default 60 second request timeout when a longer provider timeout was requested.

### Cleanup On Failure

If a live smoke starts runs and they do not reach successful terminal states before the bounded wait, the harness must:

- request wind-down if it has not already done so
- wait one more bounded interval for terminal status
- record explicit cancellation intent for remaining nonterminal runs through `agent_team_cancel_many`
- emit a `failed` report that includes final status rows and cleanup/cancellation evidence
- exit non-zero

The harness must not delete evidence or retained worktrees.

### Real Claude Reachability

Confirmed live execution must prove at least one short Claude Code CLI subscription-backed dispatch can return through the packaged MCP boundary:

```bash
npm run smoke:claude-live -- --confirm-live-provider-use --cwd /absolute/workspace
```

The proof must use public MCP tools and `dist/index.js`; it must not call `runClaudePrint`, provider internals, or the Claude CLI directly from the harness.

## Task 1: Red Tests For Terminal And Timeout Semantics

**Files:**

- Create: `scripts/live-smoke-claude-utils.mjs`
- Create: `tests/live-smoke-claude-utils.test.ts`
- Modify: `tests/live-smoke-claude-team.test.ts`

- [x] **Step 1: Add failing utility tests**

Add tests proving:

- `winding-down`, `running`, `pending`, `awaiting-input`, `detached`, and missing statuses are nonterminal.
- only `completed` is successful terminal for the Claude live smoke.
- `failed`, `expired`, and `cancelled` are terminal but unsuccessful.
- report status becomes `failed` when any final run is nonterminal or terminal-unsuccessful.
- empty run refs never produce `completed`.
- request options include `timeout`, `maxTotalTimeout`, and `resetTimeoutOnProgress`.

- [x] **Step 2: Add failing script wiring tests**

Extend script tests so the source no longer contains a terminal status set with `winding-down`, and so live calls route through a helper that accepts request timeout options.

## Task 2: Green Utility Layer

**Files:**

- Modify: `scripts/live-smoke-claude-utils.mjs`
- Modify: `scripts/live-smoke-claude-team.mjs`

- [x] **Step 1: Extract pure smoke helpers**

Implement utility helpers for:

- terminal/successful status classification
- compact status rows
- all-successful-run checks
- sanitized report status calculation
- MCP request option construction

- [x] **Step 2: Wire helper usage into live smoke**

Update `scripts/live-smoke-claude-team.mjs` to use helper predicates and request options for tool calls.

## Task 3: Failure Cleanup And Honest Reporting

**Files:**

- Modify: `scripts/live-smoke-claude-team.mjs`
- Modify: `tests/live-smoke-claude-team.test.ts`

- [x] **Step 1: Add bounded finalization flow**

After start/status/message/wind-down, wait for successful terminal status. If unsuccessful or nonterminal:

- gather dashboard/summary where possible
- call `agent_team_cancel_many` for remaining nonterminal refs
- fetch final status again
- return a failed report with `cleanupStatus`

- [x] **Step 2: Exit non-zero on failed report**

The CLI must print the sanitized failed report and exit `1`, rather than throwing away evidence behind a generic error.

## Task 4: Docs And Operator Runbook

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [x] **Step 1: Document honest live smoke semantics**

Explain that live smoke is successful only when tracked runs complete, and that cancellation evidence is expected if a bounded smoke fails.

- [x] **Step 2: Record prior-art learning**

Briefly note in the milestone plan that the third-party Claude dev-team project informed terminal-state, output-wait, and cleanup semantics without becoming a dependency.

Observed implementation note: live validation exposed an additional Claude Code CLI contract issue. Current Claude Code headless docs show `--input-format stream-json` expects a JSON user message on stdin, so the background runner now launches `claude -p --output-format stream-json --input-format stream-json --verbose`, writes the initial prompt as a stream-json user message, closes stdin, and treats later operator messages as durable mailbox/resume evidence unless a future transport supports truly live stdin.

## Task 5: Verification And Live Proof

**Focused tests:**

```bash
npm test -- tests/live-smoke-claude-utils.test.ts tests/live-smoke-claude-team.test.ts
```

Expected red before implementation: new utility tests fail because no helper exists and `winding-down` is treated as settled.

Expected green after implementation: focused tests pass and prove fail-closed report semantics.

**Full verification:**

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

**Invariant scans:**

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|subscription OAuth|authMode" src tests docs scripts
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers scripts
rg "benchmark|model-quality|mock LLM|embedding|heuristic" src tests docs scripts
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace" src tests docs scripts
rg "runClaudePrint|startClaudeBackgroundSession|requireProviderRuntime|createDefaultLifecycleRegistry" scripts/live-smoke-claude-team.mjs tests/live-smoke-claude-team.test.ts
```

**Live proof:**

```bash
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN npm run smoke:claude-live -- --confirm-live-provider-use --cwd /Users/example/Documents/coding-projects/codex-plugin-claude-agent-team
```

Pass condition: the report exits `0`, sets `status: "completed"`, records `liveProviderUse: true`, uses provider `claude-code-cli` with `subscription-oauth`, and includes at least one completed run id, sidecar path, and log path.
