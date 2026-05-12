# Agent Team MCP Long-Term Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans before expanding any milestone here into an execution plan, then use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement that milestone task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully build a Codex-facing MCP plugin that lets Codex delegate work to a durable, provider-neutral team of external AI agents while Codex remains the orchestrator, reviewer, integrator, and final authority.

**Architecture:** The MCP server is the product boundary. It owns routing, lifecycle, sidecars, mailboxes, status, verdicts, cleanup, provider health, and public tool schemas. Claude Code CLI subscription OAuth remains the primary v1 transport, while provider adapters for Ollama Cloud, Gemini, Grok, OpenAI-compatible, and Anthropic-compatible runtimes plug into the same provider-neutral contracts later without changing the Codex-facing orchestration surface.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Vitest, Claude Code CLI, provider-neutral core contracts, durable `.agent-team/` state, git worktrees, JSONL mailboxes, Zod tool schemas.

---

## Ultimate Functional Goal

Codex should be able to stand up and manage an external AI agent team from inside the current workspace. A normal mature workflow should look like this:

1. Codex starts several role-specific agents in parallel, such as planner, code-reviewer, debugger, test-designer, architect, and slice-implementer.
2. Each agent runs through a provider adapter selected by required capabilities and policy, not hardcoded provider identity.
3. Claude Code CLI is used first for v1 because it can use the user's Claude subscription OAuth credentials.
4. Each run has durable sidecars, logs, mailbox records, verdicts, status, provider session metadata, and cleanup state.
5. Codex can inspect, message, reply to, wind down, cancel, and clean up agents individually or in bounded batches.
6. Implementation agents work only in isolated retained worktrees, produce reviewable diffs, and never auto-merge or auto-delete evidence.
7. The plugin fails closed when a provider cannot satisfy a role, when auth is unsafe, when state is corrupt, or when a required capability is absent.
8. Future providers can be added as adapters without rewriting lifecycle, mailbox, verdict, status, cleanup, or MCP tool behavior.
9. Benchmark or model-quality claims require real provider evidence; no heuristic or mock LLM fallback is allowed.
10. The finished v1 feels like a reliable local agent-team control plane, not a Claude-only wrapper.

## Current Baseline

Completed through Milestone 35:

- package scaffold, MCP server, CI, stdio smoke, and schema coverage
- provider-neutral roles, capabilities, router, config, and doctor
- Claude Code CLI command/runtime adapter and subscription-first auth posture
- durable sidecars, logs, verdict parser, run pipeline, state recovery, archive handling, log rotation
- background lifecycle with status, message, reply, cancel, wind-down, cleanup, timeout expiry, detached reconciliation
- isolated worktree support for `slice-implementer`
- Claude role policy, generated agent definitions, artifact drift guard, provider health checks
- `agent_team_start_parallel`
- `agent_team_status_many`
- `agent_team_message_many`
- `agent_team_cancel_many`
- `agent_team_wind_down_many`
- `agent_team_summary`
- provider runtime conformance harness for future adapters
- explicitly configured OpenAI-compatible provider foundation for synchronous read-only dispatch
- explicit Ollama Cloud profiles backed by the OpenAI-compatible runtime
- end-to-end Claude team session runbook
- README, changelog/versioning policy, license, and package/plugin metadata alignment

## Roadmap Shape

The remaining work is split into three finish lines:

- **V1 completion:** make the existing Claude-subscription-backed agent team ergonomic, observable, documented, and shippable.
- **V1.5 provider expansion:** add second-provider adapters behind the existing provider-neutral contracts.
- **V2 product maturity:** add richer team orchestration, policy controls, and release-quality installation without weakening v1 safety.

The target count is intentionally a range, not a fake precision number:

- V1 completion likely lands around **Milestone 32**.
- V1.5 provider expansion likely lands around **Milestone 36-40**.
- V2 maturity continues beyond that only if the plugin graduates from local power tool into packaged product.

## Quality Gate

Every milestone from Milestone 27 onward must map its success criteria and verification plan to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.

That gate requires:

- TDD red/green proof for new behavior.
- Focused edge-case tests selected from the matrix.
- MCP schema and packaged stdio smoke coverage for public tools.
- State, lifecycle, auth, provider-neutrality, cleanup, and corruption-recovery checks when touched.
- Full `npm run ci` verification for implementation milestones.
- Opt-in live provider smoke only when making real-provider capability, benchmark, or model-quality claims.

## V1 Completion Milestones

### Milestone 27: Batch Message

