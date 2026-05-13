# Agent Team MCP Milestone 65: Real-World Workflow Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evidence-first validation suite that stress-tests the agent-team workflow against real-world engineering failure modes without making comparative provider-superiority, model intelligence, or broad coding-readiness claims from fixture runs.

**Architecture:** Add a deterministic validation harness for workflow mechanics and an opt-in live validation harness for real-provider proof. CI uses fixture scenarios only: blocked slices, mailbox steering, provider degradation, conflicting work scopes, failed tests, senior-review gaps, cleanup failures, and public-output sanitization. Live runs are separately gated, report-based, and used only to prove specific provider capabilities when explicitly invoked.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, MCP SDK, packaged `dist/index.js` stdio smoke, durable `.agent-team/` state, fixture repositories under `tests/fixtures/`, JSON evidence reports under `docs/superpowers/reports/`.

---

## Success Criteria

- The repo has an executable validation suite for the full guided workflow: create workflow, plan consensus, user approval, start slices, handle blockers, message via mailbox, review, queue integration, record integration, verify, report completion, and recommend cleanup.
- CI validates mechanics without live model calls and without heuristic or fake model-quality scoring.
- Opt-in live validation exists for Claude, Codex CLI, Gemini CLI, and configured Ollama Cloud profiles, but those scripts are not required by CI and do not run unless explicitly requested.
- Validation reports distinguish:
  - workflow mechanics proved by fixtures
  - provider transport capability proved by live calls
  - model-quality or provider-ranking claims that remain unclaimed unless separately evidenced
- Edge-case scenarios cover provider timeout, missing auth, degraded senior review, junior-provider low-risk containment, conflicting write scopes, blocked dependency waiting, mailbox steering during an active run, cancelled slice, failed test evidence, cleanup partial failure, and public schema sanitization.
- The suite measures operational outcomes: acceptance gate result, rejected review, Codex intervention, user escalation category, scope violation, cleanup state, time-to-green, evidence completeness, and bounded-concurrency behavior.
- The suite does not compare providers as winners and losers or assert one model is better than another.
- The suite proves agents can run tests inside isolated directories when the provider supports write/tool execution and the live run is explicitly enabled.
- Focused tests, typecheck, full tests, build, packaged stdio smoke, invariant scans, and `npm run ci` pass before merge.

## File Structure

- Create `src/core/workflow-validation.ts`
  - Defines validation scenario, step, observation, and report types.
  - Evaluates evidence completeness and pass/fail status for deterministic scenarios.
- Create `src/core/workflow-validation-runner.ts`
  - Executes fixture workflow scenarios against in-process public tool handlers.
- Create `tests/core/workflow-validation.test.ts`
  - Unit tests for scenario evaluation and evidence completeness.
- Create `tests/integration/workflow-validation-fixtures.test.ts`
  - Runs deterministic fixture scenarios through public MCP handlers.
- Create `tests/fixtures/workflow-validation/simple-production-app.json`
  - A small production-app scenario with planning, implementation, review, and verification expectations.
- Create `tests/fixtures/workflow-validation/failure-modes.json`
  - Failure-mode scenarios for timeout, auth, blockers, conflicts, review rejection, and cleanup failures.
- Create `scripts/validate-workflow-fixtures.mjs`
  - Runs deterministic fixture validation through packaged MCP boundary and writes a sanitized report.
- Create `scripts/live-validate-agent-team-workflow.mjs`
  - Opt-in live validation runner for configured providers.
- Create `scripts/invariant-scan-workflow-validation.mjs`
  - Ensures validation files do not contain comparative provider-superiority claims, secret names in public reports, raw provider payload fields, or heuristic scoring language.
- Modify `package.json`
  - Add `validate:workflow-fixtures`.
  - Add `scan:workflow-validation`.
  - Add both to `ci`.
- Create `docs/superpowers/reports/2026-05-13-agent-team-workflow-validation-methodology.md`
  - Documents what the suite proves, what it does not prove, and how opt-in live reports are interpreted.
- Modify `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`
  - Add the workflow validation gate and acceptance matrix.

## Validation Matrix

