# Agent Team MCP Milestone 64: Superpowers Workflow Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Superpowers-style guided workflow and hook layer that tells Codex what the agent team should do next without auto-merging, hiding dissent, or bypassing senior-engineer control.

**Architecture:** Add a provider-neutral workflow guidance layer above the existing durable workflow records. The new layer derives phase, hook events, steering truth, approval gates, and safe next actions from workflow state, provider capabilities, mailboxes, slice evidence, and review status. Public MCP tools expose sanitized guidance and user decision recording while keeping internal prompts, raw provider payloads, secrets, provider command details, and merge execution private.

**Tech Stack:** TypeScript, Node.js ESM, MCP SDK, Zod schemas, Vitest, durable `.agent-team/` workflow state, existing provider registry, existing workflow orchestrator tools, packaged stdio smoke scripts.

---

## Success Criteria

- Codex can ask the plugin, "what should happen next?" for a workflow and receive a deterministic, provider-neutral, sanitized answer.
- The workflow guidance models the Superpowers loop: brainstorm with the user, write a plan, obtain user approval, execute TDD slices, run review consensus, integrate one reviewed slice at a time, verify, report completion, and clean up evidence only through explicit lifecycle tools.
- Hooks are advisory first. They never start providers, merge code, delete worktrees, mark tests as passed, or invent completion.
- User-facing escalations are filtered to product, CEO, trust, cost, release, permission, or practical user-impact questions.
- Technical disagreements are routed to Codex for senior-engineer resolution with evidence.
- Claude Opus planning and implementation sign-off remains default-on as `required-when-available`; unavailable Opus records degraded senior-review evidence and user notification.
- Provider steering is truthful. The plugin distinguishes `live`, `recorded_for_resume`, `follow_up_run`, `cancel_wind_down`, and `unsupported` instead of claiming all agents can be steered mid-flight.
- Junior-provider policy is explicit: Ollama Cloud Kimi, GLM, and DeepSeek style profiles can receive bounded implementation or review tasks only when configured, must stay isolated, and require senior review before integration.
- Gemini can be assigned fully autonomous worker slices when configured, but the default guidance should prefer it for UI, UX, frontend, visual, and browser-flow surfaces unless user policy overrides it.
- Claude Opus is preferred for planning, high-complexity review, architecture, security-sensitive decisions, and final senior sign-off; Claude Sonnet and Codex CLI are preferred for execution; Claude Haiku is preferred for search and reconnaissance.
- Public MCP schemas and smoke outputs do not reveal internal prompts, raw provider payloads, provider-specific command args, secrets, or hidden policy internals.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## File Structure

- Create `src/core/workflow-guidance.ts`
  - Owns phase derivation, next-action construction, approval-gate evaluation, and user-escalation filtering.
- Create `src/core/workflow-hooks.ts`
  - Defines hook events and deterministic hook planning from workflow state.
- Create `src/core/workflow-steering-policy.ts`
  - Defines steering modes by provider capabilities, run state, stdin availability, and lifecycle status.
- Create `src/core/workflow-role-policy.ts`
  - Defines role-to-provider guidance preferences without hard-routing public MCP schemas to provider-specific details.
- Create `tests/core/workflow-guidance.test.ts`
  - Covers phase derivation, approval gates, user-decision filtering, and no hidden auto-actions.
- Create `tests/core/workflow-hooks.test.ts`
  - Covers ordered hook events, blocked/unblocked transitions, review/integration progression, and completion gates.
- Create `tests/core/workflow-steering-policy.test.ts`
  - Covers live versus recorded steering truth for Claude Code, Codex CLI, Gemini CLI, and OpenAI-compatible/Ollama profiles.
- Create `tests/core/workflow-role-policy.test.ts`
  - Covers Opus/Sonnet/Haiku/Codex/Gemini/Ollama policy recommendations and junior-provider containment.
- Modify `src/server/tools.ts`
  - Register `agent_team_workflow_next`.
  - Register `agent_team_record_user_decision`.
- Create `tests/server/workflow-guidance-tools.test.ts`
  - Covers public MCP output sanitization, schema validation, state mutation boundaries, and decision recording.
- Modify `scripts/packaged-stdio-smoke.mjs`
  - Include `agent_team_workflow_next` and `agent_team_record_user_decision` metadata checks.
- Create `scripts/invariant-scan-workflow-guidance.mjs`
  - Fails if public guidance fixtures expose raw prompts, secrets, command args, or provider payload fields.
- Modify `package.json`
  - Add `scan:workflow-guidance`.
  - Add the new scan to `ci`.
- Modify `README.md`
  - Add a concise operator section for guided workflows and hook semantics.