**Goal:** Add `agent_team_message_many` so Codex can send in-flight updates or evidence to multiple runs in one bounded MCP call.

**Success Criteria:**

- `agent_team_message_many` appears in tool names, MCP metadata, packaged stdio smoke, and tests.
- Input shape is `{ messages: [{ runId, message, cwd?, messageType?, correlationId? }], cwd?, concurrency? }`.
- Top-level `cwd` defaults into child messages; item-level `cwd` overrides it.
- Each child delegates to lifecycle `messageRun`.
- Results preserve input order.
- Per-run validation, non-corruption failure, and `StateCorruptionError` recovery do not abort the whole batch.
- The tool only records/delivers messages; it does not resume, wind down, cancel, cleanup, or infer model quality.

### Milestone 28: Batch Wind-Down

**Goal:** Add `agent_team_wind_down_many` so Codex can gracefully ask a team to wrap up and emit final state without hard-killing or cleaning up runs.

**Success Criteria:**

- `agent_team_wind_down_many` appears in tool names, MCP metadata, packaged stdio smoke, and tests.
- Input shape is `{ runs: [{ runId, cwd?, correlationId? }], cwd?, concurrency? }`.
- Each child delegates to lifecycle `windDownRun`.
- Results preserve input order and include per-run `winding-down`, terminal, failed, or recovered outcomes.
- Detached and terminal run semantics remain lifecycle-owned.
- No batch wind-down path performs process kill, cancellation, workspace deletion, or provider-specific shortcuts.

### Milestone 29: Batch Cancel

**Goal:** Add `agent_team_cancel_many` for explicit operator-driven cancellation of multiple runs.

**Success Criteria:**

- Cancellation remains explicit and durable per run.
- Each child appends control/event evidence through lifecycle `cancelRun`.
- Partial failures are surfaced per run.
- No cancellation path deletes retained implementation worktrees or hides logs.
- The tool is not used as a wind-down substitute in docs or examples.

### Milestone 30: Team Summary

**Goal:** Add a read-only team summary tool that reports the operational state of a set of runs without synthesizing quality claims.

**Success Criteria:**

- Tool input accepts run ids and optional cwd/correlation metadata.
- Output groups runs by state: running, awaiting input, winding-down, terminal, failed, detached, cleanup blocked, retained worktree.
- Output includes pointers to sidecar, log, mailbox, diff, and verdict evidence where present.
- The tool does not call an LLM, summarize model quality, or create new state except state-corruption recovery when required by shared readers.

### Milestone 31: End-To-End Claude Team Runbook

**Goal:** Add runnable examples and opt-in live smoke docs for a real Claude Code subscription-backed team session.

**Success Criteria:**

- Docs show how to configure the MCP server, confirm Claude auth, start a parallel team, inspect statuses, message agents, wind down, and clean up retained worktrees.
- Live smoke remains opt-in and clearly marked because it uses local subscription credentials.
- Fixture smoke remains CI-safe and does not require live Claude auth.
- Examples preserve provider-neutral language and do not expose internal prompts.

### Milestone 32: V1 Packaging And Release Hardening

**Goal:** Make the plugin installable and maintainable as a real local tool.

**Success Criteria:**

- README or install doc covers prerequisites, install, MCP config, auth, workspace config, and troubleshooting.
- Package metadata, plugin metadata, smoke scripts, and CI all agree on the runtime entrypoint.
- Doctor catches the most common user setup failures before runs start.
- Versioning and changelog policy are documented.
- `npm run ci` remains the release gate.

## V1.5 Provider Expansion Milestones

### Milestone 33: Provider Adapter Conformance Harness

**Goal:** Add a shared conformance test suite for provider adapters before adding non-Claude providers.

**Success Criteria:**

- Conformance tests cover descriptor shape, capability declaration, health result shape, start/resume/cancel contract behavior, structured output boundaries, and unsupported capability failures.
- Tests use fixture transports only for mechanics.
- Any live model quality or benchmark claim remains outside fixture tests and requires explicit provider evidence.

### Milestone 34: OpenAI-Compatible Adapter Foundation

**Goal:** Add a generic OpenAI-compatible adapter suitable for providers such as Ollama Cloud where configured explicitly.

**Success Criteria:**

- Adapter is disabled unless explicitly configured.
- API-key or endpoint config is never inferred as a fallback from Claude.
- Capability routing fails closed when the endpoint cannot satisfy tool use, edits, session resume, structured output, or long-context needs.
- No Codex-facing MCP schema becomes provider-specific.

