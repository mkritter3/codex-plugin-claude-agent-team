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

Completed through Milestone 61:

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
- explicitly configured Gemini adapter for synchronous read-only dispatch
- explicit Grok profiles backed by the OpenAI-compatible runtime
- capability-first provider selection policy with role pins, provider order, and routing explanations
- optional durable team records under `.agent-team/teams/` for grouping related run ids without replacing per-run sidecars
- `agent_team_dashboard` read-only dashboard/report surface for team or explicit run refs
- provider-neutral policy and audit controls for roles, providers, write mode, retained worktree roots, live-smoke posture, doctor posture, and sanitized `.agent-team/audit/events.jsonl` records
- config schema and state layout compatibility checks
- package dry-run smoke and release/upgrade docs
- opt-in live Claude team smoke harness through the packaged MCP boundary
- end-to-end Claude team session runbook
- install handoff preflight that emits a sanitized absolute MCP config
- opt-in read-only provider proof smoke harness through the packaged MCP boundary
- README, changelog/versioning policy, license, and package/plugin metadata alignment
- real Claude call reliability hardening for honest terminal-state reporting, MCP request-timeout alignment, stream-json background input, wind-down timeout finalization, and evidence-preserving failure cleanup in the opt-in Claude live smoke
- opt-in Claude live capability matrix that validates direct dispatch, bounded parallel read-only teams, isolated implementation handoff, mailbox delivery, wind-down, cancellation, team records, dashboard, summary, cleanup, and policy failure through packaged public MCP tools
- explicit Ollama Claude Code profiles backed by one shared `OLLAMA_API_KEY` and scoped Anthropic-compatible Claude Code launch environment
- workflow orchestrator design for the expanded L11 full-stack roster, senior review policy, consensus loops, slice DAG, blocked/unblocked workflow, review consensus, and integration boundaries
- workflow policy/config defaults for Opus planning and implementation senior review
- durable workflow state foundation with provider-neutral goal packets, slice DAG records, consensus evidence, senior-review evidence, user escalations, integration queue placeholders, and sanitized workflow views
- `agent_team_create_workflow`
- `agent_team_get_workflow`
- `agent_team_list_workflows`
- `agent_team_plan_consensus`
- `agent_team_start_slices`
- `agent_team_unblock_slice`
- `agent_team_review_slice`
- `agent_team_integration_queue`
- `agent_team_record_integration`
- `agent_team_workflow_report`
- planning consensus mechanics with 10/15-round handling, Codex rationale, user-decision filtering, senior-review degraded evidence, and fail-closed required-blocking behavior
- slice start and unblock mechanics with bounded concurrency, ordered per-slice results, partial-failure evidence, per-run addressability, mailbox dependency updates, and durable slice run evidence
- slice review consensus with implementation evidence, reviewer verdicts, Opus implementation-review posture, approval/revision/blocking state transitions, hard review blockers, and sanitized public MCP output
- read-only integration queue computation with deterministic dependency/hint/risk ordering, conflict-risk evidence, focused test recommendations, and no source mutation
- Codex-owned integration evidence recording with final gate verification, integrated slice marking, integration queue state updates, and cleanup handoff recommendations without source mutation or cleanup execution
- read-only workflow completion reporting with strict final-gate completion claims, blocked/incomplete categorization, per-slice addressability, and cleanup-ready recommendations without source mutation
- operator-facing workflow orchestrator runbook coverage for the complete create, consensus, start, unblock, review, queue, integrate, record, report, and explicit cleanup loop
- fixture-safe packaged workflow orchestrator smoke that drives public workflow tools through `dist/index.js`, proves blocked/unblocked and completion-report gates, records degraded Opus evidence, and runs in CI without live provider calls
- final workflow-orchestrator readiness report that maps product-level success criteria to repo evidence and records the accepted completion stop condition

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

**Status:** Complete. Gemini is explicit config only, exposes conservative read-only capabilities, uses a provider-owned `generateContent` runtime, and reuses provider-neutral router, doctor, dispatch, lifecycle, sidecar, and evidence paths without public MCP schema changes.

