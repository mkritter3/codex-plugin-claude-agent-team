# Agent Team MCP Milestone 31 Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runnable, provider-neutral operator runbook for a real Claude Code subscription-backed agent-team session, with CI-safe guard tests that keep the docs honest.

**Architecture:** The runbook lives under `docs/runbooks/` and documents the end-to-end control-plane workflow using the public MCP tools only. A docs-focused Vitest suite validates that the runbook covers setup, doctor/auth checks, parallel start, status summary, in-flight messaging, wind-down, cleanup, fixture-safe verification, and opt-in live smoke boundaries without exposing internal prompts or provider implementation details. The roadmap baseline is updated to reflect completed M27-M30 work so future milestone selection starts from current truth.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, Markdown docs, MCP public tool names, existing packaged stdio smoke, provider-neutral `.agent-team/` state conventions.

---

## Scope

**Files:**

- Create: `docs/runbooks/claude-team-session.md`
- Create: `tests/docs/runbook.test.ts`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-31.md`

**Non-goals:**

- Do not add, rename, or remove MCP tools.
- Do not add `agent_team_cancel_many`.
- Do not run a live Claude session in CI.
- Do not add API-key fallback, provider-specific public schemas, or provider-specific tool names.
- Do not expose internal prompts, hidden agent instructions, generated Claude agent definitions, command-line internals, process ids, or secrets.
- Do not make model-quality, benchmark, or provider-comparison claims.
- Do not create or remove retained implementation worktrees from the runbook automatically.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for the runbook guard tests.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Scope and architecture: this plan names documentation, test, roadmap, and non-goal boundaries.
- TDD red proof: `tests/docs/runbook.test.ts` is written before the runbook and fails because the runbook does not exist or lacks required sections.
- Documentation: docs must stand alone, avoid chat-history dependence, mark live-provider steps opt-in, and avoid internal prompts.
- Packaged runtime: runbook points to `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` as fixture-safe gates.
- Auth posture: runbook preserves subscription OAuth as the primary v1 transport and documents doctor/auth checks without suggesting API-key fallback.
- Lifecycle safety: runbook uses public MCP tools for start, status, summary, message, wind-down, and cleanup, with explicit cleanup only after review.
- Workspace safety: implementation worktree review and cleanup are explicit operator decisions.
- Failure behavior: runbook documents validation, doctor failure, retained worktree, corrupt state, and partial-failure triage without hiding evidence.
- Boundary scan: docs are scanned for placeholder prose, hidden prompt disclosure, model-quality claims, API fallback language, and provider-specific schema leakage.

Live provider smoke is opt-in for this milestone because the milestone creates documentation for subscription-backed live use but CI must not consume local subscription credentials or keep external provider processes alive.

## Success Criteria

- `docs/runbooks/claude-team-session.md` exists and can onboard a user without prior chat history.
- The runbook includes fixture-safe commands for `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci`.
- The runbook explicitly marks live Claude Code subscription smoke as opt-in and not part of CI.
- The runbook tells users to confirm `agent_team_doctor` before live dispatch.
- The runbook documents public MCP tool calls for `agent_team_start_parallel`, `agent_team_status_many`, `agent_team_summary`, `agent_team_message_many`, `agent_team_wind_down_many`, and `agent_team_cleanup`.
- The runbook covers retained implementation worktree review before cleanup.
- The runbook covers partial failures, state corruption/recovery evidence, awaiting-input runs, and cleanup-blocked runs.
- The runbook uses provider-neutral orchestration language and does not expose internal prompts, hidden agent instructions, provider command internals, or provider-specific MCP schemas.
- The roadmap current baseline names M27-M30 as completed so future selection is not anchored to stale M26 text.

## Task 1: Runbook Guard Tests

**Files:**

- Create: `tests/docs/runbook.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/docs/runbook.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const runbookUrl = new URL("../../docs/runbooks/claude-team-session.md", import.meta.url);
const roadmapUrl = new URL(
  "../../docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md",
  import.meta.url
);

async function readRunbook(): Promise<string> {
  return readFile(runbookUrl, "utf8");
}

