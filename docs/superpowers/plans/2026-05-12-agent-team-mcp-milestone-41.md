# Agent Team MCP Milestone 41 Policy And Audit Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral policy enforcement and durable audit records so agent-team starts fail closed when roles, providers, write mode, worktree roots, or live-smoke posture violate workspace policy.

**Architecture:** M41 adds a shared pure policy layer plus append-only audit state under `.agent-team/audit/`. Dispatch and lifecycle start paths evaluate policy after provider selection but before prompt construction, worktree allocation, provider runtime lookup, or provider session start. Doctor reports policy posture and actionable failures without exposing prompts, provider command details, secrets, or provider session ids.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, existing config loader, provider-neutral router, lifecycle manager, dispatch orchestrator, `.agent-team/` durable state, JSONL audit records, existing L11 verification gates.

---

## Scope

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Create: `src/core/policy.ts`
- Create: `src/core/state/audit-store.ts`
- Modify: `src/core/state/paths.ts`
- Modify: `src/core/workspaces.ts`
- Modify: `src/core/dispatch.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Modify: `src/doctor.ts`
- Create: `tests/core/policy.test.ts`
- Create: `tests/core/state/audit-store.test.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/workspaces.test.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-41.md`

**Non-goals:**

- Do not add a public MCP audit inspection tool in this milestone.
- Do not add a browser, TUI, daemon, or dashboard UI.
- Do not change provider adapter command construction or live provider behavior.
- Do not add API-key fallback, provider-specific public schemas, benchmark claims, model-quality claims, or mock LLM behavior.
- Do not auto-clean worktrees, auto-merge implementation branches, or hide retained evidence.
- Do not make audit records include prompt text, prompt hashes, provider session ids, provider command args, raw mailbox payloads, secrets, process ids, or full environment values.
- Do not replace existing routing; policy restricts selected decisions, while router remains capability-first.

## Policy Contract

Config shape:

```ts
export interface AgentTeamPolicyConfig {
  readonly allowedRoles: readonly RoleId[];
  readonly allowedProviderSelectors: readonly string[];
  readonly allowWriteMode: boolean;
  readonly allowedWorktreeRoots: readonly string[];
  readonly liveSmokeEnabled: boolean;
  readonly auditEnabled: boolean;
}
```

Defaults:

```json
{
  "policy": {
    "allowedRoles": [],
    "allowedProviderSelectors": [],
    "allowWriteMode": true,
    "allowedWorktreeRoots": [],
    "liveSmokeEnabled": false,
    "auditEnabled": true
  }
}
```

Semantics:

- Empty `allowedRoles` means all known roles are allowed.
- Empty `allowedProviderSelectors` means any capability-satisfying provider is allowed.
- `allowWriteMode: false` blocks `writeMode.enabled: true`.
- Empty `allowedWorktreeRoots` means the existing default isolated worktree root is allowed.
- Non-empty `allowedWorktreeRoots` restricts implementation worktree execution paths to those roots before `git worktree add`.
- `liveSmokeEnabled` is a policy flag reported by doctor and docs; CI remains fixture-only.
- `auditEnabled: false` disables audit writes only when explicitly configured.

Pure evaluator API:

```ts
export interface AgentTeamPolicyDecision {
  readonly status: "allowed" | "blocked";
  readonly reason: string;
  readonly details: Record<string, unknown>;
}