### Milestone 37: Grok Adapter

**Goal:** Add a Grok adapter or profile for second-opinion and review-style roles where capabilities allow it.

**Success Criteria:**

- Grok is explicitly configured and never chosen as a silent fallback.
- Provider health and unsupported capability errors are clear.
- Role routing remains provider-neutral.
- Live smoke is opt-in.

**Status:** Complete. Grok profiles are explicit config only, expose conservative read-only capabilities, route through dynamic `grok:<profile-id>` provider ids, and reuse the OpenAI-compatible runtime without public MCP schema changes.

### Milestone 38: Provider Selection Policy

**Goal:** Add richer routing policy so Codex can request provider families, model preferences, or multi-provider second opinions safely.

**Success Criteria:**

- Policy remains capability-first and fail-closed.
- Users can pin providers per role or per request.
- The router can explain why a provider was selected or rejected.
- No role is downgraded to a provider that lacks required capabilities.

**Status:** Complete. Provider selectors support exact ids, families, models, and capabilities; request selectors override role pins, role pins override provider order, and doctor exposes selection explanations without public provider-specific MCP schema changes.

## V2 Product Maturity Milestones

### Milestone 39: Durable Team Records

**Goal:** Add an optional durable team record that groups related run ids without replacing per-run sidecars.

**Success Criteria:**

- Team records are correlation/index metadata only.
- Per-run sidecars remain the source of truth for run state, verdicts, cleanup, and evidence.
- Team records make status/message/wind-down/cancel workflows easier but do not introduce hidden control behavior.

**Status:** Complete. Durable team records live under `.agent-team/teams/`, create/get/list tools preserve grouping metadata only, referenced run sidecars are validated before writes, and per-run sidecars plus existing lifecycle tools remain authoritative.

### Milestone 40: Team Dashboard Surface

**Goal:** Add a compact local dashboard or CLI report for team state.

**Success Criteria:**

- Dashboard is read-only unless an explicit MCP control action is invoked.
- It shows run state, waiting questions, latest activity, evidence paths, retained worktrees, and cleanup status.
- It does not expose internal prompt text or hidden agent instructions.

**Status:** Complete. `agent_team_dashboard` accepts either a durable `teamId` or explicit run refs, preserves ordered per-run addressability and partial failures through the existing summary pipeline, reports evidence/mailbox/cleanup pointers, reports corrupt state without archiving inspected artifacts, and omits raw summary payloads, prompt hashes, provider session ids, and provider-specific control details.

### Milestone 41: Policy And Audit Controls

**Goal:** Add stronger enterprise-grade controls for auth posture, provider allowlists, role permissions, and audit trails.

**Success Criteria:**

- Config can restrict providers, roles, write mode, worktree roots, and live smoke behavior.
- Audit records explain routing, permission, provider, and lifecycle decisions.
- Dangerous paths fail closed and produce actionable doctor messages.

**Status:** Complete. Workspace policy can restrict roles, provider selectors, write-capable starts, retained worktree roots, and live-smoke posture; dispatch and lifecycle start paths evaluate policy before provider execution and append sanitized audit records when enabled; doctor reports policy posture and fails incompatible write-mode configuration.

### Milestone 42: Release Channel And Upgrade Safety

**Goal:** Make upgrades and installation boring.

**Success Criteria:**

- Versioned config migrations are documented or automated.
- Runtime state layout compatibility is checked.
- Release notes describe MCP tool changes and provider compatibility.
- Smoke tests cover packaged installs, not only source-tree execution.

**Status:** Complete. Config schema version `1` is parsed fail-closed, state layout version `1` is inspected read-only through doctor, future/corrupt layout markers fail doctor with actionable details, `npm run smoke:package` verifies dry-run package contents with an isolated npm cache, and `docs/releases/0.1.0.md` documents tool surface, provider compatibility, config schema, state layout, and migration posture.

### Milestone 43: Opt-In Live Claude Team Smoke Harness

**Goal:** Add a repeatable operator-run live smoke harness for the Claude Code CLI subscription-backed team path without putting live provider usage in CI.

