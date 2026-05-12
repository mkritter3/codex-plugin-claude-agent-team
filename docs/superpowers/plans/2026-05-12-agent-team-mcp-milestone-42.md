# Agent Team MCP Milestone 42 Release Channel And Upgrade Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** Make local package upgrades boring by adding version-aware config/state checks, package smoke coverage, and release notes that explain compatibility and migrations.

**Architecture:** M42 keeps the MCP tool surface unchanged and adds upgrade safety below it: config parsing rejects unsupported future schema versions, state layout inspection reports missing/current/future/corrupt layout markers through doctor, and a package dry-run smoke verifies the built installable shape. Release documentation becomes the compatibility source of truth for MCP tools, providers, config schema, state layout, and migration posture.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing config loader, existing doctor, `npm pack --dry-run --json`, package scripts, docs tests, L11 invariant scans.

---

## Scope

**Create:**

- `src/core/state/layout.ts`
- `tests/core/state/layout.test.ts`
- `scripts/smoke-package.mjs`
- `tests/package-smoke.test.ts`
- `docs/releases/0.1.0.md`

**Modify:**

- `src/core/config.ts`
- `src/core/types.ts`
- `src/doctor.ts`
- `package.json`
- `tests/core/config.test.ts`
- `tests/doctor.test.ts`
- `tests/docs/packaging.test.ts`
- `README.md`
- `CHANGELOG.md`
- `docs/runbooks/claude-team-session.md`
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-42.md`

## Non-Goals

- Do not publish the package or create a GitHub release.
- Do not mutate user workspaces or auto-write migration markers in doctor.
- Do not add a public MCP migration tool in this milestone.
- Do not change public MCP schemas or provider adapter behavior.
- Do not add live-provider smoke or make provider/model-quality claims.

## Contracts

### Config Schema Version

Add this exported constant and field:

```ts
export const AGENT_TEAM_CONFIG_SCHEMA_VERSION = 1;

export interface AgentTeamConfig {
  readonly schemaVersion: 1;
  // existing fields stay unchanged
}
```

Parsing rules:

- Missing `schemaVersion` means version `1`.
- `schemaVersion: 1` is accepted.
- Non-integer, zero, negative, or unsupported future versions throw `AgentTeamConfigError`.
- The parser must not silently downgrade a future config.

### State Layout Version

Add a read-only inspector for `.agent-team/state-layout.json`:

```ts
export const AGENT_TEAM_STATE_LAYOUT_VERSION = 1;