export function evaluateStartPolicy(input: {
  readonly config: AgentTeamConfig;
  readonly roleId: RoleId;
  readonly provider: AgentProviderDescriptor;
  readonly requestedProvider?: string;
  readonly executionPolicy: AgentExecutionPolicy;
  readonly plannedWorktreeRoot?: string;
}): AgentTeamPolicyDecision;
```

Blocking decisions:

- role not listed in `allowedRoles`
- selected provider does not match any `allowedProviderSelectors`
- isolated edit role with `writeMode.enabled` while `allowWriteMode` is false
- isolated edit role with a planned worktree root outside `allowedWorktreeRoots`

## Audit Contract

Audit path:

```text
.agent-team/audit/events.jsonl
```

Record shape:

```ts
export interface AgentTeamAuditRecord {
  readonly sequence: number;
  readonly createdAt: string;
  readonly eventType:
    | "policy_allowed"
    | "policy_blocked"
    | "provider_selected"
    | "doctor_policy";
  readonly operation: "dispatch" | "start" | "doctor";
  readonly role?: RoleId;
  readonly provider?: string;
  readonly runId?: string;
  readonly decision: "allowed" | "blocked" | "reported";
  readonly reason: string;
  readonly details: Record<string, unknown>;
}
```

Audit rules:

- Audit writes are append-only and sequence-numbered.
- Audit writes are lock-protected and corruption-aware.
- Start paths write allowed or blocked policy records before provider runtime lookup, prompt construction, worktree allocation, provider session start, or process spawn.
- If `auditEnabled` is true and an allowed start cannot append its audit record, the operation fails closed before provider/worktree side effects.
- Public MCP schemas do not change for this milestone.

## L11 Quality Gates

- [ ] Success criteria map to `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`.
- [ ] TDD red proof is captured for new behavior.
- [ ] Focused milestone tests are listed with expected red and green outcomes.
- [ ] Full verification commands are listed.
- [ ] Required edge cases from the matrix are explicitly selected.
- [ ] Invariant scans are listed.
- [ ] Live provider smoke is marked required or not required with rationale.

Selected quality-gate rows:

- Input validation: invalid role ids in config, empty policy selectors, non-array policy fields, non-string worktree roots, boolean policy flags.
- Provider routing: provider selected by capability/routing but denied by policy, requested provider denied by policy, allowed selectors with id/family/model/capability forms.
- Lifecycle safety: blocked starts do not construct prompts, allocate worktrees, lookup runtimes, start provider sessions, or write sidecars.
- Workspace safety: planned implementation worktree root is checked before `git worktree add`; cleanup semantics remain unchanged.
- State stores: audit JSONL append, sequence ordering, corrupt JSONL, lock behavior.
- Auth posture: no API-key fallback is introduced; live smoke remains opt-in and policy-reported.
- Documentation: policy config is documented without provider-specific MCP schemas or hidden prompt details.

Live provider smoke is not required for M41 because the milestone adds fixture-proven local policy and audit controls. It does not make real-provider readiness, provider ranking, model-quality, benchmark, or long-context claims.

## Success Criteria

- Config loads `policy` with conservative defaults that preserve existing behavior unless restrictions are explicitly configured.
- Config rejects unknown roles, empty selectors, unsupported capability selectors, invalid booleans, and invalid worktree roots in policy fields.
- Policy evaluator blocks disallowed roles, disallowed selected providers, write mode denied by policy, and planned worktree roots outside policy.
- Dispatch and lifecycle start paths evaluate policy before prompt construction, provider runtime lookup, worktree allocation, provider session start, or provider process spawn.
- Blocked dispatch returns durable failure evidence without invoking provider runtime or writing prompt/provider session details.
- Blocked lifecycle starts throw before sidecar/worktree/provider side effects and write a sanitized audit record when audit is enabled.
- Audit records are append-only, ordered, recoverable, and sanitized.
- Doctor reports policy posture and actionable failures for denied write mode, missing live-smoke policy, role availability, provider restrictions, and worktree-root restrictions.
- README, runbook, changelog, and roadmap document policy/audit behavior as provider-neutral control-plane hardening.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## Task 1: Red Tests For Config And Pure Policy

**Files:**

- Modify: `tests/core/config.test.ts`
- Create: `tests/core/policy.test.ts`
- Modify: `src/core/types.ts`

- [ ] **Step 1: Write failing config tests**

Add tests proving:

- Missing config defaults `policy` to allowed all roles/providers, `allowWriteMode: true`, no worktree-root restriction, `liveSmokeEnabled: false`, and `auditEnabled: true`.
- Explicit policy arrays load role ids, provider selectors, and worktree roots.
- Invalid role ids fail with `AgentTeamConfigError`.
- Empty provider selectors and unsupported `capability:` selectors fail.
- Non-string worktree roots fail.
- `allowWriteMode`, `liveSmokeEnabled`, and `auditEnabled` must be booleans when present.

Run:

```bash
npm test -- tests/core/config.test.ts
```

Expected red: `AgentTeamConfig` has no `policy` field and config parser ignores these policy validations.

- [ ] **Step 2: Write failing pure policy tests**

Create `tests/core/policy.test.ts` proving:

- Allowed decisions include role, provider, execution policy, and sanitized details.
- `allowedRoles` blocks a role before provider work.
- `allowedProviderSelectors` supports exact provider id, `family:`, `model:`, and `capability:` selectors.
- `allowWriteMode: false` blocks `isolated-edit` when write mode is enabled.
- `allowedWorktreeRoots` blocks planned worktree roots outside configured roots and allows descendants.
- Decision details never include prompt text, prompt hash, provider session id, command args, raw env, or secrets.

Run:

```bash
npm test -- tests/core/policy.test.ts
```

Expected red: `src/core/policy.ts` does not exist.

## Task 2: Implement Policy Types, Config Parsing, And Evaluator

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`
- Create: `src/core/policy.ts`
- Modify: `tests/core/config.test.ts`
- Modify: `tests/core/policy.test.ts`