**Success Criteria:**

- Live smoke refuses to run unless explicitly confirmed and workspace policy enables `liveSmokeEnabled`.
- The harness uses the packaged MCP stdio boundary, not provider internals.
- It runs doctor, starts a small read-only Claude team, inspects status/dashboard/summary evidence, sends one batch message, requests wind-down, and emits a sanitized report.
- The report includes provider id/auth mode, run ids, roles, status/verdict/evidence paths, and known limitations without prompts, secrets, provider session ids, command internals, or environment values.
- Fixture-safe tests prove the command is opt-in, excluded from CI, redacted, and wired to the public MCP tool flow.

**Status:** Complete. `npm run smoke:claude-live` now has a dry-run plan, fails closed without `--confirm-live-provider-use`, checks `policy.liveSmokeEnabled` after doctor before live execution, drives the packaged `dist/index.js` MCP stdio boundary through public team tools, waits on bounded status polling, and emits a sanitized report. The command stays out of CI while focused tests, full tests, packaged smokes, invariant scans, and `npm run ci` prove fixture-safe behavior.

### Milestone 44: Install Handoff And MCP Config Preflight

**Goal:** Make local installation handoff repeatable by adding a fixture-safe command that validates the install surface and prints an absolute MCP config for Codex clients.

**Success Criteria:**

- `npm run install:check` validates package metadata, plugin manifest, local `.mcp.json`, built runtime, and install script packaging without provider calls.
- The command emits a sanitized JSON report with ordered checks, `ready` or `blocked` status, an absolute `mcpServers.agent-team` config, and next steps.
- The generated config uses the packaged runtime boundary (`node` plus absolute `dist/index.js`) and does not expose prompts, provider internals, env values, secrets, or auth tokens.
- `npm run ci` includes the install preflight after build and before packaged stdio smoke.
- README/runbook/package smoke tests cover the install handoff without adding live provider usage to CI.

**Status:** Complete. `npm run install:check` validates package metadata, plugin manifest, local `.mcp.json`, built runtime, and packaged script contents without provider calls or credential reads. It emits a sanitized `ready` or `blocked` JSON report with ordered checks, an absolute `mcpServers.agent-team` config pointing at `dist/index.js`, and operator next steps; CI runs it after build and before stdio/package smoke, while docs and tests cover the install handoff.

### Milestone 45: Read-Only Provider Proof Smoke

**Goal:** Add an opt-in live smoke harness for explicitly configured non-Claude read-only providers through the packaged MCP boundary.

**Success Criteria:**

- `npm run smoke:providers-live` exists and is excluded from CI.
- The command fails closed unless `--dry-run` or `--confirm-live-provider-use` is supplied.
- At least one explicit `--provider <selector>` is required; provider selectors are not inferred from Claude subscription mode.
- Dry-run emits a sanitized plan with provider selectors, public MCP tool flow, policy requirements, planned read-only roles, and known limitations.
- Confirmed live execution uses packaged `dist/index.js` over MCP stdio and public tools: `agent_team_doctor`, `agent_team_list_providers`, `agent_team_dispatch`, `agent_team_dashboard`, and `agent_team_summary`.
- Live execution requires `policy.liveSmokeEnabled === true`, preserves ordered per-selector results under bounded concurrency, and reports sidecar/log/evidence paths without prompts, secrets, provider session ids, endpoints, raw payloads, process ids, or command args.
- The harness makes no benchmark, ranking, model-quality, reasoning, or practical long-context claim.

**Status:** Complete. `npm run smoke:providers-live` now provides a fail-closed dry-run and opt-in live harness for explicitly selected non-Claude read-only providers. It drives the packaged `dist/index.js` MCP stdio boundary through public doctor, provider listing, dispatch, dashboard, and summary tools; requires `policy.liveSmokeEnabled` before live use; preserves ordered per-selector evidence under bounded concurrency; stays out of CI; and emits a sanitized report without prompts, secrets, provider session ids, endpoints, raw payloads, process ids, command args, or provider quality claims.

### Milestone 46: Real Claude Call Reliability Hardening

