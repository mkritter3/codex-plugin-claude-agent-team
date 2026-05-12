# Agent Team MCP Milestone 44 Install Handoff And MCP Config Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixture-safe install handoff command that validates the packaged runtime surface and prints an absolute MCP config for Codex clients.

**Architecture:** M44 adds a script-level preflight over package metadata, plugin manifest, local `.mcp.json`, and built runtime files. It does not add an MCP tool, provider adapter, live provider call, credential path, or workspace mutation. The reusable script helper builds a sanitized report and the CLI returns exit code `0` only when the install surface is ready.

**Tech Stack:** Node.js ESM scripts, Vitest, existing package/runtime tests, existing docs tests, packaged `dist/index.js`, existing `npm run ci` pipeline.

---

## Scope

**Create:**

- `scripts/lib/install-preflight.mjs`
- `scripts/install-check.mjs`
- `tests/install-check.test.ts`

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
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-44.md`

## Non-Goals

- Do not add a public MCP tool.
- Do not call `agent_team_doctor`, Claude Code CLI, provider runtimes, or live provider APIs.
- Do not read or print environment variables, auth tokens, API keys, provider session ids, prompts, mailbox payloads, command internals, or process ids.
- Do not write to user config files in v1; the handoff prints the config and next steps only.
- Do not add live Claude smoke to CI.
- Do not make provider readiness, model-quality, benchmark, ranking, or long-context claims.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for install report shape, blocked status, package script/CI wiring, package contents, and docs.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases selected: packaged runtime, docs/examples, CI script ordering, report redaction, missing built runtime, malformed server name, and package allowlist.
- [x] Invariant scans are listed.
- [x] Live provider smoke is not required because M44 validates install mechanics only and makes no real-provider claim.

## Contracts

### Package Scripts

Add this script:

```json
{
  "scripts": {
    "install:check": "node scripts/install-check.mjs"
  }
}
```

Update `ci` to run after build and before smokes:

```json
{
  "scripts": {
    "ci": "npm run typecheck && npm test && npm run build && npm run install:check && npm run smoke:mcp-stdio && npm run smoke:package"
  }
}
```

### CLI Shape

The command:

```bash
npm run install:check
```

prints a JSON report:

```json
{
  "status": "ready",
  "packageRoot": "/absolute/path/to/repo",
  "serverName": "agent-team",
  "mcpConfig": {
    "mcpServers": {
      "agent-team": {
        "command": "node",
        "args": ["/absolute/path/to/repo/dist/index.js"]
      }
    }
  },
  "checks": [
    {
      "id": "package-json",
      "status": "pass",
      "path": "/absolute/path/to/repo/package.json"
    }
  ],
  "nextSteps": [
    "Add mcpConfig.mcpServers.agent-team to the Codex MCP client configuration.",
    "Run agent_team_doctor for the target workspace before starting live runs."
  ]
}
```

Supported flags:

- `--package-root <path>`: defaults to repo root.
- `--server-name <name>`: defaults to `agent-team`; only `[A-Za-z0-9_-]+` is accepted.

Blocked reports exit with code `1` and include the same sanitized shape with `status: "blocked"` and failed checks.

## Task 1: Red Tests For Install Preflight Core

**Files:**

- Create: `tests/install-check.test.ts`
- Create: `scripts/lib/install-preflight.mjs`

- [x] **Step 1: Add failing tests**

Add tests that import `scripts/lib/install-preflight.mjs` and assert:

```ts
const report = await buildInstallPreflightReport({
  packageRoot: fixtureRoot,
  serverName: "agent-team"
});
expect(report.status).toBe("ready");
expect(report.mcpConfig.mcpServers["agent-team"]).toEqual({
  command: "node",
  args: [join(fixtureRoot, "dist", "index.js")]
});
expect(JSON.stringify(report)).not.toMatch(
  /prompt|providerSessionId|payload|secret|process id|command args|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/i
);
```

Add a missing-runtime test:

```ts
const report = await buildInstallPreflightReport({
  packageRoot: fixtureRootWithoutDist,
  serverName: "agent-team"
});
expect(report.status).toBe("blocked");
expect(report.checks).toContainEqual(
  expect.objectContaining({ id: "runtime-entrypoint", status: "fail" })
);
```

Add a server-name validation test:

```ts
await expect(
  buildInstallPreflightReport({ packageRoot: fixtureRoot, serverName: "../bad" })
).rejects.toThrow("server name");
```

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/install-check.test.ts
```

Expected red: `scripts/lib/install-preflight.mjs` does not exist.

- [x] **Step 3: Implement minimal helper**

Create `scripts/lib/install-preflight.mjs` with:

- `buildMcpConfig({ packageRoot, serverName })`
- `buildInstallPreflightReport({ packageRoot, serverName })`
- ordered checks for `package.json`, `.codex-plugin/plugin.json`, `.mcp.json`, `dist/index.js`, and `scripts/install-check.mjs`
- sanitized `nextSteps`
- `status: "ready"` only when all checks pass

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/install-check.test.ts
```

Expected green: ready, blocked, invalid server name, and redaction tests pass.

## Task 2: CLI And Package Script Wiring

**Files:**

- Create: `scripts/install-check.mjs`
- Modify: `package.json`
- Modify: `tests/package-scripts.test.ts`
- Modify: `tests/install-check.test.ts`

- [x] **Step 1: Add failing CLI/script tests**

Add tests proving:

```ts
expect(packageJson.scripts?.["install:check"]).toBe("node scripts/install-check.mjs");
expect(packageJson.scripts?.ci).toBe(
  "npm run typecheck && npm test && npm run build && npm run install:check && npm run smoke:mcp-stdio && npm run smoke:package"
);
expect(packageJson.scripts?.ci).not.toContain("smoke:claude-live");
```

Add subprocess tests:

```ts
const result = spawnSync("node", ["scripts/install-check.mjs", "--package-root", fixtureRoot], {
  cwd: repoRoot,
  encoding: "utf8"
});
expect(result.status).toBe(0);
expect(JSON.parse(result.stdout).status).toBe("ready");
```

```ts
const result = spawnSync("node", ["scripts/install-check.mjs", "--package-root", missingRuntimeRoot], {
  cwd: repoRoot,
  encoding: "utf8"
});
expect(result.status).toBe(1);
expect(JSON.parse(result.stdout).status).toBe("blocked");
```

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/install-check.test.ts tests/package-scripts.test.ts
```

Expected red: CLI and package script are missing.

- [x] **Step 3: Implement CLI**

Create `scripts/install-check.mjs` that parses `--package-root` and `--server-name`, calls `buildInstallPreflightReport`, prints JSON to stdout, prints only fatal parsing errors to stderr, and exits `1` for blocked reports.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/install-check.test.ts tests/package-scripts.test.ts
```

Expected green: CLI report and CI script ordering are correct.

## Task 3: Package Contents And Docs

**Files:**

- Modify: `scripts/smoke-package.mjs`
- Modify: `tests/package-smoke.test.ts`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/runbooks/claude-team-session.md`

- [x] **Step 1: Add failing package/docs tests**

Extend package smoke tests to require:

```ts
expect(smokeScript).toContain('"scripts/install-check.mjs"');
expect(smokeScript).toContain('"scripts/lib/install-preflight.mjs"');
```

Extend docs tests to require:

```ts
expect(readme).toContain("npm run install:check");
expect(readme).toContain("absolute MCP config");
expect(readme).toContain("does not call providers");
expect(runbook).toContain("npm run install:check");
expect(runbook).toContain("agent_team_doctor");
```

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected red: package smoke and docs do not mention the install handoff.

- [x] **Step 3: Update package smoke and docs**

Add `scripts/install-check.mjs` and `scripts/lib/install-preflight.mjs` to the package smoke required paths. Document:

```bash
npm run build
npm run install:check
```

State that the command emits an absolute MCP config, does not call providers, does not read credentials, and is safe for CI.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected green: install handoff is covered by package and docs tests.

## Task 4: Verification, Evidence, And Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-44.md`

- [x] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/install-check.test.ts tests/package-scripts.test.ts tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

- [x] **Step 2: Run full verification**

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

- [x] **Step 3: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|subscription OAuth|authMode|install:check" src tests docs README.md CHANGELOG.md package.json scripts
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core scripts
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison|ranking" src tests docs README.md CHANGELOG.md scripts
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema|promptHash|providerSessionId|payload|secret|process id|command args|migration payload" src tests docs README.md CHANGELOG.md scripts
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|auto-migrate|auto migrate|state-layout" src tests docs README.md CHANGELOG.md scripts
```

- [x] **Step 4: Update verification evidence**

Record red proof, focused proof, full proof, package smoke, and invariant scan interpretation in this plan.

- [x] **Step 5: Commit implementation**

Run:

```bash
git diff --check
git status --short
git add scripts tests package.json README.md CHANGELOG.md docs
git commit -m "feat: add install handoff preflight"
```

## Verification Evidence

- Baseline before implementation: `npm test` passed 55 test files and 428 tests on the isolated worktree before M44 code changes.
- Red proof: `npm test -- tests/install-check.test.ts` failed because `scripts/lib/install-preflight.mjs` did not exist. `npm test -- tests/install-check.test.ts tests/package-scripts.test.ts` then failed because `install:check` and `scripts/install-check.mjs` were missing. `npm test -- tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` then failed because package smoke and docs did not cover the install handoff. A malformed `.mcp.json` regression test failed until the helper returned a sanitized blocked check instead of throwing.
- Focused milestone proof: `npm test -- tests/install-check.test.ts tests/package-scripts.test.ts tests/package-smoke.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` passed 5 test files and 16 tests.
- Full proof: `npm run typecheck`, `npm test` (56 test files, 434 tests), `npm run build`, and a fresh post-documentation `npm run ci` all passed.
- Packaged smoke: `npm run install:check` returned `status: "ready"` with ordered pass checks and an absolute `dist/index.js` MCP config. `npm run smoke:mcp-stdio` and `npm run smoke:package` passed.
- Invariant scans: auth/fallback, permission/bypass, benchmark/model-quality, prompt/schema leakage, and cleanup/process scans were run across `src`, `tests`, `docs`, `README.md`, `CHANGELOG.md`, `package.json`, and `scripts`. Matches were expected historical guardrails/tests/docs, provider-local internals, existing lifecycle cleanup/process behavior, and the new fixture-safe `install:check` surface. M44 introduced no API-key fallback, bypass-permission path, live provider call, public provider-specific MCP schema, hidden prompt exposure, secret/session/payload leakage, benchmark/model-quality claim, automatic cleanup shortcut, or process-kill shortcut.