- [ ] **Step 1: Add policy types and defaults**

Add `AgentTeamPolicyConfig`, include it in `AgentTeamConfig`, and update `DEFAULT_AGENT_TEAM_CONFIG`.

- [ ] **Step 2: Parse and validate policy config**

Add strict parser helpers for arrays and boolean fields. Reuse the existing role id set and routing selector validation for provider selectors.

- [ ] **Step 3: Implement pure policy evaluator**

Create `src/core/policy.ts` with provider selector matching, root containment checks based on resolved absolute paths, and sanitized decision details.

- [ ] **Step 4: Verify green**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/policy.test.ts
```

Expected green: config and pure policy tests pass.

## Task 3: Red Tests For Audit Store

**Files:**

- Create: `tests/core/state/audit-store.test.ts`
- Modify: `src/core/state/paths.ts`
- Create: `src/core/state/audit-store.ts`

- [ ] **Step 1: Write failing audit-store tests**

Add tests proving:

- `appendAuditRecord()` creates `.agent-team/audit/events.jsonl`.
- Sequence numbers increment from 1.
- `readAuditRecords()` returns ordered records.
- Corrupt audit JSONL throws `StateCorruptionError` with `kind: "jsonl"` and the audit path.
- Appended records do not contain prompt text, prompt hashes, provider session ids, command args, raw mailbox payloads, process ids, or secrets.

Run:

```bash
npm test -- tests/core/state/audit-store.test.ts
```

Expected red: audit paths and audit store do not exist.

## Task 4: Implement Audit Store

**Files:**

- Modify: `src/core/state/paths.ts`
- Create: `src/core/state/audit-store.ts`
- Create: `tests/core/state/audit-store.test.ts`

- [ ] **Step 1: Add audit paths**

Add `auditDir(workspaceRoot)` and `auditEventsPath(workspaceRoot)` to `src/core/state/paths.ts`.

- [ ] **Step 2: Implement append/read audit records**

Use the mailbox-store pattern: create the directory, acquire a `.lock` directory, read existing records for the next sequence, append one JSON line, and surface corrupt JSONL as `StateCorruptionError`.

- [ ] **Step 3: Verify green**

Run:

```bash
npm test -- tests/core/state/audit-store.test.ts
```

Expected green: audit store tests pass.

## Task 5: Red Tests For Dispatch And Lifecycle Enforcement

**Files:**

- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`
- Modify: `tests/core/workspaces.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`

- [ ] **Step 1: Write failing dispatch tests**

Add tests proving:

- Disallowed role returns a failed dispatch result before provider runtime is invoked.
- Disallowed selected provider returns a failed dispatch result before provider runtime is invoked.
- Allowed dispatch appends a sanitized `policy_allowed` audit record before provider runtime is invoked.
- If audit append fails while audit is enabled, dispatch fails before provider runtime is invoked.

Run:

```bash
npm test -- tests/core/dispatch.test.ts
```

Expected red: dispatch does not evaluate policy or write audit records.

- [ ] **Step 2: Write failing lifecycle tests**

Add tests proving:

- Disallowed role throws before `startSession`, `allocateWorkspace`, sidecar writes, or prompt evidence.
- Disallowed provider throws before `startSession`.
- `allowWriteMode: false` blocks `slice-implementer` before worktree allocation.
- Allowed start appends a sanitized audit record before provider session start.
- Audit append failure blocks start before provider session start.

Run:

```bash
npm test -- tests/core/lifecycle.test.ts
```

Expected red: lifecycle does not evaluate policy or write audit records.

- [ ] **Step 3: Write failing workspace-root tests**

Add tests proving:

- `allocateIsolatedWorktree()` accepts an explicit allowed execution root and rejects planned paths outside it before `git worktree add`.
- `LifecycleRegistry` config identity changes when policy changes.

Run:

```bash
npm test -- tests/core/workspaces.test.ts tests/core/lifecycle-registry.test.ts
```

Expected red: workspace allocation and registry identity do not know policy config yet.

## Task 6: Implement Dispatch, Lifecycle, And Workspace Enforcement

**Files:**

- Modify: `src/core/dispatch.ts`
- Modify: `src/core/lifecycle.ts`
- Modify: `src/core/workspaces.ts`
- Modify: `src/core/lifecycle-registry.ts`
- Modify: `tests/core/dispatch.test.ts`
- Modify: `tests/core/lifecycle.test.ts`
- Modify: `tests/core/workspaces.test.ts`
- Modify: `tests/core/lifecycle-registry.test.ts`

- [ ] **Step 1: Add policy/audit dependencies**

Add injectable `appendAudit` dependencies to dispatch and lifecycle tests without changing public MCP schemas. Use `appendAuditRecord` by default when `config.policy.auditEnabled` is true.

- [ ] **Step 2: Enforce policy in dispatch**

Select provider using the existing router, evaluate policy, append audit record, and only then build prompts or call provider runtime. For blocked policy, write a failed sidecar with `blockedVerdict()` and sanitized audit evidence, but do not call runtime.

- [ ] **Step 3: Enforce policy in lifecycle starts**

Select provider, compute planned worktree root for implementation roles, evaluate policy, append audit, and only then allocate worktree, build prompt, write sidecar, or start provider session.

- [ ] **Step 4: Enforce allowed worktree roots in workspace allocator**

Extend `allocateIsolatedWorktree()` to accept `allowedExecutionRoots` and reject planned paths outside those roots before `git worktree add`.

- [ ] **Step 5: Verify green**

Run:

```bash
npm test -- tests/core/dispatch.test.ts tests/core/lifecycle.test.ts tests/core/workspaces.test.ts tests/core/lifecycle-registry.test.ts
```

Expected green: policy enforcement and workspace tests pass.

## Task 7: Doctor And Docs

**Files:**

- Modify: `src/doctor.ts`
- Modify: `tests/doctor.test.ts`
- Modify: `tests/docs/packaging.test.ts`
- Modify: `tests/docs/runbook.test.ts`
- Modify: `README.md`
- Modify: `docs/runbooks/claude-team-session.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-41.md`

- [ ] **Step 1: Write failing doctor/docs tests**

Add tests proving:

- Doctor reports policy posture with allowed roles, provider selectors, audit enabled, live smoke enabled, and allowed worktree roots.
- Doctor fails when `writeMode.enabled` conflicts with `policy.allowWriteMode: false`.
- Doctor warns or reports when live smoke is disabled without making it a CI failure.
- Docs mention policy config, audit records, and opt-in live smoke policy.

Run:

```bash
npm test -- tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected red: doctor and docs do not yet report M41 policy/audit controls.

- [ ] **Step 2: Implement doctor policy checks and docs**

Add `policy` and `policy-write-mode` checks in doctor. Update README, runbook, changelog, roadmap, and this plan with final evidence.

- [ ] **Step 3: Verify green**

Run:

```bash
npm test -- tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

Expected green: doctor/docs tests pass.

## Task 8: Verification, Roadmap, And Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md`
- Modify: `docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-41.md`

- [ ] **Step 1: Run focused milestone tests**

Run:

```bash
npm test -- tests/core/config.test.ts tests/core/policy.test.ts tests/core/state/audit-store.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts tests/core/workspaces.test.ts tests/core/lifecycle-registry.test.ts tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp-stdio
npm run ci
```

