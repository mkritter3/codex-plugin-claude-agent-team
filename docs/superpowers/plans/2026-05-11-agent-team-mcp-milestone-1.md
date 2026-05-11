# Agent Team MCP Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working, tested Agent Team MCP package: provider-neutral core, Claude Code CLI command construction, durable sidecars/mailboxes, verdict parsing, doctor diagnostics, plugin manifest, and CI.

**Architecture:** A TypeScript Node package exposes an MCP stdio server while keeping orchestration logic in provider-neutral modules under `src/core`. The first provider adapter is `claude-code-cli`, but it only implements command construction and output parsing in this milestone; live dispatch and background process supervision are deferred to Milestone 2. State is written atomically under `.agent-team/` in target workspaces, with append-only mailbox records and normalized run sidecars.

**Tech Stack:** TypeScript, Node.js ESM, `@modelcontextprotocol/sdk@1.29.0`, Vitest, tsx, npm, GitHub Actions.

---

## File Structure

- Create `package.json`: scripts, dependencies, package metadata, bin entry.
- Create `tsconfig.json`: strict ESM TypeScript settings.
- Create `vitest.config.ts`: unit test config.
- Create `.gitignore`: dependencies, build output, local state, isolated worktrees.
- Create `.github/workflows/ci.yml`: install, typecheck, test.
- Create `.codex-plugin/plugin.json`: Codex plugin metadata.
- Create `.mcp.json`: local MCP server definition pointing at the built CLI.
- Create `src/index.ts`: MCP stdio entrypoint.
- Create `src/mcp/server.ts`: MCP server and tool registration.
- Create `src/mcp/tools.ts`: tool schemas and tool handlers.
- Create `src/core/types.ts`: shared run, provider, role, capability, verdict, state types.
- Create `src/core/errors.ts`: typed domain errors.
- Create `src/core/roles.ts`: role registry and capability requirements.
- Create `src/core/router.ts`: provider selection and fail-closed capability validation.
- Create `src/core/verdict.ts`: verdict parser and formatter.
- Create `src/core/state/paths.ts`: workspace-local `.agent-team` path helpers.
- Create `src/core/state/atomic-json.ts`: atomic JSON write/read helpers.
- Create `src/core/state/run-store.ts`: sidecar persistence.
- Create `src/core/state/mailbox-store.ts`: append-only mailbox persistence.
- Create `src/providers/claude-code-cli/types.ts`: provider config types.
- Create `src/providers/claude-code-cli/commands.ts`: safe `claude -p` command construction.
- Create `src/providers/claude-code-cli/output.ts`: JSON and stream-json output normalization.
- Create `src/providers/claude-code-cli/doctor.ts`: Claude CLI/auth/env diagnostics.
- Create `src/providers/index.ts`: provider registry factory.
- Create `src/doctor.ts`: aggregate doctor report.
- Create `src/utils/json.ts`: JSON schema-ish helpers without adding heavy dependencies.
- Create tests mirroring modules under `tests/`.

## Success Criteria

- `npm run typecheck` passes.
- `npm test` passes.
- CI runs typecheck and tests without live Claude auth.
- `npm run build` emits `dist/index.js`.
- `agent_team_list_roles` returns stable role/capability data.
- `agent_team_list_providers` returns the Claude CLI provider declaration.
- `agent_team_doctor` reports missing Claude CLI without crashing and reports env-precedence warnings when auth override variables exist.
- Verdict parser handles `SHIP`, `REVISE`, `BLOCKED`, and malformed output.
- Run sidecars write atomically and can be read back.
- Mailboxes append monotonic JSONL records and detect invalid/corrupt records.
- Claude command construction never uses `--bare` unless explicitly enabled.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.github/workflows/ci.yml`
- Create: `.codex-plugin/plugin.json`
- Create: `.mcp.json`

- [ ] **Step 1: Create package and tooling files**

Create `package.json`:

```json
{
  "name": "codex-plugin-claude-agent-team",
  "version": "0.1.0",
  "description": "Codex MCP plugin for provider-neutral AI agent teams with Claude Code CLI as the first adapter.",
  "type": "module",
  "private": true,
  "bin": {
    "agent-team-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "tsx src/index.ts",
    "ci": "npm run typecheck && npm test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "rootDir": ".",
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true,
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
  "exclude": ["dist", "node_modules", ".worktrees", ".agent-team"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true
  }
});
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
.agent-team/
.worktrees/
coverage/
*.log
```

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

Create `.codex-plugin/plugin.json`:

```json
{
  "name": "codex-plugin-claude-agent-team",
  "version": "0.1.0",
  "description": "Provider-neutral agent team MCP plugin for Codex with Claude Code CLI subscription support.",
  "author": {
    "name": "mkritter3",
    "url": "https://github.com/mkritter3"
  },
  "homepage": "https://github.com/mkritter3/codex-plugin-claude-agent-team",
  "repository": "https://github.com/mkritter3/codex-plugin-claude-agent-team",
  "license": "MIT",
  "keywords": ["codex", "mcp", "agents", "claude-code"],
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Agent Team",
    "shortDescription": "Delegate Codex work to provider-routed AI agent teams.",
    "longDescription": "A Codex MCP plugin that routes agent roles through provider adapters, starting with Claude Code CLI subscription-backed runs.",
    "developerName": "mkritter3",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "websiteURL": "https://github.com/mkritter3/codex-plugin-claude-agent-team",
    "defaultPrompt": [
      "Ask Claude to review this diff.",
      "Run an agent-team doctor check.",
      "List available agent roles."
    ],
    "brandColor": "#111827"
  }
}
```

Create `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-team": {
      "command": "node",
      "args": ["./dist/index.js"]
    }
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and npm completes without dependency resolution errors.