- Modify `docs/superpowers/specs/2026-05-13-l11-agent-team-workflow-orchestrator-design.md`
  - Add the final hook hierarchy and steering truth table once implementation names are stable.

## Public Tool Contracts

### `agent_team_workflow_next`

Input:

```ts
{
  cwd?: string;
  workflowId: string;
  includeSteering?: boolean;
  includeRolePolicy?: boolean;
}
```

Output:

```ts
{
  workflowId: string;
  phase:
    | "brainstorming"
    | "planning"
    | "awaiting_user_plan_approval"
    | "approved"
    | "executing"
    | "reviewing"
    | "awaiting_integration"
    | "integrating"
    | "validating"
    | "cleanup_ready"
    | "completed"
    | "escalated"
    | "blocked";
  hooks: Array<{
    hookId: string;
    kind:
      | "brainstorm_with_user"
      | "write_plan"
      | "request_user_plan_approval"
      | "start_ready_slices"
      | "record_mailbox_update"
      | "review_slice"
      | "queue_integration"
      | "record_integration"
      | "run_verification"
      | "report_completion"
      | "cleanup_evidence"
      | "escalate_user_decision";
    priority: "required" | "recommended" | "optional";
    reason: string;
    safeToolName?: string;
    safeInputSummary?: Record<string, unknown>;
  }>;
  userEscalations: Array<{
    category: "product" | "trust" | "cost" | "release" | "permission" | "user_impact";
    question: string;
    practicalEffect: string;
  }>;
  blockedReasons: Array<{
    code: string;
    message: string;
    evidenceRef?: string;
  }>;
  seniorReview: {
    opusPlanning: "not_requested" | "requested" | "signed_off" | "degraded_unavailable" | "blocking";
    opusImplementation: "not_requested" | "requested" | "signed_off" | "degraded_unavailable" | "blocking";
  };
}
```

The output intentionally returns `safeInputSummary`, not raw provider prompts or complete tool payloads.

### `agent_team_record_user_decision`

Input:

```ts
{
  cwd?: string;
  workflowId: string;
  decisionId?: string;
  category: "product" | "trust" | "cost" | "release" | "permission" | "user_impact";
  decision: "approve" | "reject" | "defer" | "choose_option";
  summary: string;
  practicalEffect: string;
  selectedOption?: string;
}
```

Output:

```ts
{
  workflowId: string;
  recorded: true;
  decisionRef: string;
  nextPhase: string;
  nextHookKinds: string[];
}
```

## Task 1: Add Workflow Guidance Types And Phase Derivation

**Files:**
- Create: `src/core/workflow-guidance.ts`
- Test: `tests/core/workflow-guidance.test.ts`

- [ ] **Step 1: Write the failing phase-derivation tests**

Add tests for approval, execution, review, integration, validation, cleanup, and completion.

```ts
import { describe, expect, it } from "vitest";
import { deriveWorkflowGuidance } from "../../src/core/workflow-guidance.js";
import type { WorkflowRecord } from "../../src/core/workflow-state.js";

function workflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return {
    workflowId: "wf_123",
    cwd: "/repo",
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    goalPacket: {
      goal: "Ship a production-ready feature",
      nonGoals: [],
      successCriteria: ["Tests pass"],
      constraints: [],
      targetRoles: [],
      proposedSlices: [],
      risks: []
    },
    sliceDag: [],
    consensus: [],
    seniorReview: {
      opusPlanning: { mode: "required-when-available", status: "not_requested" },
      opusImplementation: { mode: "required-when-available", status: "not_requested" }
    },
    userEscalations: [],
    integrationQueue: [],
    integrationRecords: [],
    completionReports: [],
    ...overrides
  };
}

describe("deriveWorkflowGuidance", () => {
  it("requires user plan approval after planning consensus signs off", () => {
    const result = deriveWorkflowGuidance(
      workflow({
        consensus: [
          {
            consensusId: "consensus_1",
            status: "approved",
            roundCount: 2,
            codexRationale: "Plan is coherent",
            createdAt: "2026-05-13T00:01:00.000Z",
            updatedAt: "2026-05-13T00:02:00.000Z",
            verdicts: []
          }
        ]
      })
    );

    expect(result.phase).toBe("awaiting_user_plan_approval");
    expect(result.hooks.map((hook) => hook.kind)).toContain("request_user_plan_approval");
    expect(result.hooks.every((hook) => hook.safeInputSummary)).toBe(true);
  });

  it("does not claim completion until final verification and cleanup readiness are recorded", () => {
    const result = deriveWorkflowGuidance(
      workflow({
        sliceDag: [
          { sliceId: "slice_a", state: "integrated", dependencies: [], role: "slice-implementer", writeScope: ["src/a.ts"], riskLevel: "medium" }
        ],
        integrationRecords: [
          { integrationId: "int_1", sliceId: "slice_a", status: "integrated", evidenceRefs: ["run_1"], createdAt: "2026-05-13T00:03:00.000Z" }
        ]
      })
    );

    expect(result.phase).toBe("validating");
    expect(result.hooks.map((hook) => hook.kind)).toContain("run_verification");
    expect(result.hooks.map((hook) => hook.kind)).not.toContain("report_completion");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/core/workflow-guidance.test.ts`

