# Agent Team MCP Design

Date: 2026-05-11
Status: Draft for user review

## Purpose

Build a Codex-facing MCP plugin that lets Codex delegate work to an external team of AI agents while preserving Codex as the orchestrator and final integration authority. The first supported backend is Claude Code CLI because it can use the user's Claude subscription OAuth credentials. The foundation must remain provider-neutral so later adapters can route work to Ollama Cloud, Gemini, Grok, OpenAI-compatible, Anthropic-compatible, or other model providers without rewriting the orchestration layer.

## Non-Goals

- Do not build a Claude-only wrapper whose core abstractions assume Claude Code semantics.
- Do not use API billing paths by default when the user intends to use subscription-backed Claude Code.
- Do not mock LLM, embedding, or benchmark behavior for validation.
- Do not allow heuristic fallback for roles that require tool use, file edits, structured output, or resumable sessions.
- Do not expose provider-specific quirks directly through the Codex-facing MCP tools.

## Architecture

Codex talks to a local MCP server named `agent-team`. The MCP server owns routing, sessions, provider adapters, structured verdict parsing, and durable state. Provider adapters translate the shared agent contract into each runtime's concrete transport.

```text
Codex
  -> agent-team MCP server
      -> run orchestrator
      -> role registry
      -> provider router
      -> session store
      -> verdict parser
      -> providers
          -> claude-code-cli
          -> ollama-openai-compatible later
          -> ollama-anthropic-compatible later
          -> gemini later
          -> grok later
          -> generic-openai-compatible later
```

The v1 runtime path is:

```text
Codex MCP tool call
  -> agent-team MCP
  -> ClaudeCodeCliProvider
  -> claude -p --output-format json or stream-json
  -> Claude Code subscription OAuth credentials
```

The MCP server is the product boundary. Claude Code CLI is an adapter behind that boundary, not the plugin's identity.

## Core Contract

Every provider implements one shared contract:

```ts
interface AgentProvider {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  resume(request: AgentResumeRequest): Promise<AgentRunResult>;
  cancel(request: AgentCancelRequest): Promise<AgentCancelResult>;
  healthcheck(): Promise<ProviderHealth>;
}
```

`AgentRunRequest` includes:

- `role`: registry role such as `architect`, `planner`, `code-reviewer`, `debugger`, `test-designer`, `slice-implementer`, or `ux-product-critic`.
- `task`: bounded natural-language assignment.
- `cwd`: workspace root for file and command context.
- `files`: optional intended file scope.
- `permissions`: read-only, shell-read, edit, commit, or custom allowlist.
- `capabilityRequirements`: required features such as `tools`, `edits`, `sessionResume`, `structuredOutput`, `longContext`, `parallelDispatch`, or `reasoning`.
- `outputSchema`: optional JSON schema for structured results.
- `sessionId`: optional existing provider session.
- `timeoutMs`: hard runtime budget.

`AgentRunResult` includes:

- provider id and model id
- role
- session id, if supported
- transcript or bounded summary location
- parsed verdict
- structured output, if requested
- changed files, if any
- command/test evidence
- warnings and provider limitations

## MCP Tools

V1 exposes a narrow Codex-facing surface:

- `agent_team_dispatch`: run one role against one task.
- `agent_team_start`: start a durable role session.
- `agent_team_reply`: continue a durable session.
- `agent_team_message`: send a control message, clarification, or additional evidence to an active run.
- `agent_team_status`: inspect background run state.
- `agent_team_cancel`: terminate a background run.
- `agent_team_wind_down`: gracefully stop a run, harvest outputs, summarize state, and release resources.
- `agent_team_doctor`: verify transport, credentials, settings, capabilities, and writable state.
- `agent_team_list_roles`: list roles and required capabilities.
- `agent_team_list_providers`: list configured providers and health.

The MCP schema must not leak provider-specific prompts. It should expose roles, capabilities, routing policy, and evidence paths.

## Role Registry

Roles are provider-independent:

- `architect`: reviews source-of-truth ownership, system boundaries, shared pipelines, and long-term maintainability.
- `planner`: critiques implementation plans for sequencing, testability, hidden dependencies, and risk.
- `code-reviewer`: performs read-only review of diffs or targeted files.
- `debugger`: reviews root-cause hypotheses and asks for evidence before fixes.
- `test-designer`: designs meaningful tests, including benchmark integrity checks where relevant.
- `slice-implementer`: implements a bounded slice in an isolated workspace with explicit file ownership.
- `ux-product-critic`: reviews UI/product quality, density, copy, and workflow fit.

