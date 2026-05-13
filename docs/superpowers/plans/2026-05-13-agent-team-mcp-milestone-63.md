# Agent Team MCP Milestone 63 Gemini CLI Autonomous Worker Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Gemini CLI from read-only dispatch to an opt-in autonomous implementation worker for isolated UI/UX and frontend slices.

**Architecture:** Extend the existing `gemini-cli` provider instead of adding a second provider family. The provider advertises write/session/cancel capabilities only when `writeValidated: true`; lifecycle still allocates retained isolated worktrees, and Gemini runs through provider-owned CLI command construction. Live write validation remains opt-in and fixture-scoped.

**Tech Stack:** TypeScript, Node.js child process APIs, Vitest, existing lifecycle/router/provider contracts, Gemini CLI OAuth, packaged MCP stdio live smoke harness.

---

## Scope

In scope:

- Add `writeValidated` to `providers.geminiCli`.
- Add optional Gemini CLI command policy for read-only versus isolated edit execution.
- Implement `gemini-cli` `startSession` with process-backed lifecycle support.
- Capture stdout/stderr into existing run evidence logs.
- Support cancellation/timeout through process termination.
- Advertise write capabilities only when `writeValidated: true` and config declares the relevant capabilities.
- Prefer Gemini for UI/UX/front-end roles through documented `rolePins`, not hidden router behavior.
- Add opt-in live write smoke for Gemini CLI isolated worktree validation.
- Document `GEMINI_CLI_TRUST_WORKSPACE=true`, `--approval-mode auto_edit`, capacity/cooldown behavior, and limits.

Out of scope:

- No `--yolo`.
- No Gemini API-key write path.
- No automatic merge or integration.
- No model-quality/provider-ranking claims.
- No mid-flight mailbox steering unless a stable Gemini interactive protocol is separately proven.
- No default Gemini write routing for backend/security/devops/integration roles.

## Success Criteria

- Default Gemini CLI remains disabled and read-only.
- Enabled Gemini CLI without `writeValidated` still supports read-only dispatch but cannot route `frontend-engineer` or `slice-implementer`.
- Enabled Gemini CLI with `writeValidated: true` can satisfy `frontend-engineer` and `slice-implementer` capability requirements.
- `startSession` invokes Gemini CLI with `--prompt`, `--model`, `--output-format text`, and safe `--approval-mode` based on execution policy.
- Isolated edit execution uses `--approval-mode auto_edit`; read-only execution uses `--approval-mode plan`.
- Cancellation and timeout produce durable failed/interrupted/expired evidence.
- Live smoke proves a Gemini CLI implementation run changes only a fixture UI file in the retained isolated worktree.
- Provider cooldown records capacity/rate-limit failures as degradation evidence.
- Docs and tests make no broad model-quality or provider-ranking claims.

## Task 1: Config And Capability Gate

**Files:**

- Modify `src/core/types.ts`
- Modify `src/core/config.ts`
- Modify `src/providers/gemini-cli/config.ts`
- Modify `tests/core/config.test.ts`
- Modify `tests/providers/gemini-cli/config.test.ts`
- Modify `tests/core/router.test.ts`

- [x] **Step 1: Write failing config tests**

Add tests proving:

```ts
expect(geminiCliProvider(config({ writeValidated: false, edits: true }))).toMatchObject({
  available: false,
  warnings: expect.arrayContaining([
    "Gemini CLI provider declares write capabilities without writeValidated."
  ])
});

expect(geminiCliProvider(config({ writeValidated: true, edits: true, workspaceIsolation: true }))).toMatchObject({
  capabilities: expect.arrayContaining(["tools", "edits", "workspaceIsolation", "cancellation"])
});
```

- [x] **Step 2: Verify red**

Run:

```bash
npm test -- tests/providers/gemini-cli/config.test.ts tests/core/config.test.ts tests/core/router.test.ts
```

Expected: tests fail because Gemini CLI config has no `writeValidated` or write capabilities.

- [x] **Step 3: Implement capability gating**

