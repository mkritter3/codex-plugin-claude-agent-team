# Agent Team MCP Milestone 48 Ollama Claude Code Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit Ollama Cloud profiles that route Claude Code through Ollama's Anthropic-compatible interface while reusing the validated Agent Team lifecycle.

**Architecture:** This is a provider-profile layer over the existing Claude Code session runtime, not a new implementation engine. The default `claude-code-cli` provider remains subscription OAuth and keeps blocking Anthropic override env vars; `ollama-claude-code:<profile>` providers are explicit opt-in profiles that launch Claude Code with scoped Anthropic-compatible Ollama environment only for that run.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing provider runtime registry, Claude Code CLI runtime, Ollama Cloud API key via environment, Anthropic-compatible Ollama endpoint, Agent Team lifecycle/mailbox/worktree contracts.

---

## File Structure

- Create: `src/providers/ollama-claude-code/config.ts`
  - Parse profile descriptors and build provider ids.
- Create: `tests/providers/ollama-claude-code/config.test.ts`
  - Cover disabled defaults, profile descriptors, duplicate ids, shared auth env, capabilities, warnings.
- Create: `src/providers/ollama-claude-code/runtime.ts`
  - Runtime wrapper around Claude Code launch behavior with scoped Ollama/Anthropic-compatible env.
- Create: `tests/providers/ollama-claude-code/runtime.test.ts`
  - Cover env scoping, health checks, start-session delegation, unsupported missing config, no subscription override weakening.
- Modify: `src/core/types.ts`
  - Add `ollamaClaudeCode` provider config with shared `baseUrl`, shared `apiKeyEnv`, optional `authToken`, and profiles.
- Modify: `src/core/config.ts`
  - Parse `providers.ollamaClaudeCode`.
- Modify: `src/providers/index.ts`
  - Add descriptors from `listOllamaClaudeCodeProviders(config)`.
- Modify: `src/providers/runtime.ts`
  - Route `ollama-claude-code:<profile>` ids to the Ollama Claude Code runtime.
- Modify: `src/doctor.ts`
  - Report provider readiness, shared auth env presence, profile count, and role routing.
- Modify: `README.md`, `CHANGELOG.md`, `docs/runbooks/claude-team-session.md`
  - Document opt-in config, single API key, profile ids, capabilities, and live proof requirements.
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
  - Mark Milestone 48 complete after implementation and verification.

## Config Shape

Workspace config should store profile metadata and environment variable names, not secret values:

```json
{
  "providers": {
    "ollamaClaudeCode": {
      "enabled": true,
      "baseUrl": "http://localhost:11434",
      "apiKeyEnv": "OLLAMA_API_KEY",
      "authToken": "ollama",
      "profiles": [
        {
          "id": "kimi-k2.6",
          "model": "kimi-k2.6:cloud",
          "displayName": "Kimi K2.6 via Claude Code",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true,
            "edits": false,
            "workspaceIsolation": false
          }
        },
        {
          "id": "glm-5.1",
          "model": "glm-5.1:cloud",
          "displayName": "GLM 5.1 via Claude Code",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true,
            "edits": false,
            "workspaceIsolation": false
          }
        },
        {
          "id": "deepseek-v4-flash",
          "model": "deepseek-v4-flash:cloud",
          "displayName": "DeepSeek V4 Flash via Claude Code",
          "capabilities": {
            "structuredOutput": true,
            "longContext": true,
            "tools": true,
            "sessionResume": true,
            "cancellation": true,
            "edits": false,
            "workspaceIsolation": false
          }
        }
      ]
    }
  }
}
```

Write-capable capabilities must remain false until Milestone 47-style live evidence proves each profile can safely satisfy isolated implementation, mailbox, wind-down, cancellation, cleanup, and source-checkout containment.

The API key value is configured once at plugin/MCP environment level:

```toml
[mcp_servers."agent-team".env]
OLLAMA_API_KEY = "..."
```

or inherited from the process environment that launches Codex.

## Success Criteria

- `claude-code-cli` subscription OAuth behavior is unchanged.
- Anthropic override env vars remain blocked for `claude-code-cli`.
- Ollama Claude Code profiles require explicit config and never appear from `OLLAMA_API_KEY` alone.
- Shared `apiKeyEnv` is configured once at provider level and reused by all profiles.
- Public MCP schemas remain provider-neutral.
- Provider descriptors expose only declared capabilities.
- Missing Ollama API key, missing base URL, missing profile model, duplicate profile ids, and unsupported capability declarations fail closed with doctor/config evidence.
- Runtime launches Claude Code with scoped env for Ollama profiles only:

```text
ANTHROPIC_BASE_URL=<configured baseUrl>
ANTHROPIC_AUTH_TOKEN=<configured authToken or ollama>
ANTHROPIC_API_KEY=
OLLAMA_API_KEY=<from env>
```

- No public MCP output prints secret values, raw env, provider endpoints, provider session ids, or command args.
- Live profile proof remains opt-in and excluded from CI.

## Task 1: Config And Descriptor TDD

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Create: `src/providers/ollama-claude-code/config.ts`
- Create: `tests/providers/ollama-claude-code/config.test.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/router.test.ts`

- [ ] **Step 1: Write failing config tests**

Add tests for:

```ts
expect(loadAgentTeamConfig(workspace)).resolves.toMatchObject({
  providers: {
    ollamaClaudeCode: {
      enabled: true,
      baseUrl: "http://localhost:11434",
      apiKeyEnv: "OLLAMA_API_KEY",
      profiles: [{ id: "glm-5.1", model: "glm-5.1:cloud" }]
    }
  }
});
```

Also assert duplicate profile ids and unsupported capability names throw `AgentTeamConfigError`.

- [ ] **Step 2: Write failing descriptor tests**

Assert disabled config returns no providers, enabled profiles produce provider ids:

```ts
ollama-claude-code:kimi-k2.6
ollama-claude-code:glm-5.1
ollama-claude-code:deepseek-v4-flash
```

- [ ] **Step 3: Run red tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/providers/ollama-claude-code/config.test.ts
```

Expected: fail because the config/runtime modules do not exist.

- [ ] **Step 4: Implement config parsing and descriptors**

Add `ollamaClaudeCode` defaults:

```ts
{
  enabled: false,
  baseUrl: undefined,
  apiKeyEnv: undefined,
  authToken: "ollama",
  profiles: []
}
```

Add provider descriptor helper functions:

```ts
export const OLLAMA_CLAUDE_CODE_PROVIDER_PREFIX = "ollama-claude-code";
export function ollamaClaudeCodeProviderId(profileId: string): string;
export function isOllamaClaudeCodeProviderId(providerId: string): boolean;
export function listOllamaClaudeCodeProviders(config: AgentTeamConfig): readonly AgentProviderDescriptor[];
```

- [ ] **Step 5: Run green tests**

Run the same focused test command. Expected: pass.

## Task 2: Runtime Wrapper And Health Checks

**Files:**
- Create: `src/providers/ollama-claude-code/runtime.ts`
- Create: `tests/providers/ollama-claude-code/runtime.test.ts`
- Modify: `src/providers/runtime.ts`
- Modify: `src/providers/index.ts`
- Modify: `tests/providers/runtime.test.ts`
- Modify: `tests/doctor.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Assert:

- `getProviderRuntime("ollama-claude-code:glm-5.1")` resolves.
- `inspectEnvironment` does not warn for `ANTHROPIC_API_KEY` because this provider intentionally scopes Anthropic-compatible env.
- `healthCheck` reports missing `OLLAMA_API_KEY` by env var name only.
- `startSession` passes scoped env to the shared Claude Code session starter.
- `claude-code-cli` tests still block `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`.

- [ ] **Step 2: Implement runtime wrapper**

Reuse Claude Code session semantics but resolve the selected profile first. Build scoped env from the incoming process env:

```ts
const token = input.env[providerConfig.apiKeyEnv];
const scopedEnv = {
  ...input.env,
  ANTHROPIC_BASE_URL: providerConfig.baseUrl,
  ANTHROPIC_AUTH_TOKEN: providerConfig.authToken ?? "ollama",
  ANTHROPIC_API_KEY: "",
  [providerConfig.apiKeyEnv]: token
};
```

The runtime must fail before provider start when required config or auth env is missing.

- [ ] **Step 3: Register runtime and descriptors**

Add the runtime to `DEFAULT_PROVIDER_RUNTIMES`, and route profile ids in `getProviderRuntime`.

- [ ] **Step 4: Add doctor checks**

Doctor should report:

```text
ollama-claude-code:<profile>:config
ollama-claude-code:<profile>:auth-env
ollama-claude-code:<profile>:routing
```

Details must include env var names and boolean presence, not secret values.