**Goal:** Harden the Claude Code CLI subscription-backed live path so real operator smoke reports only true terminal success, aligns MCP request timeouts with provider timeouts, and preserves cancellation/cleanup evidence on bounded failures.

**Success Criteria:**

- `winding-down`, `running`, `pending`, `awaiting-input`, detached, missing, and unknown run states are never treated as successful live-smoke completion.
- Live smoke report status is `completed` only when tracked Claude runs complete successfully through the packaged MCP boundary.
- SDK `client.callTool` request timeouts are explicitly configured for live calls that may outlast the default MCP timeout.
- Failed or nonterminal live smoke attempts request graceful wind-down, record explicit cancellation intent for lingering runs, and emit sanitized failure evidence.
- The harness continues to use `dist/index.js` and public MCP tools only; it does not call provider internals or the Claude CLI directly.
- Live Claude proof remains opt-in and excluded from CI.

**Status:** Complete. `npm run smoke:claude-live` now performs a direct packaged-MCP Claude dispatch proof, starts a small parallel Claude team through public MCP tools, uses explicit MCP request timeouts, treats only `completed` as successful live-smoke terminal state, fails with sanitized evidence for nonterminal or unsuccessful terminal runs, and preserves wind-down/cancellation evidence. The Claude background runtime now sends the initial prompt as documented stream-json stdin and closes stdin so real prompt-mode sessions complete instead of timing out while waiting for input; lifecycle also allows provider timeout finalization after wind-down has begun.

### Milestone 47: Live Capability Matrix And Stress Proof

**Goal:** Prove the current Claude-backed control plane across mailbox, wind-down, cancellation, implementation handoff, team grouping, cleanup, and edge-case behavior before adding more write-capable providers.

**Success Criteria:**

- A repeatable live validation plan exists for direct dispatch, read-only parallel teams, isolated `slice-implementer`, mailbox delivery to active runs, graceful wind-down, explicit cancellation, retained worktree handoff, team records, dashboard, summary, cleanup, and source-checkout cleanliness.
- The plan uses public MCP tools only and keeps live provider use opt-in.
- Stress cases include bounded concurrency, long-running implementer mailbox updates, cancellation of an active implementer, wind-down of an active implementer, cleanup after retained worktree review, and policy failure for disallowed write roots.
- Reports include run ids, roles, provider ids, terminal states, evidence paths, changed files, cleanup state, and known limitations without prompts, secrets, provider session ids, raw payloads, process ids, or command args.
- No model-quality, benchmark, or provider-ranking claim is made from this validation.

**Status:** Complete. `npm run smoke:claude-live-matrix` now provides a fail-closed dry-run and opt-in live capability matrix through the packaged `dist/index.js` MCP stdio boundary. It validates direct dispatch, bounded parallel read-only starts, isolated `slice-implementer` handoff, active mailbox delivery, graceful wind-down, explicit cancellation, team records, dashboard, summary, cleanup, and policy failure for disallowed write roots while emitting sanitized control-plane evidence only. The command remains excluded from CI and makes no provider ranking, model-quality, or practical long-context claim.

### Milestone 48: Ollama Claude Code Profiles

**Goal:** Add explicit Ollama Cloud profiles that route Claude Code through Ollama's Anthropic-compatible interface so Kimi, GLM, and DeepSeek cloud models can participate in the same team lifecycle where their real capabilities pass validation.

**Success Criteria:**