Expected: FAIL with a module-not-found error for `src/core/workflow-guidance.ts`.

- [ ] **Step 3: Implement guidance types and phase derivation**

Create `src/core/workflow-guidance.ts`:

```ts
import type { WorkflowRecord } from "./workflow-state.js";

export type WorkflowGuidancePhase =
  | "brainstorming"
  | "planning"
  | "awaiting_user_plan_approval"
  | "approved"
  | "executing"
  | "reviewing"
  | "awaiting_integration"
  | "integrating"
  | "validating"
  | "cleanup_ready"
  | "completed"
  | "escalated"
  | "blocked";

export type WorkflowHookKind =
  | "brainstorm_with_user"
  | "write_plan"
  | "request_user_plan_approval"
  | "start_ready_slices"
  | "record_mailbox_update"
  | "review_slice"
  | "queue_integration"
  | "record_integration"
  | "run_verification"
  | "report_completion"
  | "cleanup_evidence"
  | "escalate_user_decision";

export type WorkflowGuidanceHook = {
  hookId: string;
  kind: WorkflowHookKind;
  priority: "required" | "recommended" | "optional";
  reason: string;
  safeToolName?: string;
  safeInputSummary?: Record<string, unknown>;
};

export type WorkflowGuidance = {
  workflowId: string;
  phase: WorkflowGuidancePhase;
  hooks: WorkflowGuidanceHook[];
  userEscalations: Array<{
    category: "product" | "trust" | "cost" | "release" | "permission" | "user_impact";
    question: string;
    practicalEffect: string;
  }>;
  blockedReasons: Array<{ code: string; message: string; evidenceRef?: string }>;
  seniorReview: {
    opusPlanning: string;
    opusImplementation: string;
  };
};

export function deriveWorkflowGuidance(record: WorkflowRecord): WorkflowGuidance {
  const phase = derivePhase(record);
  return {
    workflowId: record.workflowId,
    phase,
    hooks: hooksForPhase(record, phase),
    userEscalations: publicUserEscalations(record),
    blockedReasons: blockedReasons(record),
    seniorReview: {
      opusPlanning: record.seniorReview.opusPlanning.status,
      opusImplementation: record.seniorReview.opusImplementation.status
    }
  };
}

function derivePhase(record: WorkflowRecord): WorkflowGuidancePhase {
  if (record.userEscalations.some((escalation) => escalation.status === "open")) return "escalated";
  if (record.sliceDag.some((slice) => slice.state === "failed" || slice.state === "blocked")) return "blocked";
  if (record.completionReports.some((report) => report.status === "complete")) return "completed";
  if (record.integrationRecords.length > 0 && record.sliceDag.every((slice) => slice.state === "integrated")) return "validating";
  if (record.integrationQueue.length > 0) return "awaiting_integration";
  if (record.sliceDag.some((slice) => slice.state === "approved")) return "awaiting_integration";
  if (record.sliceDag.some((slice) => slice.state === "awaiting-review" || slice.state === "needs-revision")) return "reviewing";
  if (record.sliceDag.some((slice) => slice.state === "running" || slice.state === "ready")) return "executing";
  if (record.sliceDag.some((slice) => slice.state === "planned")) return "approved";
  if (record.consensus.some((consensus) => consensus.status === "approved")) return "awaiting_user_plan_approval";
  if (record.consensus.length > 0) return "planning";
  return "brainstorming";
}

function hooksForPhase(record: WorkflowRecord, phase: WorkflowGuidancePhase): WorkflowGuidanceHook[] {
  switch (phase) {
    case "brainstorming":
      return [hook("brainstorm_with_user", "required", "Capture product goal, non-goals, success criteria, and practical user effects.", "agent_team_create_workflow", { workflowId: record.workflowId })];
    case "planning":
      return [hook("write_plan", "required", "Run planning consensus until Codex and required senior review have enough evidence.", "agent_team_plan_consensus", { workflowId: record.workflowId })];
    case "awaiting_user_plan_approval":
      return [hook("request_user_plan_approval", "required", "User approval is required before implementation slices start.", "agent_team_record_user_decision", { workflowId: record.workflowId, category: "product" })];
    case "approved":
    case "executing":
      return [hook("start_ready_slices", "recommended", "Start ready independent slices with bounded concurrency.", "agent_team_start_slices", { workflowId: record.workflowId })];
    case "reviewing":
      return [hook("review_slice", "required", "Review implementation evidence before integration.", "agent_team_review_slice", { workflowId: record.workflowId })];
    case "awaiting_integration":
      return [hook("queue_integration", "required", "Compute read-only integration queue before Codex integrates a slice.", "agent_team_integration_queue", { workflowId: record.workflowId })];
    case "integrating":
      return [hook("record_integration", "required", "Record Codex-owned integration evidence after a manual integration step.", "agent_team_record_integration", { workflowId: record.workflowId })];
    case "validating":
      return [hook("run_verification", "required", "Run focused tests, typecheck, full tests, build, packaged smoke, invariant scans, and npm run ci before completion.", undefined, { workflowId: record.workflowId })];
    case "cleanup_ready":
      return [hook("cleanup_evidence", "recommended", "Cleanup retained temporary worktrees only after evidence and integration records are saved.", undefined, { workflowId: record.workflowId })];
    case "completed":
      return [hook("report_completion", "optional", "Report verified completion without inventing new work.", "agent_team_workflow_report", { workflowId: record.workflowId })];
    case "escalated":
      return [hook("escalate_user_decision", "required", "Ask the user only for the practical product, trust, cost, release, permission, or user-impact decision.", "agent_team_record_user_decision", { workflowId: record.workflowId })];
    case "blocked":
      return [hook("record_mailbox_update", "recommended", "Record blocker evidence, unblock dependencies, or create a follow-up slice.", "agent_team_unblock_slice", { workflowId: record.workflowId })];
  }
}

function hook(kind: WorkflowHookKind, priority: WorkflowGuidanceHook["priority"], reason: string, safeToolName?: string, safeInputSummary?: Record<string, unknown>): WorkflowGuidanceHook {
  return {
    hookId: `hook_${kind}`,
    kind,
    priority,
    reason,
    safeToolName,
    safeInputSummary: safeInputSummary ?? {}
  };
}

function publicUserEscalations(record: WorkflowRecord): WorkflowGuidance["userEscalations"] {
  return record.userEscalations
    .filter((escalation) => escalation.status === "open")
    .filter((escalation) => ["product", "trust", "cost", "release", "permission", "user_impact"].includes(escalation.category))
    .map((escalation) => ({
      category: escalation.category,
      question: escalation.question,
      practicalEffect: escalation.practicalEffect
    }));
}

function blockedReasons(record: WorkflowRecord): WorkflowGuidance["blockedReasons"] {
  return record.sliceDag
    .filter((slice) => slice.state === "blocked" || slice.state === "failed")
    .map((slice) => ({
      code: `slice_${slice.state}`,
      message: `${slice.sliceId} is ${slice.state}`,
      evidenceRef: slice.sliceId
    }));
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/core/workflow-guidance.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/workflow-guidance.ts tests/core/workflow-guidance.test.ts
git commit -m "feat: derive guided workflow phases"
```