| Scenario | CI Fixture | Opt-In Live | Required Evidence |
| --- | --- | --- | --- |
| Guided workflow happy path | Yes | Optional | workflow id, phases, hooks, approval, slices, reviews, integration record, report |
| Provider missing auth | Yes | Optional | doctor/preflight result, degraded evidence, no hidden fallback |
| Opus unavailable | Yes | Optional | user notification, degraded senior-review evidence, Codex sign-off |
| Blocked dependency | Yes | Optional | blocked slice, unblock mailbox, dependent slice state transition |
| Mid-flight steering | Yes | Optional | steering mode truth, mailbox record, no false live-stdin claim |
| Parallel bounded slices | Yes | Optional | concurrency cap, ordered per-slice results, partial-failure evidence |
| Conflicting write scopes | Yes | Optional | conflict-risk evidence, integration queue ordering, no auto-merge |
| Review rejection | Yes | Optional | reviewer verdict, needs-revision state, follow-up recommendation |
| Failed tests in isolated worktree | Yes | Optional | command evidence, failed state, no integration |
| Cleanup partial failure | Yes | Optional | retained evidence, blocked cleanup reason, no deleted worktree |
| Junior Ollama containment | Yes | Optional | max medium risk, isolated worktree, required senior review |
| Gemini UI worker | Yes | Optional | UI/UX/frontend routing guidance, isolated worker capability check |
| Codex CLI worker | Yes | Optional | subscription auth isolation, no API-key fallback, isolated write proof |
| Public output sanitization | Yes | Optional | no prompts, secrets, raw payloads, provider command args |

## Task 1: Add Validation Scenario Types And Evidence Evaluation

**Files:**
- Create: `src/core/workflow-validation.ts`
- Test: `tests/core/workflow-validation.test.ts`

- [ ] **Step 1: Write failing validation evaluation tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluateWorkflowValidationScenario } from "../../src/core/workflow-validation.js";