Add `writeValidated`, `tools`, `edits`, `workspaceIsolation`, `sessionResume`, and `cancellation` fields under `GeminiCliProviderConfig.capabilities`. Keep defaults false. Emit write capabilities only when `writeValidated` is true.

- [x] **Step 4: Verify green**

Run:

```bash
npm test -- tests/providers/gemini-cli/config.test.ts tests/core/config.test.ts tests/core/router.test.ts
```

Expected: focused tests pass.

## Task 2: Process-Backed Gemini Worker Runtime

**Files:**

- Modify `src/providers/gemini-cli/runtime.ts`
- Modify `tests/providers/gemini-cli/runtime.test.ts`

- [x] **Step 1: Write failing runtime tests**

Add tests proving:

```ts
const handle = runtime.startSession({
  prompt: "Implement UI copy.",
  cwd: "/tmp/worktree",
  workspaceRoot: "/tmp/source",
  runId: "run_gemini_write",
  roleId: "frontend-engineer",
  executionPolicy: "isolated-edit",
  permissionMode: "acceptEdits",
  config: config({ writeValidated: true, edits: true, workspaceIsolation: true, cancellation: true })
});

expect(spawnCalls[0].args).toContain("--approval-mode");
expect(spawnCalls[0].args).toContain("auto_edit");
expect(handle.supportsStdin).toBe(false);
```

Also add read-only `plan`, cancellation, timeout, stdout/stderr evidence, and non-zero exit tests.

- [x] **Step 2: Verify red**

Run:

```bash
npm test -- tests/providers/gemini-cli/runtime.test.ts
```

Expected: tests fail because `startSession` is unsupported.

- [x] **Step 3: Implement Gemini session handle**

Spawn the configured `gemini` executable with:

```ts
[
  "--prompt",
  input.prompt,
  "--model",
  provider.model,
  "--output-format",
  "text",
  "--approval-mode",
  input.executionPolicy === "isolated-edit" ? "auto_edit" : "plan"
]
```

Write stdout/stderr to `runLogPath(input.workspaceRoot, input.runId)`, keep bounded recent stderr/activity snapshots, resolve done status from process close, and kill the child on cancellation/timeout.

- [x] **Step 4: Verify green**

Run:

```bash
npm test -- tests/providers/gemini-cli/runtime.test.ts
```

Expected: runtime tests pass.

## Task 3: Live Gemini Write Smoke

**Files:**

- Create `scripts/live-smoke-gemini-write-validation.mjs`
- Create `tests/live-smoke-gemini-write-validation.test.ts`
- Modify `package.json`
- Modify `tests/package-scripts.test.ts`

- [x] **Step 1: Write failing script tests**

Add tests proving the script:

- fails closed without `--confirm-live-provider-use`
- supports `--dry-run`
- requires exact `gemini-cli` or `family:gemini-cli`
- prints sanitized output with no prompt, command args, env values, secrets, or provider payloads

- [x] **Step 2: Verify red**

Run:

```bash
npm test -- tests/live-smoke-gemini-write-validation.test.ts tests/package-scripts.test.ts
```

Expected: tests fail because the script/package script does not exist.

- [x] **Step 3: Implement live smoke**

Create a disposable git fixture with `index.html`, configure Gemini CLI with `writeValidated: true`, `writeMode.enabled: true`, `allowedWorktreeRoots`, `liveSmokeEnabled: true`, and role pin `frontend-engineer: "gemini-cli"`. Start a `frontend-engineer` run through packaged MCP stdio. Verify the source checkout is unchanged, the retained execution worktree changed only `index.html`, dashboard/summary evidence exists, and cleanup removes the worktree.

- [x] **Step 4: Verify green**

Run:

```bash
npm test -- tests/live-smoke-gemini-write-validation.test.ts tests/package-scripts.test.ts
```

Expected: tests pass.

## Task 4: Docs And Gates

**Files:**

- Modify `README.md`
- Modify `docs/runbooks/claude-team-session.md`
- Modify `docs/superpowers/plans/2026-05-13-agent-team-mcp-milestone-63.md`

- [x] **Step 1: Document operator setup**

Document Gemini CLI OAuth, `GEMINI_CLI_TRUST_WORKSPACE=true`, `writeValidated`, UI/frontend role pins, capacity cooldown, and the exact live smoke command.