Expected: commit succeeds.

## Task 2: Add Hook Planner Ordering And Safety Tests

**Files:**
- Create: `src/core/workflow-hooks.ts`
- Test: `tests/core/workflow-hooks.test.ts`

- [ ] **Step 1: Write failing hook-ordering tests**

```ts
import { describe, expect, it } from "vitest";
import { planWorkflowHooks } from "../../src/core/workflow-hooks.js";

describe("planWorkflowHooks", () => {
  it("orders user approval before slice starts", () => {
    const result = planWorkflowHooks({
      workflowId: "wf_approval",
      phase: "awaiting_user_plan_approval",
      hooks: [
        { hookId: "hook_start_ready_slices", kind: "start_ready_slices", priority: "recommended", reason: "Start work", safeInputSummary: {} },
        { hookId: "hook_request_user_plan_approval", kind: "request_user_plan_approval", priority: "required", reason: "Approve plan", safeInputSummary: {} }
      ],
      userEscalations: [],
      blockedReasons: [],
      seniorReview: { opusPlanning: "signed_off", opusImplementation: "not_requested" }
    });

    expect(result.hooks.map((hook) => hook.kind)).toEqual(["request_user_plan_approval", "start_ready_slices"]);
    expect(result.mutatesSource).toBe(false);
    expect(result.startsProvider).toBe(false);
  });

  it("marks completion report unavailable when final gates are missing", () => {
    const result = planWorkflowHooks({
      workflowId: "wf_gates",
      phase: "validating",
      hooks: [{ hookId: "hook_run_verification", kind: "run_verification", priority: "required", reason: "Run gates", safeInputSummary: {} }],
      userEscalations: [],
      blockedReasons: [],
      seniorReview: { opusPlanning: "signed_off", opusImplementation: "signed_off" }
    });

    expect(result.hooks.map((hook) => hook.kind)).toEqual(["run_verification"]);
    expect(result.canReportCompletion).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/core/workflow-hooks.test.ts`