Each role declares required capabilities. For example, `code-reviewer` can run on read-only providers; `slice-implementer` requires file edit support, tool execution, workspace isolation, and cancellation. The router fails closed if no provider satisfies the role.

## Provider Routing

Routing is capability-driven, then policy-driven.

Default v1 policy:

- Use `claude-code-cli` for subscription-backed tool-using roles.
- Prefer read-only mode for review, planning, debugging, and test design unless edits are explicitly requested.
- Require isolated worktrees for `slice-implementer`.
- Never downgrade an implementation role to a text-only model provider.
- Never silently switch from subscription-backed Claude Code to API-key billing.

Future provider examples:

- `ollama-openai-compatible`: strong candidate for reviewer, planner, debugger, and second-opinion roles.
- `ollama-anthropic-compatible`: useful when integrating with tools expecting Anthropic Messages semantics.
- `gemini`: candidate for large-context review and broad codebase analysis.
- `grok`: candidate for second opinions, review, or research-like analysis where its adapter supports the required contract.

## Claude Code CLI Provider

The first adapter wraps `claude -p`.

Required behavior:

- Use `claude -p` with `--output-format json` for completed calls.
- Use `--output-format stream-json --verbose` for streaming/background calls when needed.
- Capture `session_id` and persist it in the sidecar.
- Use `--resume <session_id>` for follow-up calls.
- Use `--agents <json>` or project `.claude/agents/*.md` only through provider-owned generated configuration.
- Use `--allowedTools`, `--tools`, `--disallowedTools`, and permission mode according to the role's declared permissions.
- Avoid `--bare` by default because subscription OAuth and normal Claude Code context loading are required.
- Support `--bare` only behind an explicit config flag and doctor warning.

The provider must check authentication precedence. Claude Code should use subscription OAuth unless the user explicitly configures another auth mode. If `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is present, doctor reports that API credentials may override subscription OAuth.

## State

State lives under a repo-local ignored directory:

```text
.agent-team/
  config.json
  sessions/
  runs/
  providers/
  mailboxes/
  logs/
```

Sidecars are the source of truth for orchestration state. They include:

- run id
- role
- provider
- model
- auth mode
- capabilities used
- provider session id
- prompt hash
- output summary
- parsed verdict
- file ownership
- status
- started/completed timestamps
- evidence paths

Provider transcripts can be large. Store bounded summaries in sidecars and full logs under `.agent-team/logs/` with max-byte rotation.

## Run Lifecycle

Every run moves through explicit states:

```text
queued -> starting -> running -> awaiting-input -> winding-down -> completed
queued -> starting -> running -> cancelling -> cancelled
queued -> starting -> running -> failed
queued -> expired
```

The orchestrator owns state transitions. Provider adapters report observations, but they do not directly decide terminal state.

Terminal states are:

- `completed`: provider exited successfully and the verdict was parsed.
- `cancelled`: the user or Codex intentionally stopped the run.
- `failed`: provider crashed, output was unrecoverable, or required state could not be written.
- `expired`: the run never started before its queue deadline.

All terminal states must write a final sidecar with status, timestamps, evidence paths, transcript summary, and cleanup result.

## Mailboxes And In-Flight Communication

Each run has an append-only mailbox:

```text
.agent-team/mailboxes/<run-id>/
  inbox.jsonl
  outbox.jsonl
  control.jsonl
  events.jsonl