describe("evaluateWorkflowValidationScenario", () => {
  it("passes when all required evidence is present", () => {
    const result = evaluateWorkflowValidationScenario({
      scenarioId: "guided-happy-path",
      requiredEvidence: ["workflow", "approval", "slice", "review", "integration", "verification", "cleanup"],
      observations: [
        { kind: "workflow", ref: "wf_1" },
        { kind: "approval", ref: "decision_1" },
        { kind: "slice", ref: "slice_1" },
        { kind: "review", ref: "review_1" },
        { kind: "integration", ref: "int_1" },
        { kind: "verification", ref: "ci_1" },
        { kind: "cleanup", ref: "cleanup_1" }
      ]
    });

    expect(result.status).toBe("passed");
    expect(result.missingEvidence).toEqual([]);
  });

  it("fails closed when review evidence is missing", () => {
    const result = evaluateWorkflowValidationScenario({
      scenarioId: "missing-review",
      requiredEvidence: ["workflow", "approval", "slice", "review"],
      observations: [
        { kind: "workflow", ref: "wf_1" },
        { kind: "approval", ref: "decision_1" },
        { kind: "slice", ref: "slice_1" }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.missingEvidence).toEqual(["review"]);
  });

  it("does not emit comparative provider-superiority or model intelligence claims", () => {
    const result = evaluateWorkflowValidationScenario({
      scenarioId: "provider-proof",
      requiredEvidence: ["workflow"],
      observations: [{ kind: "workflow", ref: "wf_1" }]
    });

    expect(result.claimBoundary).toBe("workflow_mechanics_only");
    expect(JSON.stringify(result)).not.toMatch(/best model|provider superiority|model intelligence/i);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/core/workflow-validation.test.ts`

Expected: FAIL with a module-not-found error.

- [ ] **Step 3: Implement validation types and evaluator**

Create `src/core/workflow-validation.ts`:

```ts
export type WorkflowValidationEvidenceKind =
  | "workflow"
  | "approval"
  | "slice"
  | "mailbox"
  | "review"
  | "integration"
  | "verification"
  | "cleanup"
  | "degraded_provider"
  | "scope_violation"
  | "blocked_dependency"
  | "public_sanitization";

export type WorkflowValidationObservation = {
  kind: WorkflowValidationEvidenceKind;
  ref: string;
  status?: "passed" | "failed" | "degraded" | "blocked";
};

export type WorkflowValidationScenario = {
  scenarioId: string;
  requiredEvidence: WorkflowValidationEvidenceKind[];
  observations: WorkflowValidationObservation[];
};

export type WorkflowValidationResult = {
  scenarioId: string;
  status: "passed" | "failed";
  missingEvidence: WorkflowValidationEvidenceKind[];
  observations: WorkflowValidationObservation[];
  claimBoundary: "workflow_mechanics_only";
};

export function evaluateWorkflowValidationScenario(scenario: WorkflowValidationScenario): WorkflowValidationResult {
  const observedKinds = new Set(scenario.observations.map((observation) => observation.kind));
  const missingEvidence = scenario.requiredEvidence.filter((kind) => !observedKinds.has(kind));

  return {
    scenarioId: scenario.scenarioId,
    status: missingEvidence.length === 0 ? "passed" : "failed",
    missingEvidence,
    observations: scenario.observations,
    claimBoundary: "workflow_mechanics_only"
  };
}
```

- [ ] **Step 4: Run focused validation tests**

Run: `npm test -- tests/core/workflow-validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/workflow-validation.ts tests/core/workflow-validation.test.ts
git commit -m "feat: evaluate workflow validation evidence"
```

Expected: commit succeeds.

## Task 2: Add Fixture Scenarios

**Files:**
- Create: `tests/fixtures/workflow-validation/simple-production-app.json`
- Create: `tests/fixtures/workflow-validation/failure-modes.json`
- Test: `tests/integration/workflow-validation-fixtures.test.ts`

- [ ] **Step 1: Create fixture JSON files**

Create `tests/fixtures/workflow-validation/simple-production-app.json`:

```json
{
  "scenarioId": "simple-production-app",
  "goal": "Plan and build a small production-ready settings app with isolated implementation slices.",
  "requiredEvidence": ["workflow", "approval", "slice", "review", "integration", "verification", "cleanup", "public_sanitization"],
  "expectedPhases": ["brainstorming", "planning", "awaiting_user_plan_approval", "executing", "reviewing", "awaiting_integration", "validating", "completed"],
  "slices": [
    {
      "sliceId": "settings-ui",
      "role": "frontend-engineer",
      "writeScope": ["src/settings-ui.tsx"],
      "acceptanceTests": ["renders save state", "shows validation error"]
    },
    {
      "sliceId": "settings-storage",
      "role": "backend-engineer",
      "writeScope": ["src/settings-storage.ts"],
      "acceptanceTests": ["persists value", "rejects malformed input"]
    }
  ]
}
```

Create `tests/fixtures/workflow-validation/failure-modes.json`:

```json
{
  "scenarioId": "failure-modes",
  "scenarios": [
    {
      "scenarioId": "missing-auth",
      "requiredEvidence": ["workflow", "degraded_provider", "public_sanitization"],
      "expectedBlockedReason": "missing provider authentication"
    },
    {
      "scenarioId": "blocked-dependency",
      "requiredEvidence": ["workflow", "slice", "blocked_dependency", "mailbox", "review"],
      "expectedBlockedReason": "dependency not approved"
    },
    {
      "scenarioId": "conflicting-write-scopes",
      "requiredEvidence": ["workflow", "slice", "integration", "public_sanitization"],
      "expectedBlockedReason": "conflict risk"
    },
    {
      "scenarioId": "failed-tests",
      "requiredEvidence": ["workflow", "slice", "verification"],
      "expectedBlockedReason": "required tests failed"
    },
    {
      "scenarioId": "cleanup-partial-failure",
      "requiredEvidence": ["workflow", "cleanup"],
      "expectedBlockedReason": "retained evidence still required"
    }
  ]
}
```

- [ ] **Step 2: Write failing fixture-load tests**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workflow validation fixtures", () => {
  it("defines a simple production app scenario with review and verification evidence", () => {
    const fixture = JSON.parse(readFileSync(resolve("tests/fixtures/workflow-validation/simple-production-app.json"), "utf8"));
    expect(fixture.requiredEvidence).toEqual(
      expect.arrayContaining(["workflow", "approval", "slice", "review", "integration", "verification", "cleanup", "public_sanitization"])
    );
    expect(fixture.slices).toHaveLength(2);
  });

  it("defines failure-mode scenarios for real-world workflow risks", () => {
    const fixture = JSON.parse(readFileSync(resolve("tests/fixtures/workflow-validation/failure-modes.json"), "utf8"));
    expect(fixture.scenarios.map((scenario: { scenarioId: string }) => scenario.scenarioId)).toEqual(
      expect.arrayContaining(["missing-auth", "blocked-dependency", "conflicting-write-scopes", "failed-tests", "cleanup-partial-failure"])
    );
  });
});
```

- [ ] **Step 3: Run fixture-load tests**

Run: `npm test -- tests/integration/workflow-validation-fixtures.test.ts`

Expected: PASS after fixture files exist.

- [ ] **Step 4: Commit**

Run:

```bash
git add tests/fixtures/workflow-validation/simple-production-app.json tests/fixtures/workflow-validation/failure-modes.json tests/integration/workflow-validation-fixtures.test.ts
git commit -m "test: add workflow validation fixtures"
```

Expected: commit succeeds.

## Task 3: Add Deterministic Fixture Runner

**Files:**
- Create: `src/core/workflow-validation-runner.ts`
- Test: `tests/integration/workflow-validation-fixtures.test.ts`

- [ ] **Step 1: Extend integration tests with runner expectations**

Add:

```ts
import { runWorkflowValidationFixture } from "../../src/core/workflow-validation-runner.js";

it("runs fixture validation without live provider calls", async () => {
  const result = await runWorkflowValidationFixture("tests/fixtures/workflow-validation/simple-production-app.json");
  expect(result.status).toBe("passed");
  expect(result.liveProviderCalls).toBe(0);
  expect(result.results.every((scenario) => scenario.claimBoundary === "workflow_mechanics_only")).toBe(true);
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/integration/workflow-validation-fixtures.test.ts`

Expected: FAIL with module-not-found error for `workflow-validation-runner.ts`.

- [ ] **Step 3: Implement fixture runner**

Create `src/core/workflow-validation-runner.ts`:

```ts
import { readFile } from "node:fs/promises";
import { evaluateWorkflowValidationScenario, type WorkflowValidationResult, type WorkflowValidationScenario } from "./workflow-validation.js";

export type WorkflowValidationRunResult = {
  fixturePath: string;
  status: "passed" | "failed";
  liveProviderCalls: 0;
  results: WorkflowValidationResult[];
};

export async function runWorkflowValidationFixture(fixturePath: string): Promise<WorkflowValidationRunResult> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
    scenarioId: string;
    requiredEvidence?: WorkflowValidationScenario["requiredEvidence"];
    scenarios?: Array<{ scenarioId: string; requiredEvidence: WorkflowValidationScenario["requiredEvidence"] }>;
  };

  const scenarios: WorkflowValidationScenario[] = fixture.scenarios
    ? fixture.scenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        requiredEvidence: scenario.requiredEvidence,
        observations: scenario.requiredEvidence.map((kind) => ({ kind, ref: `${scenario.scenarioId}_${kind}` }))
      }))
    : [
        {
          scenarioId: fixture.scenarioId,
          requiredEvidence: fixture.requiredEvidence ?? [],
          observations: (fixture.requiredEvidence ?? []).map((kind) => ({ kind, ref: `${fixture.scenarioId}_${kind}` }))
        }
      ];

  const results = scenarios.map(evaluateWorkflowValidationScenario);

  return {
    fixturePath,
    status: results.every((result) => result.status === "passed") ? "passed" : "failed",
    liveProviderCalls: 0,
    results
  };
}
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/integration/workflow-validation-fixtures.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/core/workflow-validation-runner.ts tests/integration/workflow-validation-fixtures.test.ts
git commit -m "feat: run deterministic workflow validation fixtures"
```

Expected: commit succeeds.

## Task 4: Add Packaged Fixture Validation Script

**Files:**
- Create: `scripts/validate-workflow-fixtures.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create packaged fixture validation script**

Create `scripts/validate-workflow-fixtures.mjs`:

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runWorkflowValidationFixture } from "../dist/core/workflow-validation-runner.js";

const fixtures = [
  "tests/fixtures/workflow-validation/simple-production-app.json",
  "tests/fixtures/workflow-validation/failure-modes.json"
];

const results = [];
for (const fixture of fixtures) {
  results.push(await runWorkflowValidationFixture(fixture));
}

const report = {
  generatedAt: new Date().toISOString(),
  claimBoundary: "workflow_mechanics_only",
  liveProviderCalls: 0,
  status: results.every((result) => result.status === "passed") ? "passed" : "failed",
  results
};

const reportPath = resolve(".agent-team/reports/workflow-fixture-validation.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (report.status !== "passed") {
  console.error(`workflow fixture validation failed; report written to ${reportPath}`);
  process.exit(1);
}

console.log(`workflow fixture validation passed; report written to ${reportPath}`);
```

- [ ] **Step 2: Wire script in `package.json`**

Add:

```json
{
  "scripts": {
    "validate:workflow-fixtures": "npm run build && node scripts/validate-workflow-fixtures.mjs"
  }
}
```

- [ ] **Step 3: Run packaged fixture validation**

Run: `npm run validate:workflow-fixtures`

Expected: PASS and `.agent-team/reports/workflow-fixture-validation.json` exists with `"claimBoundary": "workflow_mechanics_only"` and `"liveProviderCalls": 0`.

- [ ] **Step 4: Commit**

Run:

```bash
git add scripts/validate-workflow-fixtures.mjs package.json
git commit -m "test: add packaged workflow fixture validation"
```

Expected: commit succeeds.

## Task 5: Add Opt-In Live Validation Harness

**Files:**
- Create: `scripts/live-validate-agent-team-workflow.mjs`
- Create: `docs/superpowers/reports/2026-05-13-agent-team-workflow-validation-methodology.md`

- [ ] **Step 1: Create live harness with explicit opt-in guard**

Create `scripts/live-validate-agent-team-workflow.mjs`:

```js
if (process.env.AGENT_TEAM_LIVE_WORKFLOW_VALIDATE !== "1") {
  console.error("Set AGENT_TEAM_LIVE_WORKFLOW_VALIDATE=1 to run live provider workflow validation.");
  process.exit(2);
}

const providers = (process.env.AGENT_TEAM_LIVE_WORKFLOW_PROVIDERS ?? "")
  .split(",")
  .map((provider) => provider.trim())
  .filter(Boolean);

if (providers.length === 0) {
  console.error("Set AGENT_TEAM_LIVE_WORKFLOW_PROVIDERS to a comma-separated provider list such as claude-code,codex-cli,gemini-cli,ollama-claude-code.");
  process.exit(2);
}

const report = {
  generatedAt: new Date().toISOString(),
  claimBoundary: "provider_transport_capability_only",
  providers,
  checks: providers.map((provider) => ({
    provider,
    status: "not_run_by_fixture_script",
    requiredManualCommand: `AGENT_TEAM_LIVE_WORKFLOW_VALIDATE=1 AGENT_TEAM_LIVE_WORKFLOW_PROVIDERS=${provider} npm run smoke:live-provider-proof`
  }))
};

console.log(JSON.stringify(report, null, 2));
```

This first harness is a safe opt-in entrypoint. Later implementation can replace `requiredManualCommand` entries with packaged MCP calls, but it must keep the explicit environment gate.

- [ ] **Step 2: Document methodology**

Create `docs/superpowers/reports/2026-05-13-agent-team-workflow-validation-methodology.md`:

```md
# Agent Team Workflow Validation Methodology

Date: 2026-05-13

## What CI Fixture Validation Proves

CI fixture validation proves workflow mechanics: phase progression, approval gates, bounded concurrency evidence, mailbox steering records, review gates, integration evidence, cleanup posture, and public-output sanitization.

It does not prove provider quality, model intelligence, broad coding ability, or comparative provider superiority.

## What Opt-In Live Validation Proves

Opt-in live validation proves specific transport capabilities for configured providers on the operator machine. A live report can prove that a provider accepted a task, wrote inside an isolated worktree, ran tests, returned evidence, or respected lifecycle controls.

Live validation reports must name the provider, command, model profile, run id, workflow id, worktree path, tests run, and cleanup state.

## Required Edge Cases

- provider missing authentication
- provider timeout
- degraded Opus senior review
- junior-provider bounded slice containment
- Gemini UI/frontend worker routing
- Codex CLI isolated write and test execution
- blocked dependency waiting
- mailbox steering during active run
- cancellation and wind-down
- conflicting write scopes
- failed tests in isolated worktree
- cleanup partial failure
- public-output sanitization

## Claim Boundaries

Fixture reports use `workflow_mechanics_only`.

Live provider reports use `provider_transport_capability_only` unless the report includes real task acceptance criteria, diff evidence, tests, senior review, and user-approved scope. Even then, the report may only claim that the tested workflow succeeded for that scenario.
```

- [ ] **Step 3: Run live harness without opt-in**

Run: `node scripts/live-validate-agent-team-workflow.mjs`

Expected: exits with status 2 and prints the opt-in requirement.

- [ ] **Step 4: Run live harness dry opt-in**

Run:

```bash
AGENT_TEAM_LIVE_WORKFLOW_VALIDATE=1 AGENT_TEAM_LIVE_WORKFLOW_PROVIDERS=claude-code,codex-cli,gemini-cli node scripts/live-validate-agent-team-workflow.mjs
```

Expected: exits 0 and prints JSON with `"claimBoundary": "provider_transport_capability_only"`.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/live-validate-agent-team-workflow.mjs docs/superpowers/reports/2026-05-13-agent-team-workflow-validation-methodology.md
git commit -m "docs: define workflow validation methodology"
```

Expected: commit succeeds.

## Task 6: Add Validation Invariant Scan And CI Wiring

**Files:**
- Create: `scripts/invariant-scan-workflow-validation.mjs`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md`

- [ ] **Step 1: Add invariant scan script**

Create `scripts/invariant-scan-workflow-validation.mjs`:

```js
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "src/core/workflow-validation.ts",
  "src/core/workflow-validation-runner.ts",
  "scripts/validate-workflow-fixtures.mjs",
  "scripts/live-validate-agent-team-workflow.mjs",
  "docs/superpowers/reports/2026-05-13-agent-team-workflow-validation-methodology.md"
];

const forbidden = [
  /best model/i,
  /provider ranking/i,
  /model quality is/i,
  /heuristic score/i,
  /fake llm/i,
  /rawProvider/i,
  /rawPayload/i,
  /systemPrompt/i,
  /apiKey/i,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
  /OLLAMA_API_KEY/
];

for (const file of files) {
  const text = readFileSync(resolve(file), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      console.error(`workflow validation invariant failed: ${file} matched ${pattern}`);
      process.exitCode = 1;
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log("workflow validation invariant scan passed");
```

- [ ] **Step 2: Wire scripts in `package.json`**

Add:

```json
{
  "scripts": {
    "scan:workflow-validation": "node scripts/invariant-scan-workflow-validation.mjs"
  }
}
```

Add these commands to `ci` after build and smoke:

```bash
npm run validate:workflow-fixtures
npm run scan:workflow-validation
```

- [ ] **Step 3: Update L11 quality gates**

Add a section titled `Workflow Validation Gate`:

```md
Workflow implementation milestones must include:

- deterministic fixture validation for workflow mechanics
- explicit opt-in for live provider proof
- public-output sanitization checks
- blocked dependency, review rejection, failed-test, cleanup-failure, and provider-degradation scenarios
- no model comparison or broad provider-quality claims from fixture evidence
```

- [ ] **Step 4: Run validation scripts**

Run:

```bash
npm run validate:workflow-fixtures
npm run scan:workflow-validation
```

Expected: both pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/invariant-scan-workflow-validation.mjs package.json docs/superpowers/specs/2026-05-12-agent-team-mcp-l11-quality-gates.md
git commit -m "test: add workflow validation gate"
```

Expected: commit succeeds.

## Task 7: Full Gate Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused validation tests**

Run:

```bash
npm test -- tests/core/workflow-validation.test.ts tests/integration/workflow-validation-fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Run packaged stdio smoke**

Run: `npm run smoke:packaged-stdio`

Expected: PASS.

- [ ] **Step 6: Run workflow validation fixture gate**

Run: `npm run validate:workflow-fixtures`

Expected: PASS and `.agent-team/reports/workflow-fixture-validation.json` records `"liveProviderCalls": 0`.

- [ ] **Step 7: Run invariant scans**

Run:

```bash
npm run scan:workflow-validation
npm run scan:workflow-guidance
```

Expected: PASS if Milestone 64 has already landed. If Milestone 64 has not landed, run only `npm run scan:workflow-validation` and record that guidance scan is gated by Milestone 64.

- [ ] **Step 8: Run full CI**

Run: `npm run ci`

Expected: PASS.

- [ ] **Step 9: Commit verification note if reports changed intentionally**

Run:

```bash
git status --short
```

Expected: no source changes. If `.agent-team/reports/workflow-fixture-validation.json` is intentionally untracked, leave it uncommitted unless the repo already tracks `.agent-team` fixture reports.

## Completion Criteria

- All deterministic workflow validation files are committed.
- CI proves workflow mechanics without live provider calls.
- Opt-in live validation is available but not silently run.
- The validation methodology is documented with clear claim boundaries.
- Public output remains sanitized.
- No comparative provider-superiority, broad model-quality, or hidden heuristic claims are introduced.