Expected: FAIL with a module-not-found error for `src/core/workflow-hooks.ts`.

- [ ] **Step 3: Implement hook planning**

Create `src/core/workflow-hooks.ts`:

```ts
import type { WorkflowGuidance, WorkflowGuidanceHook } from "./workflow-guidance.js";

const priorityRank: Record<WorkflowGuidanceHook["priority"], number> = {
  required: 0,
  recommended: 1,
  optional: 2
};

const kindRank: Record<WorkflowGuidanceHook["kind"], number> = {
  brainstorm_with_user: 0,
  write_plan: 1,
  request_user_plan_approval: 2,
  start_ready_slices: 3,
  record_mailbox_update: 4,
  review_slice: 5,
  queue_integration: 6,
  record_integration: 7,
  run_verification: 8,
  report_completion: 9,
  cleanup_evidence: 10,
  escalate_user_decision: 11
};

export type PlannedWorkflowHooks = {
  workflowId: string;
  hooks: WorkflowGuidanceHook[];
  mutatesSource: false;
  startsProvider: false;
  canReportCompletion: boolean;
};

export function planWorkflowHooks(guidance: WorkflowGuidance): PlannedWorkflowHooks {
  const hooks = [...guidance.hooks].sort((a, b) => {
    const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
    if (byPriority !== 0) return byPriority;
    return kindRank[a.kind] - kindRank[b.kind];
  });

  return {
    workflowId: guidance.workflowId,
    hooks,
    mutatesSource: false,
    startsProvider: false,
    canReportCompletion: guidance.phase === "completed"
  };
}
```

- [ ] **Step 4: Run focused hook tests**

Run: `npm test -- tests/core/workflow-hooks.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/workflow-hooks.ts tests/core/workflow-hooks.test.ts
git commit -m "feat: plan safe workflow hooks"
```

Expected: commit succeeds.

## Task 3: Add Provider Steering Truth Matrix

**Files:**
- Create: `src/core/workflow-steering-policy.ts`
- Test: `tests/core/workflow-steering-policy.test.ts`

- [ ] **Step 1: Write failing steering-policy tests**

```ts
import { describe, expect, it } from "vitest";
import { deriveSteeringMode } from "../../src/core/workflow-steering-policy.js";

describe("deriveSteeringMode", () => {
  it("reports recorded-for-resume when a Claude Code run cannot receive stdin anymore", () => {
    expect(
      deriveSteeringMode({
        providerId: "claude-code",
        runState: "running",
        supportsStdin: false,
        supportsSessionResume: true,
        supportsCancellation: true
      })
    ).toEqual({
      mode: "recorded_for_resume",
      canCancel: true,
      canWindDown: true,
      reason: "Provider can use durable mailbox evidence on resume or follow-up, but this run is not live-stdin steerable."
    });
  });

  it("reports unsupported for synchronous read-only providers without resume", () => {
    expect(
      deriveSteeringMode({
        providerId: "openai-compatible",
        runState: "running",
        supportsStdin: false,
        supportsSessionResume: false,
        supportsCancellation: false
      }).mode
    ).toBe("unsupported");
  });

  it("reports follow-up run for Codex CLI when background steering is unavailable", () => {
    expect(
      deriveSteeringMode({
        providerId: "codex-cli",
        runState: "running",
        supportsStdin: false,
        supportsSessionResume: false,
        supportsCancellation: true
      }).mode
    ).toBe("follow_up_run");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/core/workflow-steering-policy.test.ts`

Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement steering policy**

Create `src/core/workflow-steering-policy.ts`:

```ts
export type SteeringMode = "live" | "recorded_for_resume" | "follow_up_run" | "cancel_wind_down" | "unsupported";

export type SteeringInput = {
  providerId: string;
  runState: "running" | "awaiting-input" | "winding-down" | "terminal" | "failed" | "cancelled";
  supportsStdin: boolean;
  supportsSessionResume: boolean;
  supportsCancellation: boolean;
};

export type SteeringDecision = {
  mode: SteeringMode;
  canCancel: boolean;
  canWindDown: boolean;
  reason: string;
};

export function deriveSteeringMode(input: SteeringInput): SteeringDecision {
  const canCancel = input.supportsCancellation && input.runState === "running";
  const canWindDown = input.runState === "running" || input.runState === "awaiting-input";

  if (input.runState !== "running" && input.runState !== "awaiting-input") {
    return {
      mode: "unsupported",
      canCancel: false,
      canWindDown: false,
      reason: "Run is not in a steerable lifecycle state."
    };
  }

  if (input.supportsStdin) {
    return {
      mode: "live",
      canCancel,
      canWindDown,
      reason: "Provider run has an open live input channel."
    };
  }

  if (input.supportsSessionResume) {
    return {
      mode: "recorded_for_resume",
      canCancel,
      canWindDown,
      reason: "Provider can use durable mailbox evidence on resume or follow-up, but this run is not live-stdin steerable."
    };
  }

  if (input.supportsCancellation) {
    return {
      mode: "follow_up_run",
      canCancel,
      canWindDown,
      reason: "Provider cannot receive live steering for this run; Codex can cancel or launch a follow-up run with mailbox evidence."
    };
  }

  return {
    mode: "unsupported",
    canCancel: false,
    canWindDown,
    reason: "Provider exposes no live steering, resume, or cancellation capability for this run."
  };
}
```

- [ ] **Step 4: Run focused steering tests**

Run: `npm test -- tests/core/workflow-steering-policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/workflow-steering-policy.ts tests/core/workflow-steering-policy.test.ts
git commit -m "feat: expose truthful workflow steering modes"
```

Expected: commit succeeds.

## Task 4: Add Role Policy Guidance

**Files:**
- Create: `src/core/workflow-role-policy.ts`
- Test: `tests/core/workflow-role-policy.test.ts`

- [ ] **Step 1: Write failing role-policy tests**

```ts
import { describe, expect, it } from "vitest";
import { recommendRolePolicy } from "../../src/core/workflow-role-policy.js";

describe("recommendRolePolicy", () => {
  it("prefers Opus for planning and high complexity review", () => {
    expect(recommendRolePolicy({ role: "planner", complexity: "high", surface: "architecture" }).preferredModelFamily).toBe("claude-opus");
    expect(recommendRolePolicy({ role: "code-reviewer", complexity: "high", surface: "security" }).requiredSeniorReview).toBe(true);
  });

  it("prefers Sonnet or Codex CLI for execution", () => {
    const policy = recommendRolePolicy({ role: "slice-implementer", complexity: "medium", surface: "backend" });
    expect(policy.preferredModelFamilies).toContain("claude-sonnet");
    expect(policy.preferredModelFamilies).toContain("codex-cli");
  });

  it("routes search-style reconnaissance to Haiku", () => {
    expect(recommendRolePolicy({ role: "researcher", complexity: "low", surface: "search" }).preferredModelFamily).toBe("claude-haiku");
  });

  it("keeps junior Ollama models bounded and reviewed", () => {
    const policy = recommendRolePolicy({ role: "slice-implementer", complexity: "low", surface: "backend", providerClass: "junior-ollama" });
    expect(policy.requiresIsolatedWorktree).toBe(true);
    expect(policy.requiredSeniorReview).toBe(true);
    expect(policy.maxSliceRisk).toBe("medium");
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/core/workflow-role-policy.test.ts`

Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement role policy recommendations**

Create `src/core/workflow-role-policy.ts`:

```ts
export type RolePolicyInput = {
  role: string;
  complexity: "low" | "medium" | "high";
  surface: "architecture" | "backend" | "frontend" | "ui-ux" | "security" | "performance" | "devops" | "docs" | "search";
  providerClass?: "senior-claude" | "codex" | "gemini" | "junior-ollama";
};

export type RolePolicyRecommendation = {
  preferredModelFamily: string;
  preferredModelFamilies: string[];
  requiredSeniorReview: boolean;
  requiresIsolatedWorktree: boolean;
  maxSliceRisk: "low" | "medium" | "high";
  rationale: string;
};

export function recommendRolePolicy(input: RolePolicyInput): RolePolicyRecommendation {
  if (input.surface === "search") {
    return recommendation(["claude-haiku"], false, false, "low", "Search and reconnaissance should default to fast low-cost Haiku-class models.");
  }

  if (input.role === "planner" || input.complexity === "high" || input.surface === "security") {
    return recommendation(["claude-opus"], true, false, "high", "Planning, high complexity, and security-sensitive review require senior reasoning.");
  }

  if (input.providerClass === "junior-ollama") {
    return recommendation(["kimi-k2.6", "glm-5.1", "deepseek"], true, true, "medium", "Junior Ollama profiles can help on bounded isolated slices only after senior review.");
  }

  if (input.providerClass === "gemini" || input.surface === "ui-ux" || input.surface === "frontend") {
    return recommendation(["gemini", "claude-sonnet", "codex-cli"], true, true, "medium", "Gemini is a strong fit for UI, UX, frontend, and visual implementation work when configured.");
  }

  return recommendation(["claude-sonnet", "codex-cli"], true, true, "high", "Execution should prefer Sonnet or Codex CLI with retained isolated worktrees.");
}

function recommendation(
  preferredModelFamilies: string[],
  requiredSeniorReview: boolean,
  requiresIsolatedWorktree: boolean,
  maxSliceRisk: "low" | "medium" | "high",
  rationale: string
): RolePolicyRecommendation {
  return {
    preferredModelFamily: preferredModelFamilies[0],
    preferredModelFamilies,
    requiredSeniorReview,
    requiresIsolatedWorktree,
    maxSliceRisk,
    rationale
  };
}
```