export interface StateLayoutStatus {
  readonly status: "missing" | "compatible" | "incompatible" | "corrupt";
  readonly currentVersion: 1;
  readonly observedVersion?: number;
  readonly path: string;
  readonly message: string;
}
```

Rules:

- Missing marker is compatible for existing workspaces and reports `status: "missing"`.
- Marker with `layoutVersion: 1` reports `status: "compatible"`.
- Marker with a future integer reports `status: "incompatible"` and doctor fails.
- Invalid JSON or invalid `layoutVersion` reports `status: "corrupt"` and doctor fails.
- Inspector is read-only; it never repairs, migrates, archives, or deletes state.

### Package Smoke

Add `npm run smoke:package`:

```json
{
  "scripts": {
    "smoke:package": "node scripts/smoke-package.mjs"
  }
}
```

The script must:

- Run after `npm run build`.
- Execute `npm pack --dry-run --json`.
- Verify the package includes `package.json`, `dist/index.js`, `.codex-plugin/plugin.json`, `README.md`, `CHANGELOG.md`, and `LICENSE`.
- Verify `package.json` declares bin `agent-team-mcp` as `./dist/index.js`.
- Verify `.mcp.json` and package bin both point at the built entrypoint.
- Avoid network access and avoid installing dependencies.

Update `npm run ci` to include `npm run smoke:package` after packaged stdio smoke.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for config schema, state layout, doctor, package smoke, and docs.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases selected: input validation, packaged runtime, docs/examples, state stores, auth/provider-neutrality boundary scans.
- [x] Invariant scans are listed.
- [x] Live provider smoke is not required because M42 makes package/config/state compatibility claims only and no live-provider readiness or model-quality claims.

## Success Criteria

- Config loader accepts missing/current schema version and rejects unsupported future or invalid versions.
- Doctor reports config schema and state layout posture without mutating state.
- Future or corrupt state layout markers fail doctor with actionable details.
- Package smoke validates installable package shape using built artifacts and dry-run packaging.
- `npm run ci` includes typecheck, tests, build, stdio smoke, and package smoke.
- README, runbook, changelog, release note, and roadmap document release/upgrade safety.
- No public MCP schema exposes internal prompts, provider command internals, state migration internals, or provider-specific implementation details.

## Task 1: Red Tests For Config Schema Version

**Files:**

- Modify: `tests/core/config.test.ts`
- Modify: `src/core/config.ts`
- Modify: `src/core/types.ts`

- [x] **Step 1: Add failing config tests**

Add tests proving:

```ts
expect(await loadAgentTeamConfig(workspace)).toMatchObject({ schemaVersion: 1 });
await writeConfig(workspace, { schemaVersion: 1 });
await expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({ schemaVersion: 1 });
await writeConfig(workspace, { schemaVersion: 2 });
await expect(loadAgentTeamConfig(workspace)).rejects.toThrow("Unsupported config schemaVersion");
await writeConfig(workspace, { schemaVersion: "1" });
await expect(loadAgentTeamConfig(workspace)).rejects.toThrow("schemaVersion must be an integer");
```

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/core/config.test.ts
```

Expected red: `schemaVersion` is missing and invalid versions are not rejected.

- [x] **Step 3: Implement minimal config support**

Add `AGENT_TEAM_CONFIG_SCHEMA_VERSION = 1`, `schemaVersion: 1` to `AgentTeamConfig`, and a strict parser that accepts missing/current version only.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/core/config.test.ts
```

Expected green: config tests pass.

## Task 2: Red Tests For State Layout Inspection

**Files:**

- Create: `tests/core/state/layout.test.ts`
- Create: `src/core/state/layout.ts`
- Modify: `src/core/state/paths.ts`

- [x] **Step 1: Add failing state layout tests**

Create tests for:

- missing `.agent-team/state-layout.json` returns `status: "missing"` and `currentVersion: 1`
- `{ "layoutVersion": 1 }` returns `status: "compatible"`
- `{ "layoutVersion": 2 }` returns `status: "incompatible"`
- malformed JSON returns `status: "corrupt"`
- invalid `layoutVersion` type returns `status: "corrupt"`

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/core/state/layout.test.ts
```

Expected red: layout module and path helper do not exist.

- [x] **Step 3: Implement read-only layout inspector**

Add `stateLayoutPath(workspaceRoot)` to `src/core/state/paths.ts` and implement `inspectStateLayout(workspaceRoot)` in `src/core/state/layout.ts`.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/core/state/layout.test.ts
```

Expected green: layout inspector tests pass.

## Task 3: Doctor Upgrade Safety Checks

**Files:**

- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`

- [x] **Step 1: Add failing doctor tests**

Add tests proving:

- Doctor reports `config-schema` pass with `schemaVersion: 1`.
- Doctor reports `state-layout` pass or warn for missing/current layout.
- Doctor fails for future state layout with `reason: "state_layout_incompatible"`.
- Doctor fails for corrupt state layout with `reason: "state_layout_corrupt"`.

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/doctor.test.ts
```

Expected red: doctor has no config schema or state layout checks.

- [x] **Step 3: Implement doctor checks**

Add safe doctor checks after config load and writable-state check. Details must include version numbers and paths only; no prompts, provider commands, secrets, process ids, or raw state payloads.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/doctor.test.ts
```

Expected green: doctor tests pass.

## Task 4: Package Smoke Coverage

**Files:**