- [ ] **Step 3: Run invariant scans**

Run:

```bash
rg "allowApiKeyFallback|API key|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|subscription OAuth|authMode" src tests docs README.md CHANGELOG.md
rg "bypassPermissions|permissionMode|acceptEdits|bare" src/providers tests/providers src/core tests/core
rg "benchmark|model-quality|mock LLM|embedding|heuristic|quality claim|comparison|ranking" src tests docs README.md CHANGELOG.md
rg "internal prompt|hidden instruction|generated agent definition|provider-specific MCP|provider-specific schema|promptHash|providerSessionId|payload|secret|process id|command args" src tests docs README.md CHANGELOG.md
rg "process.kill|SIGKILL|automatic cleanup|workspace_cleanup_removed|cleanupRunWorkspace|agent_team_policy|audit.*prompt|audit.*session|audit.*command" src tests docs README.md CHANGELOG.md
```

- [ ] **Step 4: Mark milestone complete**

Update this plan with red/green evidence and mark checkboxes complete only after proof is captured.

Update roadmap:

- Change current baseline to completed through Milestone 41.
- Add policy/audit controls to baseline.
- Add M41 status: complete, provider-neutral, fail-closed, audit-backed.
- Move near-term recommendation to M42.

- [ ] **Step 5: Commit implementation branch**

Run:

```bash
git diff --check
git status --short
git add src tests README.md CHANGELOG.md docs/runbooks/claude-team-session.md docs/superpowers/plans/2026-05-12-agent-team-mcp-long-term-roadmap.md docs/superpowers/plans/2026-05-12-agent-team-mcp-milestone-41.md
git commit -m "feat: add policy and audit controls"
```

## Verification Evidence

- Baseline before implementation: `npm test` passed before M41 production wiring with 49 files and 385 tests.
- Red proof:
  - `npm test -- tests/core/config.test.ts tests/core/policy.test.ts tests/core/state/audit-store.test.ts` first failed because policy config, policy evaluator, and audit store did not exist or were not parsed yet.
  - `npm test -- tests/core/dispatch.test.ts tests/core/lifecycle.test.ts tests/core/workspaces.test.ts tests/core/lifecycle-registry.test.ts` first failed because dispatch/lifecycle did not evaluate policy, audit appends did not run before provider execution, worktree root gating happened too late, and lifecycle registry identity ignored policy.
  - `npm test -- tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` first failed because doctor/docs did not report M41 policy and audit controls.
  - Reviewer follow-up red proof: `npm test -- tests/core/lifecycle.test.ts` failed because reply/resume starts did not audit before provider start and did not block disallowed roles before start side effects.
- Focused milestone proof:
  - `npm test -- tests/core/lifecycle.test.ts tests/core/policy.test.ts tests/core/workspaces.test.ts` passed after adding planned worktree-root policy and reply/resume policy/audit gates.
  - `npm test -- tests/core/config.test.ts tests/core/policy.test.ts tests/core/state/audit-store.test.ts tests/core/dispatch.test.ts tests/core/lifecycle.test.ts tests/core/workspaces.test.ts tests/core/lifecycle-registry.test.ts tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` passed with 10 files and 145 tests.
  - `npm test -- tests/doctor.test.ts tests/docs/packaging.test.ts tests/docs/runbook.test.ts` passed with 3 files and 35 tests.
- Full proof:
  - `npm run typecheck` passed.
  - `npm test` passed with 51 files and 410 tests.
  - `npm run build` passed.
  - `npm run smoke:mcp-stdio` passed.
  - `npm run ci` passed: typecheck, all 410 tests, build, and packaged stdio smoke.
- Invariant scans:
  - Cleanup/process scans reported expected pre-existing cleanup APIs/events, existing Claude process kill fallback tests/runtime, and plan/docs guardrails; no new automatic cleanup or process-kill shortcut was introduced by M41.
  - Prompt/session/command audit scans reported expected negative assertions and docs saying audit records must not contain prompts, provider session ids, command details, payloads, secrets, process metadata, or environment values.
  - Model-quality/benchmark scans reported existing role/docs/plan guardrails only; M41 makes no live-provider, ranking, benchmark, or model-quality claim.