- [ ] **Step 4: Run focused role-policy tests**

Run: `npm test -- tests/core/workflow-role-policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/workflow-role-policy.ts tests/core/workflow-role-policy.test.ts
git commit -m "feat: guide workflow role provider policy"
```

Expected: commit succeeds.

## Task 5: Expose Guidance Through Public MCP Tools

**Files:**
- Modify: `src/server/tools.ts`
- Test: `tests/server/workflow-guidance-tools.test.ts`

- [ ] **Step 1: Write failing MCP tool tests**

```ts
import { describe, expect, it } from "vitest";
import { callToolForTest, listToolNamesForTest } from "./helpers/mcp-test-client.js";

describe("workflow guidance MCP tools", () => {
  it("lists workflow guidance tools", async () => {
    await expect(listToolNamesForTest()).resolves.toEqual(
      expect.arrayContaining(["agent_team_workflow_next", "agent_team_record_user_decision"])
    );
  });

  it("returns sanitized next actions without raw provider payloads", async () => {
    const create = await callToolForTest("agent_team_create_workflow", {
      goal: "Build a production-ready settings panel",
      successCriteria: ["User can save settings"],
      proposedSlices: []
    });

    const next = await callToolForTest("agent_team_workflow_next", {
      workflowId: create.workflowId,
      includeSteering: true,
      includeRolePolicy: true
    });

    expect(JSON.stringify(next)).not.toMatch(/systemPrompt|rawProvider|apiKey|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_API_KEY|commandArgs/);
    expect(next.workflowId).toBe(create.workflowId);
    expect(next.hooks.length).toBeGreaterThan(0);
  });

  it("records only product-level user decisions", async () => {
    const create = await callToolForTest("agent_team_create_workflow", {
      goal: "Improve onboarding",
      successCriteria: ["Fewer abandoned setups"],
      proposedSlices: []
    });

    await expect(
      callToolForTest("agent_team_record_user_decision", {
        workflowId: create.workflowId,
        category: "product",
        decision: "approve",
        summary: "Proceed with the approved user-facing flow",
        practicalEffect: "Users see the new onboarding default after release."
      })
    ).resolves.toMatchObject({ workflowId: create.workflowId, recorded: true });

    await expect(
      callToolForTest("agent_team_record_user_decision", {
        workflowId: create.workflowId,
        category: "technical",
        decision: "approve",
        summary: "Use a particular internal module split",
        practicalEffect: "No direct user effect."
      })
    ).rejects.toThrow(/category/i);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/server/workflow-guidance-tools.test.ts`

Expected: FAIL because the tools are not registered.

- [ ] **Step 3: Register MCP tools and handlers**

Modify `src/server/tools.ts` by adding schemas and handlers that:

- load the workflow record through the existing workflow-state reader
- call `deriveWorkflowGuidance`
- call `planWorkflowHooks`
- optionally attach steering and role policy summaries
- record user decisions into the workflow state using existing durable write helpers
- reject non-product categories at schema validation
- return sanitized objects only

Required schema categories:

```ts
const userDecisionCategorySchema = z.enum(["product", "trust", "cost", "release", "permission", "user_impact"]);
```

Required tool names:

```ts
"agent_team_workflow_next"
"agent_team_record_user_decision"
```

- [ ] **Step 4: Run focused MCP tool tests**

Run: `npm test -- tests/server/workflow-guidance-tools.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/server/tools.ts tests/server/workflow-guidance-tools.test.ts
git commit -m "feat: expose guided workflow MCP tools"
```

Expected: commit succeeds.

## Task 6: Add Packaged Smoke And Invariant Scan Coverage