- Users configure the Ollama API key once through plugin/MCP environment, for example `OLLAMA_API_KEY`, not once per model and not in workspace JSON.
- Workspace config defines shared Ollama Claude Code settings plus model profiles such as `kimi-k2.6`, `glm-5.1`, and `deepseek-v4-flash`.
- Provider ids are explicit, for example `ollama-claude-code:kimi-k2.6`, and are never inferred from Claude subscription mode or generic environment variables.
- The provider reuses the Claude Code session lifecycle, sidecars, mailboxes, verdicts, status, dashboard, wind-down, cancellation, isolated worktrees, diff evidence, and cleanup contracts.
- Scoped provider launch env sets `ANTHROPIC_BASE_URL`, maps the shared token through `ANTHROPIC_AUTH_TOKEN`, keeps `ANTHROPIC_API_KEY` intentionally blank for Claude Code compatibility, and preserves `OLLAMA_API_KEY` only for that run without weakening `claude-code-cli` subscription OAuth auth-precedence checks.
- Doctor reports Claude CLI readiness, shared auth env presence, model profile readiness, capability declarations, and clear repair steps without exposing secrets or provider endpoints in public MCP output.
- Write-capable Ollama Claude Code profiles are disabled until live proof validates implementation, mailbox, wind-down, cancellation, cleanup, and source-checkout containment for that model/profile.
- Live proof is opt-in, excluded from CI, and makes no model-quality, benchmark, ranking, or practical long-context claim.

**Status:** Complete. `providers.ollamaClaudeCode` now defines explicit `ollama-claude-code:<profile-id>` providers with one shared API-key env, scoped Anthropic-compatible launch environment, Claude Code lifecycle reuse for dispatch/background sessions, doctor health checks, conservative write-validation gating, and docs/runbook coverage without public MCP schema changes or provider-quality claims.

### Milestone 49: Ollama Write Validation

**Goal:** Prove selected Ollama Claude Code profiles can perform isolated implementation writes before enabling their write-capable capabilities in normal workspaces.

**Success Criteria:**

- `npm run smoke:ollama-write` exists and is excluded from CI.
- The command fails closed unless `--dry-run` or `--confirm-live-provider-use` is supplied.
- Only exact `ollama-claude-code:<profile-id>` selectors are accepted; write validation is never inferred from family selectors or Claude subscription mode.
- Live validation creates a disposable git fixture per selected provider and enables `writeValidated: true` only in that fixture.
- The selected provider must expose `edits` and `workspaceIsolation` in fixture-local config before starting.
- The `slice-implementer` run must complete in an isolated git worktree, change only `OLLAMA_WRITE_PROOF.txt`, leave the source workspace unmodified, emit sidecar/log/dashboard/summary evidence, and clean up the retained worktree.
- Reports remain sanitized and make no model-quality, benchmark, ranking, autonomous-implementation, or practical long-context claim.

**Status:** Complete. `npm run smoke:ollama-write` now provides a fail-closed dry-run and opt-in live write-validation harness for exact `ollama-claude-code:<profile-id>` selectors. Kimi K2.6, GLM 5.1, and DeepSeek V4 Flash have each passed disposable-fixture isolated write validation through packaged MCP, including source-workspace containment, retained worktree evidence, dashboard, summary, and cleanup.

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

## Workflow Orchestrator Continuation

Milestones 50 through 61 establish the L11 workflow orchestrator foundation:

- senior-review policy defaults and environment/workspace config
- expanded L11 role roster
- durable workflow state and public workflow create/get/list tools
- planning consensus with Codex rationale, Opus planning evidence, user-level escalation filtering, and 10/15-round rules
- slice start/unblock mechanics using existing lifecycle and mailbox pipelines
- slice review consensus with Codex and Opus implementation-review evidence before integration
- read-only integration queue computation without merge execution
- integration evidence recording after Codex-owned manual integration, with final verification evidence and cleanup handoff boundaries
- workflow completion reporting that refuses completion claims until all slices have durable passing final gate evidence
- operator-facing runbook coverage for the complete public MCP workflow loop without internal prompt, secret, provider payload, or provider-specific implementation leakage
- packaged fixture-safe workflow orchestrator smoke in CI for creation, planning, unblock, review, queue, integration evidence, completion reporting, listing, and disposable fixture cleanup
- final readiness evidence in `docs/superpowers/reports/2026-05-13-agent-team-workflow-orchestrator-readiness.md`

Workflow-orchestrator product-level success criteria are complete for the accepted v1 scope. Stop repeating workflow-orchestrator implementation prompts unless a new product requirement, provider target, live proof request, changed safety policy, release task, or bug report appears. Merge execution remains Codex-owned and must not be automated by the plugin.
