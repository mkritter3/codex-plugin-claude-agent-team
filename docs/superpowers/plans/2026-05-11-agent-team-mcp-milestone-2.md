# Agent Team MCP Milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agent_team_dispatch` execute real read-only Claude Code CLI runs through the provider-neutral orchestration path, persist sidecars/mailboxes/logs, parse verdicts, and expose `agent_team_status`.

**Architecture:** Add a synchronous dispatch orchestrator that routes a read-only role to `claude-code-cli`, builds a verdict-enforcing prompt, runs `claude -p --output-format json`, writes raw logs plus run sidecars, appends mailbox lifecycle events, and returns normalized structured content. The process runner is injectable for tests, so CI validates dispatch behavior without live Claude auth while production uses the real Claude Code CLI and subscription OAuth context.

**Tech Stack:** TypeScript, Node.js ESM, `child_process.execFile`, existing MCP SDK, Vitest.

---

## File Structure

- Modify `src/core/types.ts`: add dispatch request/result types and log paths.
- Modify `src/core/state/paths.ts`: add log directory/path helpers.
- Create `src/core/run-ids.ts`: run id and prompt hash helpers.
- Create `src/core/prompts.ts`: provider-neutral role prompt builder with required verdict block.
- Create `src/core/dispatch.ts`: read-only dispatch orchestrator.
- Create `src/providers/claude-code-cli/runner.ts`: real `claude -p` process runner with injectable exec.
- Modify `src/mcp/tools.ts`: wire real `agent_team_dispatch` and `agent_team_status`.
- Modify `src/utils/json.ts`: keep response typing stable if needed.
- Add tests under `tests/core`, `tests/providers/claude-code-cli`, and `tests/mcp`.

## Success Criteria

- `agent_team_dispatch` runs read-only roles through the orchestrator.
- `agent_team_dispatch` rejects non-read-only roles in this milestone without invoking Claude.
- Dispatch writes `.agent-team/runs/<run-id>.json`.
- Dispatch appends mailbox lifecycle events.
- Dispatch writes `.agent-team/logs/<run-id>.log` with raw provider output.
- Dispatch parses the verdict from Claude output and returns structured status.
- `agent_team_status` reads the persisted sidecar by run id.
- CLI execution is injectable in tests; CI does not require live Claude auth.
- Production runner uses `claude -p --output-format json` and never `--bare`.
- Production read-only dispatch uses a read-only Claude profile: no accept-edits mode, no bypass mode, no edit-oriented tool allowlist.
- Dispatch validates `role`, `task`, `cwd`, `provider`, and `timeoutMs` before invoking a provider.
- Dispatch blocks subscription-mode runs when API-key override variables are present unless an explicit future config allows them.
- Plugin metadata does not advertise write capability until implementation roles are actually shipped.
- `npm run typecheck`, `npm test`, and `npm run build` pass.

## Task 1: Dispatch Types, Paths, And Prompt Builder

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/state/paths.ts`
- Create: `src/core/run-ids.ts`
- Create: `src/core/prompts.ts`
- Test: `tests/core/prompts.test.ts`
- Test: `tests/core/run-ids.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests proving:

- run ids start with `run_` and are unique across repeated calls
- prompt hashes are stable for identical strings
- read-only role prompts include role identity, task, cwd, provider-neutral constraints, and the exact `<<<VERDICT>>>` protocol
- prompts explicitly forbid file mutation for read-only dispatch

Run: `npm test -- tests/core/prompts.test.ts tests/core/run-ids.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 2: Implement types and helpers**

Add dispatch types:

```ts
export interface AgentDispatchRequest {
  readonly role: RoleId;
  readonly task: string;
  readonly cwd: string;
  readonly provider?: string;
  readonly timeoutMs?: number;
}

export interface AgentDispatchResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly provider: string;
  readonly role: RoleId;
  readonly verdict: ParsedVerdict;
  readonly sidecarPath: string;
  readonly logPath: string;
}
```

Add log helpers:

```ts
export function logsDir(workspaceRoot: string): string;
export function runLogPath(workspaceRoot: string, runId: string): string;
```

Create:

```ts
export function createRunId(now?: Date): string;
export function hashPrompt(prompt: string): string;
export function buildRolePrompt(input: { role: AgentRole; task: string; cwd: string }): string;
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/core/prompts.test.ts tests/core/run-ids.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core tests/core
git commit -m "feat: add dispatch prompt and run id helpers"
```

## Task 2: Claude CLI Runner

**Files:**
- Create: `src/providers/claude-code-cli/runner.ts`
- Modify: `src/providers/claude-code-cli/types.ts`
- Test: `tests/providers/claude-code-cli/runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create tests proving:

- runner calls `claude` with args from `buildClaudeCommand`
- runner passes `cwd`
- runner returns parsed `sessionId`, text, raw stdout, raw stderr, and exit code
- runner records non-zero exits as typed failures
- runner supports timeout argument without requiring real timers
- read-only runner profile never uses `acceptEdits`, `bypassPermissions`, or `--bare`

Run: `npm test -- tests/providers/claude-code-cli/runner.test.ts`