**Status:** Complete. The foundation adapter is disabled by default, uses explicit provider-scoped config, supports synchronous read-only dispatch only, and fails closed for background/session/edit/tool roles.

### Milestone 35: Ollama Cloud Profiles

**Goal:** Add explicit Ollama Cloud model/provider profiles for review, planning, debugging, and second-opinion roles.

**Success Criteria:**

- Profiles can represent models such as Kimi or GLM without changing core orchestration.
- Profiles do not claim edit/session capabilities unless the adapter truly supports them.
- Doctor reports missing endpoint/auth/model config clearly.
- Live smoke is opt-in.

**Status:** Complete. Ollama Cloud profiles are explicit config only, expose conservative read-only capabilities, route through dynamic `ollama-cloud:<profile-id>` provider ids, and reuse the OpenAI-compatible runtime without public MCP schema changes.

### Milestone 36: Gemini Adapter

**Goal:** Add a Gemini adapter or profile for large-context review and analysis roles.

**Success Criteria:**

- Gemini routing is capability-gated and read-only by default.
- Long-context support is represented as a provider capability with doctor validation.
- Unsupported implementation roles fail closed.
- No benchmark/model-quality claims are made without real run evidence.

### Milestone 37: Grok Adapter

**Goal:** Add a Grok adapter or profile for second-opinion and review-style roles where capabilities allow it.

**Success Criteria:**

- Grok is explicitly configured and never chosen as a silent fallback.
- Provider health and unsupported capability errors are clear.
- Role routing remains provider-neutral.
- Live smoke is opt-in.

### Milestone 38: Provider Selection Policy

**Goal:** Add richer routing policy so Codex can request provider families, model preferences, or multi-provider second opinions safely.

**Success Criteria:**

- Policy remains capability-first and fail-closed.
- Users can pin providers per role or per request.
- The router can explain why a provider was selected or rejected.
- No role is downgraded to a provider that lacks required capabilities.

## V2 Product Maturity Milestones

### Milestone 39: Durable Team Records

**Goal:** Add an optional durable team record that groups related run ids without replacing per-run sidecars.

**Success Criteria:**

- Team records are correlation/index metadata only.
- Per-run sidecars remain the source of truth for run state, verdicts, cleanup, and evidence.
- Team records make status/message/wind-down/cancel workflows easier but do not introduce hidden control behavior.

### Milestone 40: Team Dashboard Surface

**Goal:** Add a compact local dashboard or CLI report for team state.

**Success Criteria:**

- Dashboard is read-only unless an explicit MCP control action is invoked.
- It shows run state, waiting questions, latest activity, evidence paths, retained worktrees, and cleanup status.
- It does not expose internal prompt text or hidden agent instructions.

### Milestone 41: Policy And Audit Controls

**Goal:** Add stronger enterprise-grade controls for auth posture, provider allowlists, role permissions, and audit trails.

**Success Criteria:**

- Config can restrict providers, roles, write mode, worktree roots, and live smoke behavior.
- Audit records explain routing, permission, provider, and lifecycle decisions.
- Dangerous paths fail closed and produce actionable doctor messages.

### Milestone 42: Release Channel And Upgrade Safety

**Goal:** Make upgrades and installation boring.

**Success Criteria:**

- Versioned config migrations are documented or automated.
- Runtime state layout compatibility is checked.
- Release notes describe MCP tool changes and provider compatibility.
- Smoke tests cover packaged installs, not only source-tree execution.

## Definition Of Done For V1

V1 is complete when Codex can reliably:

- start a role-diverse team in parallel through Claude Code CLI subscription OAuth
- inspect team status in one call
- message multiple agents in flight
- gracefully wind down multiple agents
- explicitly cancel multiple agents when needed
- clean up retained implementation worktrees only on explicit request
- preserve sidecars, mailboxes, verdicts, logs, diffs, provider sessions, and recovery evidence
- pass doctor, typecheck, tests, build, stdio smoke, and CI
- onboard a user from docs without needing internal chat history

## Definition Of Done For V1.5

V1.5 is complete when at least one non-Claude provider can be configured explicitly and used for capability-supported read-only roles through the same provider-neutral lifecycle, doctor, status, messaging, and evidence model, without silent fallback from Claude subscription mode and without provider-specific MCP tools.

## Near-Term Recommendation

Implement the next milestones in this order:

1. Milestone 36: Gemini Adapter
2. Milestone 37: Grok Adapter
3. Milestone 38: Provider Selection Policy

This order finishes the V1 control plane before adding provider breadth.