- [x] **Step 2: Run focused and full verification**

Run:

```bash
npm test -- tests/providers/gemini-cli/config.test.ts tests/providers/gemini-cli/runtime.test.ts tests/live-smoke-gemini-write-validation.test.ts tests/core/config.test.ts tests/core/router.test.ts tests/package-scripts.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:workflow-orchestrator
npm run smoke:package
npm run ci
```

Expected: all commands pass.

- [x] **Step 3: Invariant scans**

Run:

```bash
rg -n "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode|gemini-cli|writeValidated|auto_edit|yolo" src tests docs README.md package.json scripts
rg -n "benchmark|model-quality|provider-ranking|quality score|mock LLM|heuristic" src tests docs README.md scripts
rg -n "internal prompt|hidden instruction|raw provider payload|providerSessionId|command args|secret|process\\.pid|GEMINI_API_KEY=" src tests docs README.md scripts
rg -n "process\\.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace" src tests docs README.md scripts
```

Expected: matches are existing guardrails, provider-local implementation/tests/docs, or explicit live-smoke safety language. No new API-key fallback, public provider-specific schema, secret leakage, auto-merge, benchmark/model-quality claim, or automatic cleanup shortcut is introduced.

## Live Proof Command

Only after fixture-safe verification passes:

```bash
env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN GEMINI_CLI_TRUST_WORKSPACE=true npm run smoke:gemini-write -- --confirm-live-provider-use --provider gemini-cli --model gemini-3-flash-preview --timeout-ms 240000 --max-wait-ms 300000
```

Expected: one Gemini CLI implementation run completes, changes only the fixture UI file in the isolated worktree, records evidence, and cleans up retained worktree. If Google returns `429`/capacity failures, the script reports degraded provider evidence rather than claiming success.

## Evidence

- Plan committed on `main`: `5422a1e docs: plan gemini autonomous worker`.
- TDD red: `npm test -- tests/live-smoke-gemini-write-validation.test.ts tests/package-scripts.test.ts` failed before script/package wiring existed.
- TDD red: `npm test -- tests/providers/gemini-cli/runtime.test.ts` failed until direct isolated-edit starts required the full autonomous worker gate.
- Focused green: `npm test -- tests/providers/gemini-cli/config.test.ts tests/providers/gemini-cli/runtime.test.ts tests/live-smoke-gemini-write-validation.test.ts tests/core/config.test.ts tests/core/router.test.ts tests/package-scripts.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` passed 76 tests across 8 files.
- Full tests: `npm test` passed 605 tests across 82 files.
- Typecheck: `npm run typecheck` passed.
- Build: `npm run build` passed.
- Package gates: `npm run install:check`, `npm run smoke:mcp-stdio`, `npm run smoke:workflow-orchestrator`, and `npm run smoke:package` passed.
- CI: `npm run ci` passed.
- Invariant scans: auth/fallback, model-claim, prompt/schema/secret, and cleanup/process scans were run across `src`, `tests`, `docs`, `README.md`, `package.json`, and `scripts`. Matches were expected guardrails, provider-local capability/runtime implementation, tests, docs, live-smoke safety language, or pre-existing lifecycle cleanup/process handling. No new API-key fallback, public provider-specific schema, raw secret leak, benchmark/model-quality/provider-ranking claim, automatic cleanup shortcut, or unbounded process-kill shortcut was introduced.
- Live proof: `env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN GEMINI_CLI_TRUST_WORKSPACE=true npm run smoke:gemini-write -- --confirm-live-provider-use --provider gemini-cli --model gemini-3-flash-preview --timeout-ms 240000 --max-wait-ms 300000` completed with `run_20260513172123617_313c7d2e7d6b`, verdict `SHIP`, `changedFiles: ["index.html"]`, source workspace unmodified, and cleanup `removed`.
- Pro preview caveat: an earlier live proof reached Gemini CLI OAuth but returned Google `429` / `MODEL_CAPACITY_EXHAUSTED` for `gemini-3.1-pro-preview`; no Pro write-readiness claim is made.