- Create: `scripts/smoke-package.mjs`
- Create: `tests/package-smoke.test.ts`
- Modify: `package.json`

- [x] **Step 1: Add failing package smoke tests**

Add tests proving package scripts contain `smoke:package`, `ci` runs it, and the script text checks required built/package artifacts.

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/package-smoke.test.ts tests/package-scripts.test.ts
```

Expected red: script and package script do not exist.

- [x] **Step 3: Implement package smoke**

Implement `scripts/smoke-package.mjs` using `child_process.execFileSync("npm", ["pack", "--dry-run", "--json"])` and JSON parsing. Throw clear errors for missing files or mismatched entrypoints.

- [x] **Step 4: Run green and script smoke**

Run:

```bash
npm test -- tests/package-smoke.test.ts tests/package-scripts.test.ts
npm run build
npm run smoke:package
```

Expected green: tests pass and package smoke passes after build.

## Task 5: Release Notes And Docs

**Files:**

- Create: `docs/releases/0.1.0.md`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [x] **Step 1: Add failing docs tests**

Extend docs tests to require:

- `docs/releases/0.1.0.md`
- `Config Schema Version`
- `State Layout Version`
- `MCP Tool Surface`
- `Provider Compatibility`
- `Migration Notes`
- `npm run smoke:package`

- [x] **Step 2: Run red**

Run:

```bash
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected red: release note and package smoke docs do not exist.

- [x] **Step 3: Update docs**

Add concise release notes and docs. State that M42 does not publish externally, does not auto-migrate, and keeps live provider smoke opt-in.

- [x] **Step 4: Run green**

Run:

```bash
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected green: docs tests pass.

## Task 6: Verification, Roadmap, And Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-42.md`

- [x] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/state/layout.test.ts tests/doctor.test.ts tests/package-smoke.test.ts tests/package-scripts.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
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
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|subscription OAuth|authMode" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison|ranking" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema|promptHash|providerSessionId|payload|secret|process id|command args|migration payload" src tests docs README.md CHANGELOG.md
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|auto-migrate|auto migrate|state-layout" src tests docs README.md CHANGELOG.md
```

- [x] **Step 4: Mark milestone complete**

Update this plan with red/green evidence and mark M42 complete in the roadmap only after proof is captured.

- [x] **Step 5: Commit implementation branch**

Run:

```bash
git diff --check
git status --short
git add src tests scripts package.json README.md CHANGELOG.md docs
git commit -m "feat: add release and upgrade safety checks"
```

## Verification Evidence

- Baseline before implementation: `npm test` passed with 51 files and 410 tests before M42 implementation work began.
- Red proof: config/state tests failed on missing schema/layout support; doctor tests failed on missing `config-schema` and `state-layout` checks; package/docs tests failed on missing `smoke:package`, missing package smoke script, missing release note, and missing docs text.
- Focused milestone proof: `npm test -- tests/core/config.test.ts tests/core/state/layout.test.ts tests/doctor.test.ts tests/package-smoke.test.ts tests/package-scripts.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts tests/core/lifecycle-registry.test.ts tests/core/lifecycle.test.ts tests/core/router.test.ts tests/mcp/tools.test.ts` passed with 11 files and 194 tests.
- Full proof: `npm run typecheck`, `npm test` with 53 files and 423 tests, and `npm run build` passed.
- Package smoke: `npm run smoke:mcp-stdio` passed, then `npm run smoke:package` initially exposed a global npm cache permission failure; the script now uses an isolated temporary npm cache, package contents are bounded by an explicit `files` allowlist, and `npm run smoke:package` passes.
- Invariant scans: auth/fallback, permission/bypass, model-claim, prompt/schema leakage, and cleanup/process scans were run. Matches were expected guardrails, tests, docs, provider-local internals, or pre-existing cleanup/process behavior. M42 introduced no API-key fallback, public provider-specific MCP schema, hidden prompt exposure, benchmark/model-quality behavior, automatic cleanup, or process-kill shortcut.