describe("Claude team session runbook", () => {
  it("documents the full public MCP workflow without chat-history dependence", async () => {
    const doc = await readRunbook();

    for (const text of [
      "agent_team_doctor",
      "agent_team_start_parallel",
      "agent_team_status_many",
      "agent_team_summary",
      "agent_team_message_many",
      "agent_team_wind_down_many",
      "agent_team_cleanup",
      "npm run build",
      "npm run smoke:mcp-stdio",
      "npm run ci"
    ]) {
      expect(doc).toContain(text);
    }
    expect(doc).toContain("opt-in live smoke");
    expect(doc).toContain("not part of CI");
    expect(doc).toContain("retained implementation worktree");
    expect(doc).toContain("state_corrupt");
    expect(doc).toContain("partial_failure");
    expect(doc).toContain("awaiting-input");
    expect(doc).toContain("cleanupBlocked");
  });

  it("keeps documentation provider-neutral and avoids internal prompt disclosure", async () => {
    const doc = await readRunbook();

    expect(doc).toContain("Claude Code CLI subscription OAuth");
    expect(doc).not.toMatch(/ANTHROPIC_API_KEY=.*|ANTHROPIC_AUTH_TOKEN=.*|api[- ]key fallback/i);
    expect(doc).not.toMatch(/internal prompt|hidden instruction|generated agent definition|bypassPermissions|process id/i);
    expect(doc).not.toMatch(/benchmark|quality score|model-quality comparison/i);
  });

  it("updates the roadmap baseline through Milestone 30", async () => {
    const roadmap = await readFile(roadmapUrl, "utf8");

    expect(roadmap).toContain("Completed through Milestone 30");
    expect(roadmap).toContain("agent_team_message_many");
    expect(roadmap).toContain("agent_team_wind_down_many");
    expect(roadmap).toContain("agent_team_summary");
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
npm test -- tests/docs/runbook.test.ts
```

Expected: fail because `docs/runbooks/claude-team-session.md` does not exist and the roadmap still says completed through M26.

## Task 2: Operator Runbook

**Files:**

- Create: `docs/runbooks/claude-team-session.md`

- [ ] **Step 1: Add the runbook**

Create `docs/runbooks/claude-team-session.md` with:

- prerequisites and invariant summary
- CI-safe fixture verification
- MCP configuration confirmation
- doctor/auth preflight
- opt-in live smoke section
- public MCP tool payload examples for start, status, summary, message, wind-down, cleanup
- retained implementation worktree review and explicit cleanup guidance
- partial-failure, awaiting-input, state-corrupt, and cleanup-blocked triage
- evidence checklist for sidecars, logs, transcript, mailboxes, verdict, workspace diff, changed files, and recovery archive paths

- [ ] **Step 2: Run focused docs tests**

Run:

```bash
npm test -- tests/docs/runbook.test.ts
```

Expected: fail only on the roadmap baseline until Task 3 is complete.

## Task 3: Roadmap Baseline Refresh

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [ ] **Step 1: Update current baseline**

Change the roadmap current baseline from `Completed through Milestone 26` to `Completed through Milestone 30` and add bullets for:

- `agent_team_message_many`
- `agent_team_wind_down_many`
- `agent_team_summary`

- [ ] **Step 2: Run focused docs tests**

Run:

```bash
npm test -- tests/docs/runbook.test.ts
```

Expected: pass.

## Task 4: Plan Completion And Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-31.md`

- [ ] **Step 1: Mark completed gates**

After implementation and verification, mark this plan’s L11 checklist and task checkboxes complete.

- [ ] **Step 2: Run focused verification**

Commands:

```bash
npm test -- tests/docs/runbook.test.ts tests/package-scripts.test.ts tests/package-runtime.test.ts
npm run typecheck
npm test
npm run build
node scripts/smoke-mcp-stdio.mjs
```

- [ ] **Step 3: Run invariant scans**

Commands:

```bash
rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in|appropriate[ ]error[ ]handling|handle[ ]edge[ ]cases|write[ ]tests[ ]for|similar[ ]to" docs
rg -n "api[- ]key fallback|ANTHROPIC_API_KEY=.*|ANTHROPIC_AUTH_TOKEN=.*|internal prompt|hidden instruction|generated agent definition|bypassPermissions|process id|quality score|model-quality comparison|benchmark" docs/runbooks tests/docs
rg -n "agent_team_(start_parallel|status_many|summary|message_many|wind_down_many|cleanup)" docs/runbooks/claude-team-session.md tests/docs/runbook.test.ts
```

- [ ] **Step 4: Run full CI**

Command:

```bash
npm run ci
```

## Integration Plan

- Commit this plan on `main`.
- Create isolated worktree `.worktrees/milestone-31-runbook` on branch `codex/milestone-31-runbook`.
- Implement with TDD and keep red proof in terminal output.
- Merge the implementation branch to `main` only after focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass.
- Push `main`.
- Remove the temporary worktree and delete the temporary branch after successful merge.
