# Agent Team MCP Milestone 32 Packaging And Release Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plugin installable and maintainable as a local Codex MCP tool with tested package metadata, onboarding docs, troubleshooting docs, and versioning policy.

**Architecture:** M32 is a packaging/documentation hardening slice, not a new runtime feature. README and changelog policy become the user-facing install and maintenance entrypoints, while docs tests pin required setup, auth, MCP config, workspace config, troubleshooting, release gate, and provider-neutral safety language. Package metadata is aligned with the plugin manifest and existing packaged stdio smoke remains the executable release gate.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, Markdown docs, npm package metadata, Codex plugin manifest, MCP runtime entrypoint, existing CI and stdio smoke scripts.

---

## Scope

**Files:**

- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`
- Create: `tests/docs/packaging.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tests/package-runtime.test.ts`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-32.md`

**Non-goals:**

- Do not add, rename, or remove MCP tools.
- Do not add `agent_team_cancel_many`.
- Do not publish to npm or make the repository public.
- Do not run live Claude sessions in CI.
- Do not change provider routing, lifecycle, sidecar, mailbox, verdict, cleanup, recovery, or worktree semantics.
- Do not add API-key fallback or suggest API-key fallback as an onboarding path.
- Do not expose internal prompts, hidden agent instructions, generated agent definitions, provider command internals, process ids, or secrets.
- Do not make benchmark, model-quality, or provider-comparison claims.

## L11 Quality Gates

- [x] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [x] TDD red proof is captured for packaging docs and metadata tests.
- [x] Focused milestone tests are listed with expected red and green outcomes.
- [x] Full verification commands are listed.
- [x] Required edge cases from the matrix are explicitly selected.
- [x] Invariant scans are listed.
- [x] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Scope and architecture: this plan names docs, metadata, package-runtime tests, non-goals, and success criteria.
- TDD red proof: tests fail before README, changelog, metadata, and roadmap updates are implemented.
- Documentation: README and changelog stand alone, do not depend on chat history, preserve opt-in live-provider language, and do not expose internal prompts.
- Packaged runtime: package bin, `.mcp.json`, plugin manifest, build output, smoke script, CI, and README install path stay aligned around `dist/index.js`.
- Auth posture: README keeps Claude Code CLI subscription OAuth primary and tells users to run doctor instead of suggesting fallback credentials.
- Provider neutrality: package/plugin metadata describes provider-neutral orchestration with Claude Code CLI as first adapter.
- Boundary scan: docs and metadata are scanned for fallback language, prompt leakage, provider-specific schema leakage, and model-quality claims.

Live provider smoke is not required for this milestone because M32 hardens local packaging and docs. Live Claude operation remains opt-in through the M31 runbook.

## Success Criteria

- `README.md` covers prerequisites, installation from the local repo, build, MCP config, Claude Code CLI subscription OAuth auth, `.agent-team/config.json` workspace config, doctor preflight, basic workflow, troubleshooting, evidence, cleanup, and release gate.
- `CHANGELOG.md` documents the current `0.1.0` baseline and the ongoing changelog/versioning policy.
- `LICENSE` contains the MIT license declared by package and plugin metadata.
- `package.json`, `package-lock.json`, `.codex-plugin/plugin.json`, `.mcp.json`, `scripts/smoke-mcp-stdio.mjs`, tests, and CI agree on the package name, version, repository, license, plugin manifest path, and runtime entrypoint.
- `tests/docs/packaging.test.ts` prevents README/changelog regressions and private implementation leakage.
- `tests/package-runtime.test.ts` verifies package metadata alignment with plugin metadata and `.mcp.json`.
- Roadmap baseline includes M31 completion and keeps M32 as the current completed milestone after implementation.
- No package or docs path suggests API-key fallback, exposes prompt internals, requires live Claude in CI, or makes model-quality claims.

## Task 1: Packaging Docs Guard Tests

**Files:**

- Create: `tests/docs/packaging.test.ts`

- [x] **Step 1: Write failing tests**

Create `tests/docs/packaging.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readText = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("packaging and install docs", () => {
  it("keeps README sufficient for local installation and operation", async () => {
    const readme = await readText("../../README.md");

    for (const text of [
      "Prerequisites",
      "Node.js 22",
      "Claude Code CLI subscription OAuth",
      "npm ci",
      "npm run build",
      "agent-team-mcp",
      "\"./dist/index.js\"",
      ".agent-team/config.json",
      "agent_team_doctor",
      "agent_team_start_parallel",
      "agent_team_summary",
      "agent_team_cleanup",
      "npm run ci",
      "Troubleshooting",
      "docs/runbooks/claude-team-session.md"
    ]) {
      expect(readme).toContain(text);
    }
    expect(readme).toContain("opt-in live smoke");
    expect(readme).toContain("not part of CI");
  });

  it("documents versioning and changelog policy", async () => {
    const changelog = await readText("../../CHANGELOG.md");

    expect(changelog).toContain("# Changelog");
    expect(changelog).toContain("0.1.0");
    expect(changelog).toContain("Versioning Policy");
    expect(changelog).toContain("MCP tool surface changes");
    expect(changelog).toContain("npm run ci");
  });

  it("keeps docs free of private implementation leakage and unsafe onboarding paths", async () => {
    const combined = `${await readText("../../README.md")}\n${await readText("../../CHANGELOG.md")}`;
    const forbiddenAuthPattern = new RegExp(
      ["ANTHROPIC" + "_API_KEY=.*", "ANTHROPIC" + "_AUTH_TOKEN=.*", "api[- ]key " + "fallback"].join("|"),
      "i"
    );
    const forbiddenPrivatePattern = new RegExp(
      ["internal " + "prompt", "hidden " + "instruction", "generated " + "agent definition", "bypass" + "Permissions", "process " + "id"].join("|"),
      "i"
    );
    const forbiddenClaimPattern = new RegExp(
      ["bench" + "mark", "quality " + "score", "model-quality " + "comparison"].join("|"),
      "i"
    );

    expect(combined).not.toMatch(forbiddenAuthPattern);
    expect(combined).not.toMatch(forbiddenPrivatePattern);
    expect(combined).not.toMatch(forbiddenClaimPattern);
  });
});
```

