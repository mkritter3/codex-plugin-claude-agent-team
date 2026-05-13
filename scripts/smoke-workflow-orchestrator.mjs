#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");

const REQUIRED_TOOLS = [
  "agent_team_doctor",
  "agent_team_create_workflow",
  "agent_team_get_workflow",
  "agent_team_plan_consensus",
  "agent_team_unblock_slice",
  "agent_team_review_slice",
  "agent_team_integration_queue",
  "agent_team_record_integration",
  "agent_team_workflow_report",
  "agent_team_list_workflows"
];

const WORKFLOW_STATE_CATEGORIES = [
  "complete",
  "ready-to-integrate",
  "missing-evidence",
  "blocked",
  "incomplete"
];

const forbiddenReportPatterns = [
  /internal\s+prompt/i,
  new RegExp(["raw", "provider", "payload"].join("\\s+"), "i"),
  new RegExp(["provider", "session", "id"].join("\\s+"), "i"),
  /secret/i,
  /command\s+args/i,
  /quality\s+score/i
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Workflow orchestrator smoke failed: ${message}`);
  }
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(
      `Missing ${runtimePath}. Run npm run build before npm run smoke:workflow-orchestrator.`
    );
  }
}

async function createFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "agent-team-workflow-smoke-"));
  execFileSync("git", ["init", "--quiet"], { cwd: fixtureRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "agent-team-smoke@example.invalid"], {
    cwd: fixtureRoot,
    stdio: "ignore"
  });
  execFileSync("git", ["config", "user.name", "Agent Team Smoke"], {
    cwd: fixtureRoot,
    stdio: "ignore"
  });
  await writeFile(
    join(fixtureRoot, "README.md"),
    "# Agent Team Workflow Smoke\n\nDisposable fixture for packaged workflow validation.\n",
    "utf8"
  );
  await mkdir(join(fixtureRoot, "src"), { recursive: true });
  await writeFile(join(fixtureRoot, "src", "workflow.txt"), "initial\n", "utf8");
  execFileSync("git", ["add", "README.md", "src/workflow.txt"], {
    cwd: fixtureRoot,
    stdio: "ignore"
  });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture baseline"], {
    cwd: fixtureRoot,
    stdio: "ignore"
  });
  return fixtureRoot;
}

async function callTool(client, name, toolArgs) {
  const result = await client.callTool({
    name,
    arguments: toolArgs
  });
  if (result.isError) {
    throw new Error(`${name} returned an MCP error: ${JSON.stringify(result)}`);
  }
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text === "string") {
    return JSON.parse(text);
  }
  throw new Error(`${name} did not return structured or JSON text content.`);
}

function assertNoReportLeak(report) {
  const serialized = JSON.stringify(report);
  for (const pattern of forbiddenReportPatterns) {
    assert(!pattern.test(serialized), `sanitizedReport matched forbidden pattern ${pattern}`);
  }
}

function workflowSlice(workflow, sliceId) {
  const slice = workflow?.slices?.find((candidate) => candidate.sliceId === sliceId);
  assert(slice !== undefined, `workflow slice ${sliceId} was not found in ${JSON.stringify(workflow)}`);
  return slice;
}

async function seedFixtureWorkflowState(fixtureRoot, workflowId, updateSlice) {
  const path = join(fixtureRoot, ".agent-team", "workflows", `${workflowId}.json`);
  const record = JSON.parse(await readFile(path, "utf8"));
  const seeded = {
    ...record,
    updatedAt: new Date().toISOString(),
    slices: record.slices.map((slice) => updateSlice(slice))
  };
  await writeFile(path, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");
}

function assertCompletionStatus(report, expected) {
  assert(
    report?.completionStatus === expected,
    `expected completionStatus ${expected}, received ${report?.completionStatus}`
  );
}

function reviewInput(sliceId, worktreePath, evidencePath) {
  return {
    sliceId,
    implementationEvidence: {
      summary: `Fixture implementation evidence for ${sliceId}.`,
      changedFiles: [`src/${sliceId}.ts`],
      testsRun: [`npm test -- ${sliceId}`],
      evidencePaths: [evidencePath],
      worktreePath
    },
    codexDecision: {
      status: "approve",
      category: "technical",
      summary: `Codex approves ${sliceId} for fixture integration.`
    },
    verdicts: [
      {
        reviewerRole: "code-reviewer",
        status: "approve",
        summary: `${sliceId} is bounded and ready for integration.`
      },
      {
        reviewerRole: "test-hardening-engineer",
        status: "approve",
        summary: `${sliceId} has passing final gate evidence requirements.`
      }
    ],
    seniorReviewerEvidence: {
      status: "unavailable",
      provider: "claude-code-cli:opus",
      summary: "Opus senior review unavailable; Codex records degraded required-when-available evidence."
    }
  };
}

async function runBlockedProbe(client, fixtureRoot) {
  const created = await callTool(client, "agent_team_create_workflow", {
    cwd: fixtureRoot,
    workflowId: "workflow_blocked_probe",
    name: "Workflow blocked probe",
    goal: {
      title: "Exercise blocked slice handling",
      successCriteria: ["blocked slice can receive dependency evidence"],
      constraints: ["public MCP tools only"],
      nonGoals: ["live provider calls"]
    },
    slices: [
      {
        sliceId: "slice_dependency",
        title: "Dependency evidence",
        ownerRole: "test-designer",
        state: "planned",
        writeScope: ["tests"],
        acceptanceTests: ["fixture dependency evidence"],
        expectedEvidence: ["dependency summary"],
        riskLevel: "low",
        integrationOrderHint: 1
      },
      {
        sliceId: "slice_blocked",
        title: "Blocked implementation",
        ownerRole: "slice-implementer",
        state: "blocked",
        dependencies: ["slice_dependency"],
        blockedMode: "deferred-start",
        blockedBy: ["slice_dependency"],
        writeScope: ["src/blocked"],
        acceptanceTests: ["fixture unblock evidence"],
        expectedEvidence: ["mailbox unblock evidence"],
        riskLevel: "medium",
        integrationOrderHint: 2
      }
    ]
  });
  assert(created.workflow !== undefined, `blocked probe creation did not return workflow: ${JSON.stringify(created)}`);
  assert(workflowSlice(created.workflow, "slice_blocked").state === "blocked", "blocked probe did not start blocked");

  await callTool(client, "agent_team_plan_consensus", {
    cwd: fixtureRoot,
    workflowId: "workflow_blocked_probe",
    codexDecision: {
      status: "approve",
      category: "technical",
      summary: "Codex approves the blocked probe plan."
    },
    verdicts: [
      {
        reviewerRole: "planner",
        status: "approve",
        summary: "The blocked slice can wait for dependency evidence."
      }
    ],
    seniorReviewerEvidence: {
      status: "unavailable",
      provider: "claude-code-cli:opus",
      summary: "Opus unavailable for fixture probe; degraded evidence recorded."
    }
  });

  await seedFixtureWorkflowState(fixtureRoot, "workflow_blocked_probe", (slice) =>
    slice.sliceId === "slice_dependency" ? { ...slice, state: "approved" } : slice
  );

  const unblocked = await callTool(client, "agent_team_unblock_slice", {
    cwd: fixtureRoot,
    workflowId: "workflow_blocked_probe",
    sliceId: "slice_blocked",
    dependencyEvidence: [
      {
        dependencySliceId: "slice_dependency",
        summary: "Dependency evidence is ready for the blocked slice.",
        changedFiles: ["tests/dependency.fixture.ts"],
        evidencePaths: [join(fixtureRoot, ".agent-team", "evidence", "dependency.json")]
      }
    ]
  });
  assert(unblocked.status === "ready", "blocked probe did not become ready");
  assert(unblocked.workflow !== undefined, `blocked probe did not return workflow: ${JSON.stringify(unblocked)}`);
  return {
    workflowId: "workflow_blocked_probe",
    initialState: "blocked",
    finalState: workflowSlice(unblocked.workflow, "slice_blocked").state
  };
}

async function runIntegrationWorkflow(client, fixtureRoot) {
  const worktreeRoot = join(fixtureRoot, ".agent-team", "retained-worktrees");
  const evidenceRoot = join(fixtureRoot, ".agent-team", "evidence");
  await mkdir(worktreeRoot, { recursive: true });
  await mkdir(evidenceRoot, { recursive: true });

  const created = await callTool(client, "agent_team_create_workflow", {
    cwd: fixtureRoot,
    workflowId: "workflow_packaged_smoke",
    name: "Packaged workflow orchestrator smoke",
    goal: {
      title: "Validate fixture-safe workflow orchestrator",
      successCriteria: [
        "planning consensus is recorded",
        "approved slices are integrated only after final gate evidence"
      ],
      constraints: [
        "Codex owns manual integration",
        "public MCP tools only",
        "no live provider calls"
      ],
      nonGoals: ["automatic merge", "provider comparison"]
    },
    rationale: "Codex records the fixture workflow goal and bounded smoke path.",
    slices: [
      {
        sliceId: "slice_tests",
        title: "Fixture test hardening",
        ownerRole: "test-hardening-engineer",
        state: "ready",
        writeScope: ["tests/fixture"],
        acceptanceTests: ["npm test -- tests/fixture"],
        expectedEvidence: ["focused tests"],
        riskLevel: "medium",
        requiredReviewers: ["code-reviewer", "test-hardening-engineer"],
        integrationOrderHint: 1
      },
      {
        sliceId: "slice_runtime",
        title: "Fixture runtime follow-up",
        ownerRole: "slice-implementer",
        state: "ready",
        dependencies: ["slice_tests"],
        writeScope: ["src/fixture"],
        acceptanceTests: ["npm test -- tests/fixture"],
        expectedEvidence: ["focused tests", "retained worktree evidence"],
        riskLevel: "high",
        requiredReviewers: ["code-reviewer", "test-hardening-engineer"],
        integrationOrderHint: 2
      }
    ]
  });
  assert(created.workflow?.workflowId === "workflow_packaged_smoke", "workflow was not created");

  const readBack = await callTool(client, "agent_team_get_workflow", {
    cwd: fixtureRoot,
    workflowId: "workflow_packaged_smoke"
  });
  assert(readBack.workflow?.planningStatus === "draft", "workflow readback was not draft");

  const planned = await callTool(client, "agent_team_plan_consensus", {
    cwd: fixtureRoot,
    workflowId: "workflow_packaged_smoke",
    codexDecision: {
      status: "approve",
      category: "technical",
      summary: "Codex approves the fixture workflow plan."
    },
    verdicts: [
      {
        reviewerRole: "architect",
        status: "approve",
        summary: "The fixture workflow preserves the public MCP boundary."
      },
      {
        reviewerRole: "devops-release-engineer",
        status: "approve",
        summary: "The packaged smoke belongs in CI because it is provider-free."
      }
    ],
    seniorReviewerEvidence: {
      status: "unavailable",
      provider: "claude-code-cli:opus",
      summary: "Opus senior review unavailable in fixture smoke; degraded required-when-available evidence recorded."
    }
  });
  assert(planned.workflow?.planningStatus === "approved", "planning consensus was not approved");

  await seedFixtureWorkflowState(fixtureRoot, "workflow_packaged_smoke", (slice) => ({
    ...slice,
    state: "awaiting-review"
  }));

  const preReviewReport = await callTool(client, "agent_team_workflow_report", {
    cwd: fixtureRoot,
    workflowId: "workflow_packaged_smoke"
  });
  assertCompletionStatus(preReviewReport, "incomplete");

  for (const sliceId of ["slice_tests", "slice_runtime"]) {
    const reviewed = await callTool(client, "agent_team_review_slice", {
      cwd: fixtureRoot,
      workflowId: "workflow_packaged_smoke",
      ...reviewInput(
        sliceId,
        join(worktreeRoot, sliceId),
        join(evidenceRoot, `${sliceId}-review.json`)
      )
    });
    assert(workflowSlice(reviewed.workflow, sliceId).state === "approved", `${sliceId} was not approved`);
  }

  const queue = await callTool(client, "agent_team_integration_queue", {
    cwd: fixtureRoot,
    workflowId: "workflow_packaged_smoke"
  });
  assert(queue.queue?.length === 2, "integration queue did not include both approved slices");

  const queuedReport = await callTool(client, "agent_team_workflow_report", {
    cwd: fixtureRoot,
    workflowId: "workflow_packaged_smoke"
  });
  assertCompletionStatus(queuedReport, "incomplete");
  assert(
    queuedReport.rows?.some((row) => row.category === "ready-to-integrate"),
    "queued report did not include ready-to-integrate rows"
  );

  for (const sliceId of ["slice_tests", "slice_runtime"]) {
    await callTool(client, "agent_team_record_integration", {
      cwd: fixtureRoot,
      workflowId: "workflow_packaged_smoke",
      sliceId,
      integrationMethod: "manual-patch",
      summary: `Codex-owned fixture integration recorded for ${sliceId}.`,
      changedFiles: [`src/${sliceId}.ts`],
      verification: [
        {
          command: `npm test -- ${sliceId}`,
          status: "passed",
          summary: `${sliceId} fixture final gate passed.`,
          evidencePath: join(evidenceRoot, `${sliceId}-final-gate.log`)
        }
      ],
      evidencePaths: [join(evidenceRoot, `${sliceId}-integration.json`)],
      retainedWorktreePath: join(worktreeRoot, sliceId),
      cleanupRecommendation: "eligible-after-evidence-saved"
    });
  }

  const finalReport = await callTool(client, "agent_team_workflow_report", {
    cwd: fixtureRoot,
    workflowId: "workflow_packaged_smoke",
    includeWorkflow: true
  });
  assertCompletionStatus(finalReport, "complete");
  assert(finalReport.counts?.cleanupReady === 2, "final report did not mark both slices cleanup-ready");

  const listed = await callTool(client, "agent_team_list_workflows", {
    cwd: fixtureRoot
  });
  assert(
    listed.workflows?.some((workflow) => workflow.workflowId === "workflow_packaged_smoke"),
    "workflow list did not include packaged smoke workflow"
  );

  return {
    workflowId: finalReport.workflowId,
    completionStatus: finalReport.completionStatus,
    counts: finalReport.counts,
    rowCategories: [...new Set(finalReport.rows.map((row) => row.category))],
    evidencePaths: finalReport.rows.flatMap((row) => row.evidencePaths ?? [])
  };
}

async function main() {
  await assertRuntimeExists();
  let fixtureRoot;
  let fixtureCleaned = false;
  let sanitizedReport;
  const stderrChunks = [];
  const transport = new StdioClientTransport({
    command: "node",
    args: [runtimePath],
    cwd: repoRoot,
    stderr: "pipe"
  });
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString("utf8"));
  });
  const client = new Client({
    name: "agent-team-workflow-orchestrator-smoke",
    version: "0.1.0"
  });

  try {
    fixtureRoot = await createFixture();
    await client.connect(transport);

    const doctor = await callTool(client, "agent_team_doctor", { cwd: fixtureRoot });
    assert(Array.isArray(doctor.checks), "doctor did not return ordered check evidence");
    assert(
      doctor.checks.some((check) => check.id === "state-writable" && check.status === "pass"),
      "doctor did not prove fixture state is writable"
    );

    const blockedProbe = await runBlockedProbe(client, fixtureRoot);
    const workflow = await runIntegrationWorkflow(client, fixtureRoot);

    sanitizedReport = {
      status: "passed",
      fixture: "temporary",
      toolFlow: REQUIRED_TOOLS,
      observedCategories: WORKFLOW_STATE_CATEGORIES,
      blockedProbe,
      workflow,
      liveProviderUse: false,
      providerCapabilityClaim: false,
      fixtureCleaned
    };
    assertNoReportLeak(sanitizedReport);
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr.length === 0 ? message : `${message}\nServer stderr:\n${stderr}`);
  } finally {
    await client.close();
    if (fixtureRoot !== undefined) {
      await rm(fixtureRoot, { force: true, recursive: true });
      fixtureCleaned = true;
    }
  }

  if (sanitizedReport !== undefined) {
    const finalReport = {
      ...sanitizedReport,
      fixtureCleaned
    };
    assertNoReportLeak(finalReport);
    console.log(JSON.stringify(finalReport, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