Expected: FAIL because `runner.ts` does not exist.

- [ ] **Step 2: Implement runner**

Implement:

```ts
export interface ClaudeProcessResult {
  readonly ok: boolean;
  readonly sessionId?: string;
  readonly text: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type ExecFileLike = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string; stderr: string }>;

export async function runClaudePrint(input: {
  readonly prompt: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly execFile?: ExecFileLike;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<ClaudeProcessResult>;
```

The default runner uses `child_process.execFile` via `promisify`. It builds the command with `outputFormat: "json"` and `permissionMode: "default"`. It must not pass `bare`.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/providers/claude-code-cli/runner.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/providers/claude-code-cli tests/providers/claude-code-cli
git commit -m "feat: add Claude Code CLI process runner"
```

## Task 3: Read-Only Dispatch Orchestrator

**Files:**
- Create: `src/core/dispatch.ts`
- Modify: `src/core/state/run-store.ts` if status helpers are useful
- Test: `tests/core/dispatch.test.ts`

- [ ] **Step 1: Write failing dispatch tests**

Create tests proving:

- read-only dispatch writes queued/running/completed sidecar states
- completed dispatch stores provider session id, prompt hash, parsed verdict, evidence path, log path, and output summary
- dispatch appends `events` mailbox records for queued/running/completed
- dispatch writes raw provider stdout/stderr to log file
- malformed verdict returns `completed` with `INCONCLUSIVE`
- provider failure writes `failed` sidecar and returns a failed result
- `slice-implementer` is rejected with a clear unsupported milestone result before provider execution
- subscription-mode dispatch refuses to run when `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is present in the provided environment
- provider availability is checked before routing, so a missing Claude CLI does not get selected for live dispatch

Run: `npm test -- tests/core/dispatch.test.ts`

Expected: FAIL because `dispatch.ts` does not exist.

- [ ] **Step 2: Implement dispatch orchestrator**

Implement:

```ts
export interface DispatchDependencies {
  readonly providers?: readonly AgentProviderDescriptor[];
  readonly runClaude?: typeof runClaudePrint;
  readonly now?: () => Date;
  readonly createRunId?: () => string;
}

export async function dispatchReadOnlyAgent(
  request: AgentDispatchRequest,
  deps?: DispatchDependencies
): Promise<AgentDispatchResult>;
```

Rules:

- role must exist
- role `defaultReadOnly` must be true
- provider routing goes through `selectProvider`
- provider must be `claude-code-cli` in this milestone
- provider must be available according to injected health/availability
- subscription OAuth auth-precedence warnings are blocking for live dispatch in this milestone
- write initial sidecar before provider execution
- append lifecycle events through mailbox store
- build prompt through `buildRolePrompt`
- execute through injected `runClaude`
- write raw logs
- parse verdict from provider text
- write terminal sidecar for completed or failed state

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/core/dispatch.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core tests/core/dispatch.test.ts
git commit -m "feat: add read-only dispatch orchestrator"
```

## Task 4: MCP Tool Wiring For Dispatch And Status

**Files:**
- Modify: `src/mcp/tools.ts`
- Test: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Extend tests to prove:

- `agent_team_dispatch` calls the dispatcher and returns run id, status, provider, role, verdict, sidecar path, and log path
- `agent_team_dispatch` accepts `role`, `task`, optional `cwd`, optional `provider`, and optional `timeoutMs`
- `cwd` defaults to `process.cwd()`
- invalid dispatch args return structured validation errors without invoking the dispatcher
- `agent_team_status` reads a sidecar for a run id
- missing `runId` for status returns a structured validation error
- start/reply/message/cancel/wind-down remain `not_implemented`

Run: `npm test -- tests/mcp/tools.test.ts`

Expected: FAIL until tools are wired to dispatch/status.

- [ ] **Step 2: Implement tool dependencies and handlers**

Refactor tools so tests can inject dependencies:

```ts
export interface ToolDependencies {
  readonly dispatch?: typeof dispatchReadOnlyAgent;
  readonly cwd?: () => string;
}

export function createToolHandlers(deps?: ToolDependencies): {
  handleToolCall(name: ToolName, args: Record<string, unknown>): Promise<JsonToolResult>;
};
```

Keep the existing exported `handleToolCall` as the default production handler.

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/mcp/tools.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: wire dispatch and status MCP tools"
```

## Task 5: Verification And Merge Choice

**Files:**
- Modify: `.codex-plugin/plugin.json`

- [ ] **Step 1: Narrow plugin metadata capability**

Remove `"Write"` from `.codex-plugin/plugin.json` capabilities for Milestone 2. The plugin can restore write capability when `slice-implementer` ships.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
git status --short
```

Expected: typecheck/test/build pass and worktree is clean.

- [ ] **Step 3: Push implementation branch**

Run:

```bash
git push -u origin feature/milestone-2-live-dispatch
```

Expected: branch pushes successfully.

- [ ] **Step 4: Present integration options**

Offer:

1. merge back to `main` locally
2. create PR
3. keep branch as-is
4. discard