- [x] **Step 2: Run tests to verify red**

Run:

```bash
npm test -- tests/docs/packaging.test.ts
```

Expected: fail because `README.md` and `CHANGELOG.md` do not exist.

## Task 2: Package Metadata Alignment Tests

**Files:**

- Modify: `tests/package-runtime.test.ts`

- [x] **Step 1: Add failing package metadata assertions**

Add a test that reads `package.json`, `.codex-plugin/plugin.json`, and `.mcp.json` and expects:

- matching `name`
- matching `version`
- matching `repository`
- matching `homepage`
- matching `license`
- package `bin["agent-team-mcp"] === "./dist/index.js"`
- plugin `mcpServers === "./.mcp.json"`
- `.mcp.json` command/args are `node` and `./dist/index.js`

- [x] **Step 2: Run tests to verify red**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: fail because `package.json` does not yet expose repository, homepage, license, keywords, and plugin manifest path metadata.

## Task 3: README And Changelog

**Files:**

- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`

- [x] **Step 1: Add README**

Create `README.md` with standalone sections for:

- what the plugin is
- safety model
- prerequisites
- local installation
- MCP configuration
- Claude Code CLI subscription OAuth auth
- workspace config
- basic workflow
- evidence and cleanup
- troubleshooting
- release gate
- links to the runbook and roadmap

- [x] **Step 2: Add changelog**

Create `CHANGELOG.md` with:

- `# Changelog`
- `## 0.1.0`
- shipped v1 baseline capabilities through M31
- `## Versioning Policy`
- notes that MCP tool surface changes, provider compatibility, config shape, and state layout changes must be recorded
- `npm run ci` as the release gate

- [x] **Step 3: Add license**

Create `LICENSE` with the MIT license text and `Copyright (c) 2026 mkritter3`.

- [x] **Step 4: Run docs tests**

Run:

```bash
npm test -- tests/docs/packaging.test.ts
```

Expected: pass after README and changelog are complete.

## Task 4: Package Metadata And Roadmap

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [x] **Step 1: Align package metadata**

Add to `package.json`:

```json
{
  "homepage": "https://github.com/mkritter3/codex-plugin-claude-agent-team",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mkritter3/codex-plugin-claude-agent-team.git"
  },
  "license": "MIT",
  "keywords": ["codex", "mcp", "agents", "claude-code"],
  "codexPlugin": ".codex-plugin/plugin.json"
}
```

Then run `npm install --package-lock-only` so the root lockfile metadata records the declared license.

- [x] **Step 2: Refresh roadmap baseline**

Update the current baseline from `Completed through Milestone 30` to `Completed through Milestone 32`, add bullets for M31/M32 docs hardening, and update near-term recommendation to make M29 batch cancel the remaining V1 convenience item before V1.5 provider expansion.

- [x] **Step 3: Run package-runtime tests**

Run:

```bash
npm test -- tests/package-runtime.test.ts
```

Expected: pass after metadata alignment.

## Task 5: Plan Completion And Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-32.md`

- [x] **Step 1: Mark completed gates**

After implementation and verification, mark this plan’s L11 checklist and task checkboxes complete.

- [x] **Step 2: Run focused verification**

Commands:

```bash
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts tests/package-runtime.test.ts tests/package-scripts.test.ts
npm run typecheck
npm test
npm run build
node scripts/smoke-mcp-stdio.mjs
```

- [x] **Step 3: Run invariant scans**

Commands:

```bash
rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in|appropriate[ ]error[ ]handling|handle[ ]edge[ ]cases|write[ ]tests[ ]for|similar[ ]to" README.md CHANGELOG.md docs tests/docs
rg -n "api[- ]key fallback|ANTHROPIC_API_KEY=.*|ANTHROPIC_AUTH_TOKEN=.*|internal prompt|hidden instruction|generated agent definition|bypassPermissions|process id|quality score|model-quality comparison|benchmark" README.md CHANGELOG.md docs/runbooks tests/docs package.json .codex-plugin/plugin.json
rg -n "dist/index.js|agent-team-mcp|codexPlugin|mcpServers|npm run ci|smoke:mcp-stdio" README.md CHANGELOG.md package.json .codex-plugin/plugin.json .mcp.json tests scripts .github
```

- [x] **Step 4: Run full CI**

Command:

```bash
npm run ci
```

## Integration Plan

- Commit this plan on `main`.
- Create isolated worktree `.worktrees/milestone-32-packaging` on branch `codex/milestone-32-packaging`.
- Implement with TDD and keep red proof in terminal output.
- Merge the implementation branch to `main` only after focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass.
- Push `main`.
- Remove the temporary worktree and delete the temporary branch after successful merge.