- [ ] **Step 3: Run baseline typecheck**

Run: `npm run typecheck`

Expected: FAIL because no `src` files exist yet. This verifies tooling is wired.

- [ ] **Step 4: Commit scaffold**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .github/workflows/ci.yml .codex-plugin/plugin.json .mcp.json
git commit -m "chore: scaffold agent team MCP package"
```

## Task 2: Core Types, Roles, And Router

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/errors.ts`
- Create: `src/core/roles.ts`
- Create: `src/core/router.ts`
- Test: `tests/core/roles.test.ts`
- Test: `tests/core/router.test.ts`

- [ ] **Step 1: Write failing role and router tests**

Create `tests/core/roles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getRole, listRoles } from "../../src/core/roles.js";

describe("role registry", () => {
  it("lists stable provider-neutral roles with capability requirements", () => {
    const roles = listRoles();
    expect(roles.map((role) => role.id)).toEqual([
      "architect",
      "planner",
      "code-reviewer",
      "debugger",
      "test-designer",
      "slice-implementer",
      "ux-product-critic"
    ]);
    expect(getRole("slice-implementer").requiredCapabilities).toContain("edits");
    expect(getRole("code-reviewer").requiredCapabilities).toContain("structuredOutput");
  });
});
```

Create `tests/core/router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProviderCapabilityError } from "../../src/core/errors.js";
import { selectProvider } from "../../src/core/router.js";
import type { AgentProviderDescriptor } from "../../src/core/types.js";

const readonlyProvider: AgentProviderDescriptor = {
  id: "readonly-provider",
  displayName: "Read Only",
  authMode: "api-key",
  capabilities: ["structuredOutput", "longContext"],
  available: true
};

const toolProvider: AgentProviderDescriptor = {
  id: "tool-provider",
  displayName: "Tool Provider",
  authMode: "subscription-oauth",
  capabilities: ["structuredOutput", "tools", "edits", "sessionResume", "cancellation", "workspaceIsolation"],
  available: true
};

describe("selectProvider", () => {
  it("selects a provider that satisfies the role capabilities", () => {
    const selected = selectProvider({
      roleId: "code-reviewer",
      providers: [readonlyProvider, toolProvider]
    });
    expect(selected.id).toBe("readonly-provider");
  });

  it("fails closed when no provider satisfies implementation capabilities", () => {
    expect(() =>
      selectProvider({
        roleId: "slice-implementer",
        providers: [readonlyProvider]
      })
    ).toThrow(ProviderCapabilityError);
  });

  it("honors requested provider only after capability validation", () => {
    const selected = selectProvider({
      roleId: "slice-implementer",
      requestedProviderId: "tool-provider",
      providers: [readonlyProvider, toolProvider]
    });
    expect(selected.id).toBe("tool-provider");
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/core/roles.test.ts tests/core/router.test.ts`

Expected: FAIL with module resolution errors for missing `src/core/*` files.

- [ ] **Step 3: Implement core types, roles, and router**

Create `src/core/types.ts`, `src/core/errors.ts`, `src/core/roles.ts`, and `src/core/router.ts` with strict unions for capabilities, roles, auth modes, provider descriptors, and run requests. The router must compute missing capabilities and throw `ProviderCapabilityError` instead of falling back.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/core/roles.test.ts tests/core/router.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core tests/core
git commit -m "feat: add provider-neutral role router"
```

## Task 3: Verdict Parser

**Files:**
- Create: `src/core/verdict.ts`
- Test: `tests/core/verdict.test.ts`

- [ ] **Step 1: Write failing verdict tests**

Create `tests/core/verdict.test.ts` with cases for `SHIP`, `REVISE`, `BLOCKED`, lowercase rejection, missing blocks, and preservation of raw malformed output.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/core/verdict.test.ts`

Expected: FAIL because `src/core/verdict.ts` does not exist.

