# Agent Team MCP Milestone 45 Read-Only Provider Proof Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in live smoke harness that proves explicitly configured non-Claude read-only providers can run through the packaged MCP boundary without adding CI live-provider usage or model-quality claims.

**Architecture:** M45 adds a script-level operator harness over the existing public MCP tools. The harness starts `dist/index.js` over stdio, runs doctor, lists configured providers, dispatches read-only roles through explicit provider selectors, then reads dashboard and summary evidence for the resulting run ids. It does not add an MCP tool, provider adapter, benchmark, fallback route, background session support, edit workflow, or cleanup automation.

**Tech Stack:** Node.js ESM scripts, MCP SDK stdio client, existing `agent_team_doctor`, `agent_team_list_providers`, `agent_team_dispatch`, `agent_team_dashboard`, `agent_team_summary`, Vitest, existing docs/package tests, packaged `dist/index.js`, existing `npm run ci` pipeline.

---

## Scope

**Create:**

- `scripts/live-smoke-readonly-providers.mjs`
- `tests/live-smoke-readonly-providers.test.ts`

**Modify:**

- `package.json`
- `scripts/smoke-package.mjs`
- `tests/package-scripts.test.ts`
- `tests/package-smoke.test.ts`
- `tests/docs/packaging.test.ts`
- `tests/docs/runbook.test.ts`
- `README.md`
- `CHANGELOG.md`
- `docs/runbooks/claude-team-session.md`
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-45.md`

## Non-Goals

- Do not add a public MCP tool.
- Do not change provider routing, provider descriptors, provider adapters, lifecycle semantics, or public schemas.
- Do not run live providers in CI.
- Do not infer API keys, endpoints, provider selectors, or fallback routes from Claude subscription mode.
- Do not support implementation roles, background sessions, live stdin, resume, message, wind-down, cancel, edits, tools, streaming, workspace isolation, or cleanup for non-Claude providers in this milestone.
- Do not print prompts, task text, provider session ids, raw provider payloads, endpoint URLs, auth env values, API keys, process ids, command args, or model-quality comparisons.
- Do not claim benchmark, ranking, practical long-context, reasoning, or model-quality results.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for fail-closed confirmation, explicit provider selectors, dry-run report shape, package script/CI wiring, package contents, and docs.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases selected: packaged runtime, docs/examples, CI script ordering, report redaction, missing provider selector, invalid concurrency, explicit confirmation, provider list evidence, public MCP boundary, and no live provider use in CI.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is optional operator proof and is not required for CI; it is required only before claiming non-Claude real-provider readiness beyond fixture mechanics.

## Contracts

### Package Scripts

Add this script:

```json
{
  "scripts": {
    "smoke:providers-live": "node scripts/live-smoke-readonly-providers.mjs"
  }
}
```

Keep `ci` unchanged except for the existing install handoff gate:

```json
{
  "scripts": {
    "ci": "npm run typecheck && npm test && npm run build && npm run install:check && npm run smoke:mcp-stdio && npm run smoke:package"
  }
}
```

### CLI Shape

The command must fail closed without dry-run or explicit confirmation:

```bash
npm run smoke:providers-live -- --provider family:gemini
```

Expected: exit `1` with stderr explaining `--confirm-live-provider-use` and `--dry-run`.

The command must require at least one explicit provider selector:

```bash
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace
```

Expected: exit `1` with stderr explaining `--provider <selector>`.

Dry-run is fixture-safe and does not connect to MCP:

```bash
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:gemini --provider family:grok
```

prints:

```json
{
  "status": "dry_run",
  "liveProviderUse": false,
  "workspaceRoot": "/absolute/path/to/workspace",
  "providerSelectors": ["family:gemini", "family:grok"],
  "authMode": "explicit-provider-config",
  "toolFlow": [
    "agent_team_doctor",
    "agent_team_list_providers",
    "agent_team_dispatch",
    "agent_team_dashboard",
    "agent_team_summary"
  ],
  "requiredConfirmation": "--confirm-live-provider-use",
  "policyRequirement": "policy.liveSmokeEnabled must be true",
  "plannedRuns": [
    {
      "role": "code-reviewer",
      "providerSelector": "family:gemini",
      "correlationId": "provider-proof-0"
    }
  ],
  "knownLimitations": [
    "This smoke proves explicit read-only provider routing and lifecycle evidence only; it makes no benchmark, ranking, model-quality, or long-context claim."
  ]
}
```

Confirmed live execution:

```bash
npm run build
npm run smoke:providers-live -- --confirm-live-provider-use --cwd /absolute/path/to/workspace --provider family:gemini --concurrency 1
```

must:

- use `node dist/index.js` over MCP stdio
- call `agent_team_doctor` and require `doctor.ok === true`
- require `policy.liveSmokeEnabled === true`
- call `agent_team_list_providers`
- call `agent_team_dispatch` once per provider selector with role `code-reviewer`
- preserve provider selector order in the report, even if execution is concurrent
- call `agent_team_dashboard` and `agent_team_summary` for successfully created run refs
- emit a sanitized report with provider selector, selected provider id, auth mode, run id, status, sidecar/log/evidence paths, dashboard counts, summary groups, and known limitations
- exit non-zero if no provider proof run succeeds

Supported flags:

- `--cwd <path>`: defaults to process cwd.
- `--provider <selector>`: repeatable; at least one is required.
- `--dry-run`: print plan only and do not connect to MCP.
- `--confirm-live-provider-use`: required for live execution.
- `--concurrency <n>`: integer from `1` to `3`, default `1`.
- `--timeout-ms <n>`: positive dispatch timeout, default `120000`.

## Task 1: Red Tests For Provider Proof CLI

**Files:**

- Create: `tests/live-smoke-readonly-providers.test.ts`
- Create: `scripts/live-smoke-readonly-providers.mjs`

- [ ] **Step 1: Add failing CLI tests**

Add tests that prove fail-closed and dry-run behavior:

```ts
it("fails closed unless live provider use is confirmed or dry-run is requested", () => {
  const result = spawnSync("node", ["scripts/live-smoke-readonly-providers.mjs", "--provider", "family:gemini"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--confirm-live-provider-use");
  expect(result.stderr).toContain("--dry-run");
});
```

```ts
it("requires at least one explicit provider selector", () => {
  const result = spawnSync("node", ["scripts/live-smoke-readonly-providers.mjs", "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--provider <selector>");
});
```

```ts
it("prints a sanitized dry-run provider proof plan without connecting to MCP", () => {
  const result = spawnSync("node", [
    "scripts/live-smoke-readonly-providers.mjs",
    "--dry-run",
    "--cwd",
    "/tmp/agent-team-provider-proof",
    "--provider",
    "family:gemini",
    "--provider",
    "family:grok"
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  expect(result.status).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({
    status: "dry_run",
    liveProviderUse: false,
    workspaceRoot: "/tmp/agent-team-provider-proof",
    providerSelectors: ["family:gemini", "family:grok"],
    authMode: "explicit-provider-config",
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement: "policy.liveSmokeEnabled must be true"
  });
  expect(report.toolFlow).toEqual([
    "agent_team_doctor",
    "agent_team_list_providers",
    "agent_team_dispatch",
    "agent_team_dashboard",
    "agent_team_summary"
  ]);
  expect(report.plannedRuns.map((run: { role: string }) => run.role)).toEqual([
    "code-reviewer",
    "code-reviewer"
  ]);
  expect(result.stdout).not.toMatch(
    /prompt|task|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|GEMINI_API_KEY|GROK_API_KEY/i
  );
});
```

- [ ] **Step 2: Run red**

Run:

```bash
npm test -- tests/live-smoke-readonly-providers.test.ts
```

Expected red: `scripts/live-smoke-readonly-providers.mjs` does not exist.

- [ ] **Step 3: Implement minimal dry-run CLI**

Create `scripts/live-smoke-readonly-providers.mjs` with:

- `readValues("--provider")`
- `readNumber("--concurrency", 1)` clamped by validation to `1..3`
- `dryRunReport(workspaceRoot, providerSelectors)`
- fail-closed confirmation checks
- no MCP imports beyond static imports needed for later live implementation

- [ ] **Step 4: Run green**

Run:

```bash
npm test -- tests/live-smoke-readonly-providers.test.ts
```

Expected green: fail-closed, explicit provider, and dry-run redaction tests pass.

## Task 2: Live MCP Boundary And Report Shape

**Files:**

- Modify: `scripts/live-smoke-readonly-providers.mjs`
- Modify: `tests/live-smoke-readonly-providers.test.ts`

- [ ] **Step 1: Add failing script-boundary tests**

Add a script inspection test:

```ts
it("uses the packaged MCP boundary and public read-only tools for confirmed provider proof", async () => {
  const script = await readText("scripts/live-smoke-readonly-providers.mjs");

  expect(script).toContain("@modelcontextprotocol/sdk/client/index.js");
  expect(script).toContain("@modelcontextprotocol/sdk/client/stdio.js");
  expect(script).toContain('join(repoRoot, "dist", "index.js")');
  for (const toolName of [
    "agent_team_doctor",
    "agent_team_list_providers",
    "agent_team_dispatch",
    "agent_team_dashboard",
    "agent_team_summary"
  ]) {
    expect(script).toContain(toolName);
  }
  expect(script).toContain("liveSmokeEnabled");
  expect(script).toContain("--concurrency");
  expect(script).toContain("runBoundedProofs");
  expect(script).toContain("StdioClientTransport");
  expect(script).not.toContain("runClaudePrint");
  expect(script).not.toContain("startClaudeBackgroundSession");
  expect(script).not.toContain("requireProviderRuntime");
});
```

Add a validation test:

```ts
it("rejects invalid provider proof concurrency", () => {
  const result = spawnSync("node", [
    "scripts/live-smoke-readonly-providers.mjs",
    "--dry-run",
    "--provider",
    "family:gemini",
    "--concurrency",
    "9"
  ], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--concurrency must be an integer from 1 to 3");
});
```

- [ ] **Step 2: Run red**

Run:

```bash
npm test -- tests/live-smoke-readonly-providers.test.ts
```

Expected red: live MCP boundary and concurrency handling are not implemented.

- [ ] **Step 3: Implement live proof path**

Extend `scripts/live-smoke-readonly-providers.mjs` to:

- import `Client` and `StdioClientTransport`
- assert `dist/index.js` exists before live execution
- call MCP tools through `callTool(client, name, args)`
- parse `agent_team_list_providers` into a provider descriptor lookup by selected provider id
- run one `agent_team_dispatch` per selector with:

```js
{
  cwd: workspaceRoot,
  provider: selector,
  role: "code-reviewer",
  task: "Live provider proof only: inspect the workspace read-only and return a concise SHIP/BLOCK/NEEDS_INPUT verdict without editing files.",
  timeoutMs
}
```

- preserve ordered results with `runBoundedProofs(items, concurrency, worker)`
- build run refs from successful dispatch results
- call `agent_team_dashboard` and `agent_team_summary` only when at least one run id exists
- emit no task text or prompt text in the final report

- [ ] **Step 4: Run green**

Run:

```bash
npm test -- tests/live-smoke-readonly-providers.test.ts
```

Expected green: dry-run, fail-closed, concurrency, and boundary tests pass.

## Task 3: Package Script, Package Contents, And Docs

**Files:**

- Modify: `package.json`
- Modify: `scripts/smoke-package.mjs`
- Modify: `tests/package-scripts.test.ts`
- Modify: `tests/package-smoke.test.ts`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/runbooks/claude-team-session.md`

- [ ] **Step 1: Add failing package/docs tests**

Extend package script tests:

```ts
expect(packageJson.scripts?.["smoke:providers-live"]).toBe(
  "node scripts/live-smoke-readonly-providers.mjs"
);
expect(packageJson.scripts?.ci).not.toContain("smoke:providers-live");
```

Extend package smoke tests:

```ts
expect(smokeScript).toContain('"scripts/live-smoke-readonly-providers.mjs"');
```

Extend docs tests to require:

```ts
expect(readme).toContain("npm run smoke:providers-live");
expect(readme).toContain("--provider family:gemini");
expect(readme).toContain("explicit read-only provider routing");
expect(readme).toContain("no benchmark, ranking, model-quality, or long-context claim");
expect(runbook).toContain("npm run smoke:providers-live");
expect(runbook).toContain("--provider family:gemini");
```

- [ ] **Step 2: Run red**

Run:

```bash
npm test -- tests/live-smoke-readonly-providers.test.ts tests/package-scripts.test.ts tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected red: package scripts, package smoke, and docs do not mention the provider proof harness.

- [ ] **Step 3: Update package smoke and docs**

Update docs with these exact examples:

```bash
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider family:gemini
```

```bash
npm run smoke:providers-live -- --confirm-live-provider-use --cwd /absolute/path/to/workspace --provider family:gemini --concurrency 1
```

State that the harness:

- uses packaged MCP stdio and public read-only tools
- requires explicit provider selectors and `policy.liveSmokeEnabled`
- is not part of CI
- proves explicit read-only provider routing and evidence mechanics only
- makes no benchmark, ranking, model-quality, or long-context claim

- [ ] **Step 4: Run green**

Run:

```bash
npm test -- tests/live-smoke-readonly-providers.test.ts tests/package-scripts.test.ts tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected green: provider proof harness is covered by focused script/package/docs tests.

## Task 4: Verification, Evidence, And Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-45.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/live-smoke-readonly-providers.test.ts tests/package-scripts.test.ts tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

- [ ] **Step 3: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|GEMINI_API_KEY|GROK_API_KEY|subscription OAuth|authMode|explicit-provider-config|smoke:providers-live" src tests docs README.md CHANGELOG.md package.json scripts
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core scripts
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison|ranking|long-context claim" src tests docs README.md CHANGELOG.md scripts
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema|promptHash|providerSessionId|payload|secret|process id|command args|migration payload|endpoint" src tests docs README.md CHANGELOG.md scripts
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|auto-migrate|auto migrate|state-layout" src tests docs README.md CHANGELOG.md scripts
```

- [ ] **Step 4: Update verification evidence**

Record red proof, focused proof, full proof, package smoke, and invariant scan interpretation in this plan.

- [ ] **Step 5: Commit implementation**

Run:

```bash
git diff --check
git status --short
git add scripts tests package.json README.md CHANGELOG.md docs
git commit -m "feat: add read-only provider proof smoke"
```

## Verification Evidence

- Baseline before implementation: pending.
- Red proof: pending.
- Focused milestone proof: pending.
- Full proof: pending.
- Packaged smoke: pending.
- Invariant scans: pending.