- [ ] **Step 5: Run focused runtime tests**

Run:

```bash
npm test -- tests/providers/runtime.test.ts tests/providers/ollama-claude-code/runtime.test.ts tests/doctor.test.ts
```

Expected: pass.

## Task 3: Lifecycle Integration And Safety Gates

**Files:**
- Modify: `tests/core/lifecycle-registry.test.ts`
- Modify: `tests/core/lifecycle.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/mcp/tools.test.ts`
- Modify: `scripts/smoke-mcp-stdio.mjs`

- [ ] **Step 1: Add failing lifecycle tests**

Assert that an Ollama Claude Code profile with only read/session/tool capabilities can start read-only lifecycle roles but cannot start `slice-implementer`.

Assert that `slice-implementer` can route only if that specific profile declares `edits` and `workspaceIsolation` and workspace write policy allows it.

- [ ] **Step 2: Run red tests**

Run:

```bash
npm test -- tests/core/lifecycle.test.ts tests/core/dispatch.test.ts tests/mcp/tools.test.ts
```

Expected: fail until runtime registration and descriptor capabilities are integrated.

- [ ] **Step 3: Implement minimal integration**

Ensure provider descriptors are included in `listProviders({ config })`, runtime registry resolves profile ids, and MCP tools remain schema-neutral.

- [ ] **Step 4: Update packaged stdio smoke if needed**

Keep smoke assertions provider-neutral. Do not add provider-specific public MCP schemas.

- [ ] **Step 5: Run green tests**

Run the same focused tests. Expected: pass.

## Task 4: Docs, Live Proof Harness, And Release Notes

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `CHANGELOG.md`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `scripts/live-smoke-readonly-providers.mjs`
- Modify: `tests/live-smoke-readonly-providers.test.ts`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`

- [ ] **Step 1: Add docs tests**

Require docs to mention:

```text
ollama-claude-code:kimi-k2.6
ollama-claude-code:glm-5.1
ollama-claude-code:deepseek-v4-flash
OLLAMA_API_KEY
single API key
ANTHROPIC_BASE_URL
Claude Code through Ollama
opt-in live proof
no provider ranking
```

- [ ] **Step 2: Update docs**

Document setup:

```toml
[mcp_servers."agent-team".env]
OLLAMA_API_KEY = "..."
```

Document workspace profile config and provider selectors. State that write-capable profile declarations require separate live proof before use.

- [ ] **Step 3: Extend live provider smoke dry-run**

Ensure `npm run smoke:providers-live -- --dry-run --provider ollama-claude-code:glm-5.1` reports the provider selector and limitations without calling providers.

- [ ] **Step 4: Run docs and smoke tests**

Run:

```bash
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts tests/live-smoke-readonly-providers.test.ts
```

Expected: pass.

## Verification Plan

Run before integration:

```bash
npm test -- tests/core/config.test.ts tests/core/router.test.ts tests/providers/ollama-claude-code/config.test.ts
npm test -- tests/providers/runtime.test.ts tests/providers/ollama-claude-code/runtime.test.ts tests/doctor.test.ts
npm test -- tests/core/lifecycle-registry.test.ts tests/core/lifecycle.test.ts tests/core/dispatch.test.ts tests/mcp/tools.test.ts
npm test -- tests/docs/packaging.test.ts tests/docs/runbook.test.ts tests/live-smoke-readonly-providers.test.ts
npm run typecheck
npm test
npm run build
npm run install:check
npm run smoke:mcp-stdio
npm run smoke:package
npm run ci
```

Optional operator-run live proof after Ollama is installed and authenticated:

```bash
npm run smoke:providers-live -- --dry-run --cwd /absolute/path/to/workspace --provider ollama-claude-code:glm-5.1
npm run smoke:providers-live -- --confirm-live-provider-use --cwd /absolute/path/to/workspace --provider ollama-claude-code:glm-5.1
```

Write-capable Ollama Claude Code proof must wait until Milestone 47 validates the current Claude control paths and a profile explicitly declares implementation capabilities.

## Self-Review

- Spec coverage: This plan covers single API key configuration, profile ids, Claude Code through Ollama, scoped env, provider-neutral MCP schemas, doctor, runtime registry, lifecycle safety, docs, and opt-in live proof.
- Placeholder scan: No TODO/TBD placeholders remain.
- Type consistency: Provider names, config keys, runtime names, and provider ids are consistent across tasks.
