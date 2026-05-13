# Agent Team MCP Milestone 67: Live Dogfood App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and run an opt-in live dogfood harness that drives the Agent Team plugin through a production-style disposable app workflow using the Delegation Playbook, real providers, isolated worktrees, review evidence, integration evidence, final verification, and cleanup.

**Architecture:** Add a reusable script that creates a temporary git-backed web app fixture, configures explicit write-validated providers only inside that fixture, drives public packaged MCP tools, starts provider-specific workflow slices with bounded concurrency, integrates reviewed worktree output only after Codex-owned checks, and emits a sanitized report. The script is not part of CI and makes no provider-quality or ranking claims.

**Tech Stack:** Node.js ESM, MCP SDK stdio client, public Agent Team MCP tools, git worktrees, Vitest/script tests, disposable static web app fixture, `node --test` verification.

---

## Success Criteria

- `npm run dogfood:live-app -- --dry-run` prints a sanitized plan without live provider calls.
- Confirmed live mode fails closed unless `--confirm-live-provider-use` is supplied.
- The script uses the packaged MCP boundary at `dist/index.js`.
- The disposable app fixture configures:
  - `claude-code-cli:opus` for planning/review proof
  - `gemini-cli` for UI/frontend slice work
  - `codex-cli` for implementation/test slice work
  - `ollama-claude-code:kimi-k2.6` for a junior contained slice when `OLLAMA_API_KEY` is present
- The dogfood workflow uses public workflow tools: doctor, create workflow, plan consensus, workflow next, record user decision, start slices, status, review slice, integration queue, record integration, workflow report, dashboard, summary, cleanup.
- Implementation runs write only in retained isolated worktrees.
- Codex-owned script integration copies only expected files from reviewed execution worktrees into the disposable source workspace.
- Final verification runs in the disposable source workspace.
- Cleanup removes retained worktrees through `agent_team_cleanup`.
- The sanitized report includes run ids, providers, slice ids, changed files, verification commands, completion status, cleanup status, and claim boundary.
- The report does not include prompts, task text, raw provider payloads, command args, environment values, provider session ids, secrets, or provider-quality rankings.
- Focused tests, typecheck, full tests, build, package smokes, invariant scans, and `npm run ci` pass before merge.
- The live dogfood script is run once after merge or from the verified worktree, and its result is summarized honestly.

## File Structure

- Create `scripts/live-dogfood-agent-team-app.mjs`
  - Owns dry-run plan, disposable fixture creation, MCP calls, provider-specific slice starts, integration, final verification, cleanup, and sanitized reporting.
- Create `tests/live-dogfood-agent-team-app.test.ts`
  - Covers fail-closed live guard, dry-run report, public tool flow, provider selectors, packaged MCP use, and report sanitization strings.
- Modify `package.json`
  - Add `dogfood:live-app`.
  - Assert the script is not in `ci`.
- Modify `tests/package-scripts.test.ts`
  - Verifies script registration and CI exclusion.
- Modify `README.md`
  - Add a concise opt-in live dogfood section and claim boundary.
- Modify `tests/docs/packaging.test.ts`
  - Verifies README documents the dogfood command and `dogfood_app_workflow_only` claim boundary.

## Task 1: Add Live Dogfood Script Tests

**Files:**
- Create `tests/live-dogfood-agent-team-app.test.ts`
- Modify `tests/package-scripts.test.ts`

- [ ] **Step 1: Write failing tests**

Assert:

- `dogfood:live-app` equals `node scripts/live-dogfood-agent-team-app.mjs`
- `ci` does not contain `dogfood:live-app`
- running the script without flags exits non-zero and mentions `--confirm-live-provider-use`
- `--dry-run` emits JSON with `liveProviderUse: false`, `claimBoundary: "dogfood_app_workflow_only"`, provider selectors, and tool flow
- script text contains only public MCP tool names and packaged `dist/index.js` use
- dry-run output does not match private leakage patterns

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npm test -- tests/live-dogfood-agent-team-app.test.ts tests/package-scripts.test.ts
```

Expected: FAIL because the script and package entry do not exist.

## Task 2: Implement The Dogfood Harness

**Files:**
- Create `scripts/live-dogfood-agent-team-app.mjs`
- Modify `package.json`

- [ ] **Step 1: Implement dry-run and fail-closed guard**

The script should parse `--dry-run`, `--confirm-live-provider-use`, `--timeout-ms`, `--max-wait-ms`, and optional provider selectors. Dry-run must not create MCP clients or call providers.

- [ ] **Step 2: Implement disposable app fixture**

Create a git repo with:

- `package.json` using `node --test tests/app.test.js`
- initial `index.html`
- initial `src/app.js`
- `tests/app.test.js` that checks for production app markers after integration
- `.agent-team/config.json` with explicit provider config, isolated worktree policy, allowed provider selectors, and live smoke enabled

- [ ] **Step 3: Implement packaged MCP tool flow**

Use only public tools through `dist/index.js`:

- `agent_team_doctor`
- `agent_team_create_workflow`
- `agent_team_plan_consensus`
- `agent_team_workflow_next`
- `agent_team_record_user_decision`
- `agent_team_start_slices`
- `agent_team_status_many`
- `agent_team_review_slice`
- `agent_team_integration_queue`
- `agent_team_record_integration`
- `agent_team_workflow_report`
- `agent_team_dashboard`
- `agent_team_summary`
- `agent_team_cleanup`

- [ ] **Step 4: Implement Codex-owned integration**

After review evidence, copy only expected files from each retained execution worktree into the fixture source workspace. Run `npm test` in source. Record integration evidence through `agent_team_record_integration`.

- [ ] **Step 5: Implement cleanup and sanitized report**

Call `agent_team_cleanup` for retained runs, remove the disposable fixture unless `--keep-fixture` is supplied, and print a sanitized report with no private payloads.

## Task 3: Docs

**Files:**
- Modify `README.md`
- Modify `tests/docs/packaging.test.ts`

- [ ] **Step 1: Add docs assertions and verify red**

Assert README contains:

- `npm run dogfood:live-app`
- `dogfood_app_workflow_only`
- `--confirm-live-provider-use`
- `Delegation Playbook`
- `production-style disposable app`

- [ ] **Step 2: Update README and verify green**

Document dry-run, confirmed run, claim boundary, and known limitations.

## Task 4: Verification, Merge, Push, Live Run

- [ ] **Step 1: Focused tests**

Run:

```bash
npm test -- tests/live-dogfood-agent-team-app.test.ts tests/package-scripts.test.ts tests/docs/packaging.test.ts
```

- [ ] **Step 2: Full local gates**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run smoke:workflow-orchestrator
npm run smoke:package
npm run scan:workflow-guidance
npm run validate:workflow-fixtures
npm run scan:workflow-validation
npm run ci
```

- [ ] **Step 3: Commit, merge, push, cleanup**

Commit in the implementation worktree, fast-forward merge to `main`, push `main`, and remove the temporary worktree/branch.

- [ ] **Step 4: Run opt-in live dogfood**

Run:

```bash
npm run build
env -u ANTHROPIC_API_KEY npm run dogfood:live-app -- --confirm-live-provider-use --timeout-ms 300000 --max-wait-ms 360000
```

Report exactly what passed, what degraded, what was skipped, and what claim boundary applies.