- [ ] **Step 3: Implement parser**

Create `parseVerdict(raw: string)` that extracts exactly one `<<<VERDICT>>>...<<<END_VERDICT>>>` block, accepts only uppercase statuses, parses list sections, and returns `INCONCLUSIVE` with warnings for malformed output.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/core/verdict.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/verdict.ts tests/core/verdict.test.ts
git commit -m "feat: add structured verdict parser"
```

## Task 4: State Stores

**Files:**
- Create: `src/core/state/paths.ts`
- Create: `src/core/state/atomic-json.ts`
- Create: `src/core/state/run-store.ts`
- Create: `src/core/state/mailbox-store.ts`
- Test: `tests/core/state/run-store.test.ts`
- Test: `tests/core/state/mailbox-store.test.ts`

- [ ] **Step 1: Write failing state tests**

Create tests that use `fs.mkdtemp` under `os.tmpdir()`, write/read a run sidecar, append mailbox records, verify sequence numbers are monotonic, and verify corrupt JSONL throws a typed error.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/core/state/run-store.test.ts tests/core/state/mailbox-store.test.ts`

Expected: FAIL because state modules do not exist.

- [ ] **Step 3: Implement state modules**

Implement `.agent-team` path helpers, atomic JSON writes using temporary files plus rename, run sidecar reads/writes, mailbox append/read helpers, and typed corruption errors.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/core/state/run-store.test.ts tests/core/state/mailbox-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/state tests/core/state
git commit -m "feat: add run sidecar and mailbox stores"
```

## Task 5: Claude Code CLI Provider Foundation

**Files:**
- Create: `src/providers/claude-code-cli/types.ts`
- Create: `src/providers/claude-code-cli/commands.ts`
- Create: `src/providers/claude-code-cli/output.ts`
- Create: `src/providers/claude-code-cli/doctor.ts`
- Create: `src/providers/index.ts`
- Test: `tests/providers/claude-code-cli/commands.test.ts`
- Test: `tests/providers/claude-code-cli/output.test.ts`
- Test: `tests/providers/claude-code-cli/doctor.test.ts`

- [ ] **Step 1: Write failing provider tests**

Create tests proving command construction uses `claude -p`, includes JSON output format, includes allowed/disallowed tools, includes `--resume` when session id is present, rejects `--bare` unless explicitly enabled, parses Claude JSON `session_id`, and warns when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` exists in subscription mode.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/providers/claude-code-cli`

Expected: FAIL because provider modules do not exist.

- [ ] **Step 3: Implement provider foundation**

Implement pure command-building and output parsing functions. Implement doctor helpers that accept injected env/path/version functions so unit tests do not require live Claude auth.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/providers/claude-code-cli`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers tests/providers
git commit -m "feat: add Claude Code CLI provider foundation"
```

## Task 6: MCP Server And Tools

**Files:**
- Create: `src/index.ts`
- Create: `src/mcp/server.ts`
- Create: `src/mcp/tools.ts`
- Create: `src/doctor.ts`
- Create: `src/utils/json.ts`
- Test: `tests/mcp/tools.test.ts`
- Test: `tests/doctor.test.ts`

- [ ] **Step 1: Write failing MCP/doctor tests**

Create tests for `agent_team_list_roles`, `agent_team_list_providers`, `agent_team_doctor`, and tool handler JSON payload shape. Tests should call handlers directly, not spawn a real MCP process.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -- tests/mcp/tools.test.ts tests/doctor.test.ts`

Expected: FAIL because MCP modules do not exist.

- [ ] **Step 3: Implement MCP server and handlers**

Implement stdio MCP entrypoint, tool registration, direct handler exports for tests, aggregate doctor result, and JSON content responses. Do not implement live dispatch in this milestone; return a clear `not_implemented` result for dispatch/start/reply/message/status/cancel/wind-down tools with stable schemas.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/mcp/tools.test.ts tests/doctor.test.ts`

Expected: PASS.

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: PASS and `dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/mcp src/doctor.ts src/utils tests/mcp tests/doctor.test.ts
git commit -m "feat: expose agent team MCP tools"
```

## Task 7: Final Verification And Push

**Files:**
- Modify only if verification finds issues.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
git status --short
```

Expected: typecheck/test/build pass and only intentional generated files are present.

- [ ] **Step 2: Review plan/spec coverage**

Verify Milestone 1 covers the scaffold, core contracts, role registry, router, sidecars, mailboxes, verdict parser, Claude CLI command construction, doctor, MCP tool surface, tests, and CI. Confirm deferred work is limited to live dispatch, background process supervision, cancellation implementation, worktree implementers, and future non-Claude providers.

- [ ] **Step 3: Push branch**

Run:

```bash
git push -u origin <implementation-branch>
```

Expected: branch pushes successfully.

