# Agent Team MCP L11 Quality Gates

Date: 2026-05-12
Status: Required for all future milestones

## Purpose

This document defines the engineering and verification bar for the Agent Team MCP plugin. Every future milestone must explicitly map its success criteria to these gates before it is marked complete.

The goal is not "more tests." The goal is proof that the plugin remains a durable, provider-neutral, fail-closed local agent-team control plane where Codex stays the orchestrator and final integration authority.

## Non-Negotiable Invariants

Every milestone must preserve these invariants:

- Claude Code CLI subscription OAuth remains the primary v1 transport.
- No API-key fallback is used unless explicitly configured and tested as a separate policy.
- Provider-neutral core contracts own routing, lifecycle, sidecars, mailboxes, verdicts, status, cleanup, and recovery.
- Provider adapters translate capabilities; they do not create parallel orchestration systems.
- No heuristic or mock LLM behavior is used for benchmark, model-quality, or capability claims.
- Role routing fails closed when a provider lacks required capabilities.
- `slice-implementer` writes only inside retained isolated worktrees.
- Codex reviews and integrates implementation diffs; agents do not auto-merge or auto-commit.
- Cleanup is explicit and evidence-preserving.
- Batch tools preserve per-run addressability, ordered results, bounded concurrency, and partial-failure evidence.
- State corruption is surfaced with recovery details instead of hidden or destructive repair.
- Public MCP schemas do not reveal internal prompts or provider-specific implementation details.

## Universal Milestone Gate

Before a milestone is merged, its plan must include each item below or state why the item does not apply.

| Gate | Required Evidence |
| --- | --- |
| Scope and architecture | Plan states files, ownership boundaries, non-goals, and success criteria. |
| TDD red proof | New behavior has failing tests observed before production code is added. |
| Focused green proof | Focused tests for the milestone pass after implementation. |
| Full verification | `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp-stdio`, and `npm run ci` pass unless the milestone is docs-only. |
| MCP contract | Tool names, Zod schemas, handler validation, server registration, and packaged stdio smoke are updated for any public tool change. |
| Provider neutrality | Core code stays provider-neutral; provider-specific code remains under provider adapter boundaries. |
| Auth safety | Subscription-first posture remains intact; API override/fallback behavior is explicit and tested when touched. |
| State durability | Sidecars, logs, mailboxes, events, control records, verdicts, and cleanup metadata remain durable and inspectable. |
| Failure behavior | Validation failures happen before side effects; runtime failures are explicit and do not lose later work. |
| Corruption recovery | State readers and MCP lifecycle tools surface `StateCorruptionError` through shared recovery paths when applicable. |
| Concurrency safety | Batch or parallel work proves bounded concurrency, input ordering, per-item status, and partial failure. |
| Lifecycle safety | Message, reply, status, cancel, wind-down, cleanup, and detached semantics stay lifecycle-owned. |
| Workspace safety | Implementation worktrees are retained until explicit cleanup, and cleanup never hides logs or diffs. |
| Documentation | Plans, roadmap, runbook, or package docs are updated when behavior or user workflow changes. |
| Boundary scan | Run invariant searches for fallback, bypass, benchmark, cleanup, provider-specific schema, and process-kill shortcuts. |

## Required Edge Case Matrix

Each milestone plan must choose the relevant rows from this matrix and include focused tests.

| Area | Edge Cases To Prove |
| --- | --- |
| Input validation | Missing required fields, empty strings, wrong primitive types, arrays where objects are required, invalid role/provider/cwd/concurrency/force values. |
| MCP handlers | Validation returns `validation_error` before lifecycle/provider invocation; unknown tools remain explicit; injected dependencies are not called on invalid input. |
| Batch tools | Empty arrays, non-object children, per-child cwd overrides, correlation ids, out-of-order async completion, bounded concurrency, partial failures, state corruption in one child, later children still processed. |
| Lifecycle status | Running active handles, running detached sidecars, terminal sidecars, awaiting-input sidecars, stale or missing sidecars, state corruption. |
| Messaging | Live delivery when stdin is available, durable inbox fallback when live input is unavailable, blocked input after wind-down/cancel/terminal states, mailbox sequence stability. |
| Reply/resume | Missing provider session id, parent/child linkage, resume prompt evidence, provider session propagation, mailbox context inclusion. |
| Wind-down | Active handle grace window, no hard kill, detached run recording, idempotent input closure, final-summary request evidence. |
| Cancellation | Active cancellation, detached cancellation intent, terminal run no-op or blocked semantics, implementation diff harvesting, inspection failure does not hide cancellation. |
| Cleanup | Requires `force: true`, requires terminal implementation run, rejects read-only runs, rejects missing metadata, rejects already removed worktrees, records failed removal warnings. |
| State stores | Atomic writes, lock-protected transitions, monotonic mailbox sequences, corrupt JSON, corrupt JSONL, archive reason records. |
| Provider routing | Unsupported role/capability rejection, requested provider mismatch, write-mode disabled, write-mode enabled without capable provider, provider selection explanation. |
| Auth posture | Claude CLI missing, Claude auth missing, API override env present, explicit API fallback config, subscription OAuth descriptor. |
| Provider adapters | Command construction, permission policy, generated agent definitions, health check shape, unsupported capability errors, no `bypassPermissions`. |
| Workspaces | Dirty status inspection, diff capture, renamed files, no changes, git missing, worktree cleanup failure, retained worktree metadata preservation. |
| Packaged runtime | Built `dist/index.js` entrypoint, `.mcp.json` alignment, package bin alignment, stdio smoke against built runtime, CI uses same gate. |
| Docs and examples | User-facing docs do not depend on chat history, live-provider steps are marked opt-in, internal prompts are not exposed. |