**Files:**
- Modify: `scripts/packaged-stdio-smoke.mjs`
- Create: `scripts/invariant-scan-workflow-guidance.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add failing packaged smoke assertions**

In `scripts/packaged-stdio-smoke.mjs`, require the public tool list to include:

```js
const requiredWorkflowGuidanceTools = [
  "agent_team_workflow_next",
  "agent_team_record_user_decision"
];
```

Fail when either tool is absent.

- [ ] **Step 2: Add invariant scan script**

Create `scripts/invariant-scan-workflow-guidance.mjs`:

```js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "src/core/workflow-guidance.ts",
  "src/core/workflow-hooks.ts",
  "src/core/workflow-steering-policy.ts",
  "src/core/workflow-role-policy.ts",
  "src/server/tools.ts",
  "tests/server/workflow-guidance-tools.test.ts"
];

const forbidden = [
  /systemPrompt/i,
  /rawProvider/i,
  /rawPayload/i,
  /apiKey/i,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
  /OLLAMA_API_KEY/,
  /commandArgs/i
];

for (const file of files) {
  const text = readFileSync(resolve(file), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      console.error(`workflow guidance invariant failed: ${file} matched ${pattern}`);
      process.exitCode = 1;
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log("workflow guidance invariant scan passed");
```

- [ ] **Step 3: Wire scripts into `package.json`**

Add:

```json
{
  "scripts": {
    "scan:workflow-guidance": "node scripts/invariant-scan-workflow-guidance.mjs"
  }
}
```

Add `npm run scan:workflow-guidance` to `ci`.

- [ ] **Step 4: Run smoke and scan**

Run:

```bash
npm run build
npm run smoke:packaged-stdio
npm run scan:workflow-guidance
```

Expected: all pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/packaged-stdio-smoke.mjs scripts/invariant-scan-workflow-guidance.mjs package.json
git commit -m "test: smoke guided workflow tools"
```

Expected: commit succeeds.

## Task 7: Update Operator Docs And Design Spec

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-13-l11-agent-team-workflow-orchestrator-design.md`

- [ ] **Step 1: Add guided workflow docs**

Add a README section titled `Guided Agent Team Workflow` with these operator facts:

- Codex remains the senior engineer and final authority.
- The plugin recommends next actions; it does not execute hidden auto-progression.
- The user is asked only product-level or practical-impact questions.
- Implementation agents write only in retained isolated worktrees.
- Mid-flight steering depends on provider capability and current run state.
- Gemini can be a full autonomous worker when configured, with default guidance toward UI/UX/frontend work.
- Kimi, GLM, and DeepSeek style Ollama profiles are treated as junior bounded workers with required senior review.
- Opus is preferred for planning and high-complexity review; Sonnet and Codex CLI are preferred for execution; Haiku is preferred for search.

- [ ] **Step 2: Add hook hierarchy to the design spec**

Add a section titled `Hook Hierarchy`:

```md
1. Brainstorm with the user until product goal, non-goals, success criteria, and practical user effects are clear.
2. Write the plan and run planning consensus.
3. Request user approval for product-level plan effects.
4. Start ready independent slices with bounded concurrency.
5. Record mailbox updates for steering, blockers, and dependency unblocks.
6. Review implementation slices with Codex and senior review.
7. Queue integration in read-only mode.
8. Codex integrates one reviewed slice at a time.
9. Record integration evidence.
10. Run verification gates.
11. Report completion only when final gates are met.
12. Clean up retained worktrees and sidecars only after evidence is saved.
```

- [ ] **Step 3: Run docs and invariant checks**

Run:

```bash
npm run scan:workflow-guidance
npm run smoke:packaged-stdio
```

Expected: both pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add README.md docs/superpowers/specs/2026-05-13-l11-agent-team-workflow-orchestrator-design.md
git commit -m "docs: document guided workflow hooks"
```

Expected: commit succeeds.

## Final Verification

Run:

```bash
npm test -- tests/core/workflow-guidance.test.ts tests/core/workflow-hooks.test.ts tests/core/workflow-steering-policy.test.ts tests/core/workflow-role-policy.test.ts tests/server/workflow-guidance-tools.test.ts
npm run typecheck
npm test
npm run build
npm run smoke:packaged-stdio
npm run scan:workflow-guidance
npm run ci
```

Expected:

- Focused tests pass.
- Typecheck passes.
- Full tests pass.
- Build passes.
- Packaged stdio smoke sees the new public tools.
- Invariant scan proves public guidance does not expose internal prompts, secrets, raw provider payloads, or command args.
- `npm run ci` passes.

## Completion Criteria

- All tasks are complete and committed.
- The source checkout remains clean except for intentionally retained worktrees created by isolated implementation proof runs.
- No live provider capability claims are added by this milestone.
- If a live provider proof is performed during execution, it is opt-in, documented in `docs/superpowers/reports/`, and clearly distinguishes provider capability from workflow guidance behavior.