```

Mailbox responsibilities:

- `inbox.jsonl`: Codex-to-agent messages, clarifications, new evidence, or revised constraints.
- `outbox.jsonl`: agent-to-Codex questions, progress notes, partial findings, or requested approvals.
- `control.jsonl`: structured control events such as cancel, wind-down, timeout extension, or permission changes.
- `events.jsonl`: orchestrator-observed lifecycle and transport events.

All mailbox records include:

- monotonic sequence number
- run id
- role
- provider
- message type
- created timestamp
- correlation id
- content hash
- payload

Communication rules:

- Codex is the communication hub. Agents do not message each other directly in v1.
- Provider adapters poll or stream mailbox changes only through the orchestrator.
- A running agent may enter `awaiting-input` if it needs clarification or approval.
- `agent_team_message` appends to `inbox.jsonl` and wakes the provider when supported.
- If the provider cannot accept live input, the orchestrator records the message and uses it on the next resume.
- Permission changes require a control event and capability revalidation before the agent can act on them.

## Wind-Down And Cleanup

Wind-down is distinct from cancellation. It asks an active run to stop taking new work, summarize what happened, emit a final verdict if possible, and release resources cleanly.

`agent_team_wind_down` performs:

1. append `wind_down_requested` to `control.jsonl`
2. ask the provider for a concise final summary and current verdict
3. stop accepting new mailbox input except cancellation
4. wait up to the configured grace period
5. persist final transcript summary, raw log path, changed files, and parsed verdict
6. close provider session handles
7. check worktree cleanliness for implementation roles
8. mark temporary worktrees as retained, archived, or removable according to policy
9. rotate oversized logs
10. write final sidecar status

Cleanup policy:

- Review/planning/debugging runs keep sidecars and bounded summaries; raw logs rotate by size.
- Implementation runs keep worktrees by default until Codex reviews and integrates the diff.
- No run deletes changed files automatically.
- Cancellation kills the provider process only after a soft-stop grace period.
- Hard-killed runs are marked `cancelled` with `cleanup: partial` and preserve logs.

## Verdict Protocol

Agent outputs must include a structured verdict block:

```text
<<<VERDICT>>>
status: SHIP | REVISE | BLOCKED | INCONCLUSIVE
summary: ...
required_changes:
- ...
evidence:
- ...
risks:
- ...
<<<END_VERDICT>>>
```

The parser is shared across providers. Providers may emit extra detail, but the orchestrator only gates on the parsed contract.

## Error Handling

The system fails closed:

- Missing provider capability: reject before dispatch.
- Auth ambiguity: doctor failure for subscription-required runs.
- Malformed verdict: mark `INCONCLUSIVE`, preserve raw output, and ask for a retry or user decision.
- Timeout: cancel process, record status, preserve partial logs.
- Provider crash: record command, exit code, stderr summary, and recovery hint.
- Sidecar corruption: archive corrupt file, halt the affected run, and require user intervention.
- Mailbox corruption: archive the corrupted mailbox file, halt the affected run, and require user intervention.
- Wind-down failure: preserve logs, mark cleanup as partial, and make the run visible through `agent_team_status`.

## Doctor

`agent_team_doctor` checks:

- Node version and MCP server loadability.
- `claude` binary path and version.
- `claude auth status`.
- environment precedence for `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, and provider-specific keys.
- that Claude Code is using subscription OAuth when configured for subscription mode.
- writable `.agent-team/` state directory.
- JSON schema validity for role and provider config.
- generated Claude agent definitions.
- provider capability declarations.
- git availability and worktree support.

Doctor must print exact fix commands where possible.

## Testing

V1 test coverage:

- provider contract validation
- role registry validation
- routing fail-closed behavior
- Claude CLI command construction
- auth-precedence diagnostics
- verdict parser
- sidecar atomic writes and corruption handling
- mailbox append ordering and corruption handling
- wind-down finalization and cleanup policy
- timeout and cancellation behavior
- MCP tool schema validation

No tests should mock benchmark LLM results. CLI execution tests can use fixture commands for transport mechanics, but any benchmark or model-quality claim requires a real provider run and explicit evidence.

## CI

CI should run:

- typecheck
- unit tests
- lint, if configured
- MCP schema validation
- fixture transport tests that do not require live Claude auth

Live provider smoke tests should be opt-in because they depend on local subscription credentials and may incur usage.

## Implementation Slices

1. Scaffold plugin package, MCP server, config loading, and test harness.
2. Add role registry, capability model, and provider contract.
3. Add sidecar/session store with atomic writes.
4. Add verdict parser and structured result normalization.
5. Implement Claude Code CLI provider command construction and JSON parsing.
6. Add MCP tools.
7. Add doctor.
8. Add mailboxes and in-flight communication.
9. Add background dispatch, status, wind-down, and cancellation.
10. Add isolated worktree support for `slice-implementer`.
11. Add docs and examples.

## V1 Decisions

- Generated Claude agent definitions live under `.agent-team/providers/claude/` and are owned by this plugin. Project `.claude/agents/*.md` imports can be added later, after the provider contract has stable validation and prompt-provenance rules.
- Routing uses static config defaults, but each MCP dispatch may request a specific provider. The router still validates required capabilities and fails closed when the requested provider cannot satisfy the role.
- Implementation agents produce diffs only in v1. Codex reviews, integrates, tests, and commits. Commit-capable agents can be considered later behind explicit permission policy and provenance hooks.

## References

- Claude Code authentication: https://code.claude.com/docs/en/authentication
- Claude Code programmatic usage: https://code.claude.com/docs/en/headless
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-usage
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Ollama Cloud: https://docs.ollama.com/cloud
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
- Ollama Anthropic compatibility: https://docs.ollama.com/api/anthropic-compatibility