## Milestone Type Gates

### New MCP Tool

Required proof:

- `listToolNames()` includes the tool in the intended order.
- `TOOL_METADATA_BY_NAME` exposes title, description, and input schema.
- `tests/mcp/server.test.ts` proves server registration.
- `tests/mcp/tools.test.ts` proves validation and handler delegation.
- `scripts/smoke-mcp-stdio.mjs` asserts required fields for packaged runtime.
- `tests/package-runtime.test.ts` proves the smoke script covers the tool.
- Invalid inputs do not call lifecycle or provider dependencies.
- State corruption is handled through shared recovery when the tool reads or mutates durable state.

### Batch Tool

Required proof:

- Concurrency default and bounds are tested.
- Results preserve input order even when child operations resolve out of order.
- Each child includes `index`, run id, cwd, optional correlation id, and item status.
- One child failure does not abort later children.
- One child state corruption returns a recovery item and does not abort later children.
- Batch tool does not create hidden durable state unless a milestone explicitly introduces a team record.
- Batch control tools delegate to existing per-run lifecycle methods.

### Provider Adapter Or Profile

Required proof:

- Adapter is disabled unless explicitly configured.
- Health check reports missing command, endpoint, auth, or model config clearly.
- Capability descriptor is conservative.
- Router rejects roles requiring unsupported capabilities.
- No API-key or endpoint config is inferred as fallback from Claude subscription mode.
- Fixture tests cover transport mechanics without model-quality claims.
- Live smoke is opt-in and documented separately from CI.

### Lifecycle Or State Change

Required proof:

- Sidecar transition tests cover happy path, invalid state transitions, terminal immutability, and concurrent updates.
- Mailbox/control/event records prove durable ordering.
- Corrupt state is archived or surfaced through shared recovery.
- Restart/detached behavior is tested when active process handles matter.
- Cleanup and worktree retention semantics are tested when implementation runs are involved.

### Documentation Or Roadmap Change

Required proof:

- `git diff` is reviewed for scope.
- Placeholder scan passes:

```bash
rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in|appropriate[ ]error[ ]handling|handle[ ]edge[ ]cases|write[ ]tests[ ]for|similar[ ]to" docs
```

- No runtime verification is required for docs-only changes unless package metadata, scripts, examples, or generated artifacts are changed.

### Workflow Validation Gate

Workflow implementation milestones must include:

- deterministic fixture validation for workflow mechanics
- explicit opt-in for live provider proof
- public-output sanitization checks
- blocked dependency, review rejection, failed-test, cleanup-failure, provider-degradation, and steering-truth scenarios where relevant
- no model comparison or broad provider-quality claims from fixture evidence

Fixture validation reports use `workflow_mechanics_only` and must record `liveProviderCalls: 0`. Live validation reports use `provider_transport_capability_only` unless a separately approved live scenario includes real task acceptance criteria, diff evidence, tests, senior review, and user-approved scope.

## Required Verification Commands

For implementation milestones, run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

For focused milestone proof, run the smallest test command that covers the changed surface before the full gate. Examples:

```bash
npm test -- tests/mcp/tools.test.ts
npm test -- tests/core/lifecycle.test.ts tests/mcp/tools.test.ts
npm test -- tests/providers/claude-code-cli/runner.test.ts tests/providers/claude-code-cli/background.test.ts
```

For invariant scans, choose the relevant command set:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|subscription OAuth|authMode" src tests docs
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers
rg "benchmark|model-quality|mock LLM|embedding|heuristic" src tests docs
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace" src tests docs
rg "agent_team_.*_many|partial_failure|concurrency|correlationId|StateCorruptionError|recoverStateCorruption" src tests docs
```

Expected interpretation:

- Matches are acceptable when they are existing config, guard tests, docs, or explicit failure checks.
- New matches in implementation code require review against the non-negotiable invariants.
- New provider-specific matches outside `src/providers/` require justification.

## Live Provider Smoke Policy

Live provider tests are intentionally not part of CI because they depend on local credentials and may consume subscription or API usage.

Live smoke is required before claiming real-provider quality for:

- Claude subscription-backed end-to-end workflows.
- Non-Claude provider adapter readiness.
- Model quality, benchmark, long-context, or reasoning comparisons.
- Tool-use behavior that cannot be proven with fixture transport tests.

Live smoke output must record:

- provider id and auth mode
- role and requested capabilities
- command or endpoint class without secrets
- run id and sidecar path
- transcript or log path
- verdict and evidence paths
- cleanup/worktree status
- known limitations

## Plan Template Insert

Future milestone plans should include this section before task breakdown:

```markdown
## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for new behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.
```

## Completion Standard

A milestone is not complete because code exists. A milestone is complete when the success criteria, focused tests, full verification, invariant scans, and documentation updates together prove that the plugin still behaves like a provider-neutral, subscription-first, durable agent-team control plane.
