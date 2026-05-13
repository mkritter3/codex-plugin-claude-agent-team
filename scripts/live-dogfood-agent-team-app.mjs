#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  buildToolRequestOptions,
  isTerminalRunStatus,
  runStatus
} from "./live-smoke-claude-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");
const WORKFLOW_ID = "workflow_live_dogfood_app";
const CLAIM_BOUNDARY = "dogfood_app_workflow_only";

const TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_create_workflow",
  "agent_team_plan_consensus",
  "agent_team_workflow_next",
  "agent_team_record_user_decision",
  "agent_team_start_slices",
  "agent_team_status_many",
  "agent_team_review_slice",
  "agent_team_integration_queue",
  "agent_team_record_integration",
  "agent_team_workflow_report",
  "agent_team_dashboard",
  "agent_team_summary",
  "agent_team_cleanup"
];

const BASE_PROVIDER_SELECTORS = [
  "claude-code-cli:opus",
  "gemini-cli",
  "codex-cli",
  "ollama-claude-code:kimi-k2.6"
];

const KNOWN_LIMITATIONS = [
  "This dogfood run proves the workflow/control-plane can coordinate real provider-backed app slices in a disposable fixture; it does not compare providers or evaluate model quality.",
  "Codex-owned integration copies only whitelisted files from retained worktrees, then records final verification evidence.",
  "Ollama junior documentation work is included only when Ollama Cloud credentials are configured.",
  "Live provider use is operator-triggered and is not part of CI."
];

const SLICE_PROVIDER_PLAN = [
  {
    sliceId: "slice_ui",
    ownerRole: "frontend-engineer",
    providerSelector: "gemini-cli",
    files: ["index.html", "styles.css"]
  },
  {
    sliceId: "slice_logic_tests",
    ownerRole: "slice-implementer",
    providerSelector: "codex-cli",
    files: ["src/app.js", "tests/app.test.js"]
  },
  {
    sliceId: "slice_junior_docs",
    ownerRole: "slice-implementer",
    providerSelector: "ollama-claude-code:kimi-k2.6",
    files: ["README.md"],
    optionalEnv: "OLLAMA_API_KEY"
  }
];

function args() {
  return process.argv.slice(2);
}

function hasFlag(name) {
  return args().includes(name);
}

function readValue(name, fallback) {
  const index = args().indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = args()[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

function readPositiveNumber(name, fallback) {
  const raw = readValue(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function dryRunReport() {
  return {
    status: "dry_run",
    liveProviderUse: false,
    claimBoundary: CLAIM_BOUNDARY,
    providerSelectors: BASE_PROVIDER_SELECTORS,
    toolFlow: TOOL_FLOW,
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement:
      "disposable fixture enables policy.liveSmokeEnabled, isolated write mode, audit, and exact provider selectors",
    plannedSlices: SLICE_PROVIDER_PLAN.map(({ sliceId, ownerRole, providerSelector }) => ({
      sliceId,
      ownerRole,
      providerSelector
    })),
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(`Missing ${runtimePath}. Run npm run build before live dogfood.`);
  }
}

async function callTool(client, name, toolArgs, timeoutMs) {
  const options = timeoutMs === undefined ? undefined : buildToolRequestOptions(timeoutMs);
  const result = await client.callTool({ name, arguments: toolArgs }, undefined, options);
  if (result.isError === true) {
    const message = Array.isArray(result.content)
      ? result.content
          .map((item) => (typeof item?.text === "string" ? item.text : ""))
          .filter(Boolean)
          .join(" ")
      : "";
    throw new Error(message || `${name} returned an MCP tool error.`);
  }
  return result.structuredContent ?? {};
}

function providerEnvironment() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-team-live-dogfood-app-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "agent-team@example.invalid"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.name", "Agent Team Live Dogfood"], {
    cwd: root
  });
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          test: "node --test tests/app.test.js"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(root, "index.html"),
    [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="utf-8">',
      '    <meta name="viewport" content="width=device-width, initial-scale=1">',
      "    <title>Agent Team Dogfood App</title>",
      '    <link rel="stylesheet" href="./styles.css">',
      "  </head>",
      "  <body>",
      '    <main class="app-shell">',
      "      <h1>Agent Team Dogfood App</h1>",
      '      <p id="status">Awaiting live slices</p>',
      "    </main>",
      "  </body>",
      "</html>",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "styles.css"), ".app-shell { font-family: system-ui; }\n", "utf8");
  await writeFile(
    join(root, "src", "app.js"),
    [
      "export function summarizeTasks(tasks) {",
      "  return { total: tasks.length, completed: 0, open: tasks.length };",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "tests", "app.test.js"),
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "import { summarizeTasks } from '../src/app.js';",
      "",
      "test('summarizeTasks returns basic counts', () => {",
      "  assert.deepEqual(summarizeTasks([{ done: false }]), { total: 1, completed: 0, open: 1 });",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "README.md"),
    "# Agent Team Dogfood App\n\nDisposable live provider dogfood fixture.\n",
    "utf8"
  );
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
  const gitRoot = (
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: root })
  ).stdout.trim();
  const allowedWorktreeRoot = join(dirname(gitRoot), ".agent-team-worktrees", basename(gitRoot));
  await writeFixtureConfig(root, allowedWorktreeRoot);
  return { root, allowedWorktreeRoot };
}

async function writeFixtureConfig(root, allowedWorktreeRoot) {
  const includeOllama = process.env.OLLAMA_API_KEY !== undefined;
  await mkdir(join(root, ".agent-team"), { recursive: true });
  await writeFile(
    join(root, ".agent-team", "config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        providers: {
          claudeCodeCli: {
            enabled: true,
            executable: "claude",
            profiles: [
              {
                id: "opus",
                model: "opus",
                displayName: "Claude Opus Senior Review",
                capabilities: {
                  structuredOutput: true,
                  longContext: true,
                  reasoning: true
                }
              }
            ]
          },
          geminiCli: {
            enabled: true,
            executable: "gemini",
            model: readValue("--gemini-model", "gemini-3-flash-preview"),
            displayName: "Gemini UI Worker",
            writeValidated: true,
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: true,
              tools: true,
              sessionResume: true,
              cancellation: true,
              edits: true,
              workspaceIsolation: true
            }
          },
          codexCli: {
            enabled: true,
            executable: "codex",
            model: readValue("--codex-model", "gpt-5.5"),
            displayName: "Codex CLI Worker",
            writeValidated: true,
            capabilities: {
              structuredOutput: true,
              longContext: true,
              reasoning: true,
              tools: true,
              sessionResume: true,
              cancellation: true,
              edits: true,
              workspaceIsolation: true
            }
          },
          ...(includeOllama
            ? {
                ollamaClaudeCode: {
                  enabled: true,
                  executable: "claude",
                  baseUrl: "https://ollama.com/anthropic",
                  apiKeyEnv: "OLLAMA_API_KEY",
                  profiles: [
                    {
                      id: "kimi-k2.6",
                      baseUrl: "https://ollama.com/anthropic",
                      model: "kimi-k2.6",
                      displayName: "Kimi K2.6 Junior Worker",
                      writeValidated: true,
                      capabilities: {
                        structuredOutput: true,
                        longContext: true,
                        reasoning: true,
                        tools: true,
                        sessionResume: true,
                        cancellation: true,
                        edits: true,
                        workspaceIsolation: true
                      }
                    }
                  ]
                }
              }
            : {})
        },
        routing: {
          rolePins: {
            planner: "claude-code-cli:opus",
            "code-reviewer": "claude-code-cli:opus",
            "frontend-engineer": "gemini-cli",
            "slice-implementer": "codex-cli"
          },
          providerOrder: ["claude-code-cli:opus", "gemini-cli", "codex-cli"]
        },
        policy: {
          allowedRoles: [
            "planner",
            "architect",
            "code-reviewer",
            "frontend-engineer",
            "slice-implementer",
            "test-hardening-engineer",
            "docs-dx-writer"
          ],
          allowedProviderSelectors: BASE_PROVIDER_SELECTORS.filter(
            (provider) => provider !== "ollama-claude-code:kimi-k2.6" || includeOllama
          ),
          allowWriteMode: true,
          allowedWorktreeRoots: [allowedWorktreeRoot],
          liveSmokeEnabled: true,
          auditEnabled: true
        }
      },
      null,
      2
    ),
    "utf8"
  );
}

function workflowSlices() {
  const includeOllama = process.env.OLLAMA_API_KEY !== undefined;
  const slices = [
    {
      sliceId: "slice_ui",
      title:
        "Improve index.html and styles.css for a polished static dashboard. Preserve the heading Agent Team Dogfood App and add a visible Build Status section.",
      ownerRole: "frontend-engineer",
      state: "ready",
      writeScope: ["index.html", "styles.css"],
      readScope: ["src/app.js", "tests/app.test.js"],
      acceptanceTests: [
        "npm test must pass after Codex integration",
        "index.html must contain Agent Team Dogfood App and Build Status",
        "styles.css must contain .app-shell"
      ],
      expectedEvidence: ["changed files index.html and styles.css", "summary of UI decisions"],
      riskLevel: "medium",
      requiredReviewers: ["code-reviewer", "test-hardening-engineer"],
      integrationOrderHint: 1
    },
    {
      sliceId: "slice_logic_tests",
      title:
        "Implement summarizeTasks in src/app.js and harden tests/app.test.js with node:test coverage for completed and open counts.",
      ownerRole: "slice-implementer",
      state: "ready",
      writeScope: ["src/app.js", "tests/app.test.js"],
      readScope: ["package.json"],
      acceptanceTests: [
        "npm test must pass in the execution worktree",
        "src/app.js must export summarizeTasks",
        "tests/app.test.js must cover completed and open task counts"
      ],
      expectedEvidence: ["changed files src/app.js and tests/app.test.js", "npm test result"],
      riskLevel: "medium",
      requiredReviewers: ["code-reviewer", "test-hardening-engineer"],
      integrationOrderHint: 2
    }
  ];
  if (includeOllama) {
    slices.push({
      sliceId: "slice_junior_docs",
      title:
        "Update README.md with a short operator note that this is a disposable dogfood app fixture; do not edit other files.",
      ownerRole: "slice-implementer",
      state: "ready",
      writeScope: ["README.md"],
      readScope: ["index.html", "src/app.js"],
      acceptanceTests: ["README.md must retain Agent Team Dogfood App"],
      expectedEvidence: ["changed file README.md", "brief operator note"],
      riskLevel: "low",
      requiredReviewers: ["code-reviewer"],
      integrationOrderHint: 3
    });
  }
  return slices;
}

function policyLiveSmokeEnabled(doctorReport) {
  const checks = Array.isArray(doctorReport.checks) ? doctorReport.checks : [];
  const policy = checks.find((check) => check?.id === "policy");
  return policy?.details?.liveSmokeEnabled === true;
}

async function createWorkflow(client, fixtureRoot, timeoutMs) {
  return callTool(
    client,
    "agent_team_create_workflow",
    {
      cwd: fixtureRoot,
      workflowId: WORKFLOW_ID,
      name: "Live dogfood app workflow",
      goal: {
        title: "Build and validate a tiny production-shaped static app using real agent workers",
        successCriteria: [
          "Providers work only in retained isolated worktrees",
          "Codex integrates reviewed files manually",
          "Final fixture npm test passes",
          "Workflow report records completion and cleanup-ready evidence"
        ],
        constraints: [
          "Public MCP tools only",
          "No provider ranking or model-quality claim",
          "No source workspace mutation by implementation workers"
        ],
        nonGoals: ["Ship the fixture as a product", "Benchmark providers"]
      },
      slices: workflowSlices()
    },
    timeoutMs
  );
}

async function approvePlanning(client, fixtureRoot, timeoutMs) {
  await callTool(
    client,
    "agent_team_plan_consensus",
    {
      cwd: fixtureRoot,
      workflowId: WORKFLOW_ID,
      codexDecision: {
        status: "approve",
        category: "technical",
        summary:
          "Codex approves this disposable dogfood plan because slices are bounded, provider-scoped, and integration remains Codex-owned."
      },
      verdicts: [
        {
          reviewerRole: "code-reviewer",
          status: "approve",
          summary: "Plan is bounded by explicit write scopes and final verification."
        },
        {
          reviewerRole: "test-hardening-engineer",
          status: "approve",
          summary: "Fixture npm test is the final gate and integration evidence must be durable."
        }
      ],
      seniorReviewerEvidence: {
        status: "unavailable",
        provider: "claude-code-cli:opus",
        summary:
          "Opus senior review is required when available; this harness records degraded evidence if Opus planning review is unavailable."
      }
    },
    timeoutMs
  );
  await callTool(client, "agent_team_workflow_next", { cwd: fixtureRoot, workflowId: WORKFLOW_ID }, timeoutMs);
  await callTool(
    client,
    "agent_team_record_user_decision",
    {
      cwd: fixtureRoot,
      workflowId: WORKFLOW_ID,
      decisionId: "decision_live_dogfood_approval",
      category: "release",
      decision: "approve",
      summary: "Operator approved disposable live provider dogfood.",
      practicalEffect:
        "Real provider calls may occur in a temporary fixture, but only isolated retained worktrees are integrated by Codex."
    },
    timeoutMs
  );
}

function enabledSlicePlans() {
  return SLICE_PROVIDER_PLAN.filter(
    (slice) => slice.optionalEnv === undefined || process.env[slice.optionalEnv] !== undefined
  );
}

async function startSlices(client, fixtureRoot, timeoutMs) {
  const started = [];
  for (const plan of enabledSlicePlans()) {
    const result = await callTool(
      client,
      "agent_team_start_slices",
      {
        cwd: fixtureRoot,
        workflowId: WORKFLOW_ID,
        sliceIds: [plan.sliceId],
        provider: plan.providerSelector,
        concurrency: 1,
        timeoutMs
      },
      timeoutMs
    );
    const item = Array.isArray(result.slices) ? result.slices[0] : undefined;
    if (item?.status !== "started") {
      throw new Error(`Failed to start ${plan.sliceId}: ${JSON.stringify(item)}`);
    }
    started.push({
      ...plan,
      runId: item.run.runId
    });
  }
  return started;
}

async function waitForRuns(client, fixtureRoot, startedRuns, timeoutMs) {
  const maxWaitMs = readPositiveNumber("--max-wait-ms", timeoutMs + 120000);
  const startedAt = Date.now();
  let status = await callTool(
    client,
    "agent_team_status_many",
    {
      cwd: fixtureRoot,
      concurrency: 3,
      runs: startedRuns.map((run) => ({
        runId: run.runId,
        cwd: fixtureRoot,
        correlationId: run.sliceId
      }))
    },
    timeoutMs
  );
  while (
    !runsAreTerminal(status) &&
    Date.now() - startedAt < maxWaitMs
  ) {
    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    await delay(Math.min(2000, Math.max(0, remainingMs)));
    status = await callTool(
      client,
      "agent_team_status_many",
      {
        cwd: fixtureRoot,
        concurrency: 3,
        runs: startedRuns.map((run) => ({
          runId: run.runId,
          cwd: fixtureRoot,
          correlationId: run.sliceId
        }))
      },
      timeoutMs
    );
  }
  return status;
}

function runsAreTerminal(statusResult) {
  const rows = Array.isArray(statusResult?.runs) ? statusResult.runs : [];
  return rows.length > 0 && rows.every((item) => isTerminalRunStatus(runStatus(item)));
}

function compactStatusRows(statusResult) {
  return (Array.isArray(statusResult?.runs) ? statusResult.runs : []).map((item) => ({
    runId: item.runId,
    correlationId: item.correlationId,
    status: runStatus(item),
    executionCwd: item.run?.executionCwd,
    changedFiles: item.run?.changedFiles,
    sidecarPath: item.run?.sidecarPath,
    logPath: item.run?.logPath,
    transcriptPath: item.run?.transcriptPath,
    workspaceIsolation: item.run?.workspaceIsolation,
    workspaceCleanup: item.run?.workspaceCleanup
  }));
}

async function reviewSlices(client, fixtureRoot, startedRuns, statusRows, timeoutMs) {
  for (const run of startedRuns) {
    const row = statusRows.find((item) => item.runId === run.runId);
    if (row?.status !== "completed") {
      throw new Error(`Slice ${run.sliceId} did not complete; status=${row?.status ?? "missing"}`);
    }
    await callTool(
      client,
      "agent_team_review_slice",
      {
        cwd: fixtureRoot,
        workflowId: WORKFLOW_ID,
        sliceId: run.sliceId,
        implementationEvidence: {
          summary: `Live dogfood evidence for ${run.sliceId}.`,
          changedFiles: Array.isArray(row.changedFiles) ? row.changedFiles : run.files,
          testsRun: ["provider execution completed; final fixture npm test runs after Codex integration"],
          evidencePaths: [row.sidecarPath, row.logPath].filter(Boolean),
          sourceRunId: run.runId,
          worktreePath: row.executionCwd,
          knownRisks: ["Codex integrates only whitelisted files and reruns final fixture tests."]
        },
        codexDecision: {
          status: "approve",
          category: "technical",
          summary: `Codex approves ${run.sliceId} for controlled fixture integration.`
        },
        verdicts: [
          {
            reviewerRole: "code-reviewer",
            status: "approve",
            summary: `${run.sliceId} is approved for fixture integration.`
          },
          {
            reviewerRole: "test-hardening-engineer",
            status: "approve",
            summary: "Final fixture npm test remains the integration gate."
          }
        ],
        seniorReviewerEvidence: {
          status: "unavailable",
          provider: "claude-code-cli:opus",
          summary:
            "Opus senior implementation review unavailable during this harness; Codex records degraded evidence and keeps final authority."
        }
      },
      timeoutMs
    );
  }
}

async function copyApprovedFiles(slicePlan, sourceRoot, destinationRoot) {
  if (typeof sourceRoot !== "string" || sourceRoot.length === 0) {
    throw new Error(`Missing retained worktree for ${slicePlan.sliceId}`);
  }
  for (const file of slicePlan.files) {
    await mkdir(dirname(join(destinationRoot, file)), { recursive: true });
    await copyFile(join(sourceRoot, file), join(destinationRoot, file));
  }
}

async function runFixtureTests(fixtureRoot) {
  try {
    const result = await execFileAsync("npm", ["test"], { cwd: fixtureRoot });
    return {
      status: "passed",
      output: `${result.stdout}${result.stderr}`.trim()
    };
  } catch (error) {
    const output =
      typeof error === "object" && error !== null
        ? `${error.stdout ?? ""}${error.stderr ?? ""}`.trim()
        : String(error);
    return { status: "failed", output };
  }
}

async function integrateSlices(client, fixtureRoot, startedRuns, statusRows, timeoutMs) {
  await callTool(
    client,
    "agent_team_integration_queue",
    {
      cwd: fixtureRoot,
      workflowId: WORKFLOW_ID,
      sliceIds: startedRuns.map((run) => run.sliceId)
    },
    timeoutMs
  );
  const evidenceDir = join(fixtureRoot, ".agent-team", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  const integrations = [];
  for (const run of startedRuns) {
    const row = statusRows.find((item) => item.runId === run.runId);
    await copyApprovedFiles(run, row?.executionCwd, fixtureRoot);
    const testResult = await runFixtureTests(fixtureRoot);
    const evidencePath = join(evidenceDir, `${run.sliceId}-npm-test.txt`);
    await writeFile(evidencePath, `${testResult.output}\n`, "utf8");
    await callTool(
      client,
      "agent_team_record_integration",
      {
        cwd: fixtureRoot,
        workflowId: WORKFLOW_ID,
        sliceId: run.sliceId,
        integrationMethod: "codex-owned-whitelisted-copy",
        summary: `Codex integrated whitelisted files for ${run.sliceId} and ran fixture npm test.`,
        changedFiles: run.files,
        verification: [
          {
            command: "npm test",
            status: testResult.status,
            summary:
              testResult.status === "passed"
                ? "Fixture npm test passed after integration."
                : "Fixture npm test failed after integration.",
            evidencePath
          }
        ],
        evidencePaths: [evidencePath],
        retainedWorktreePath: row?.executionCwd,
        cleanupRecommendation:
          testResult.status === "passed"
            ? "eligible-after-evidence-saved"
            : "manual-cleanup-required"
      },
      timeoutMs
    );
    integrations.push({
      sliceId: run.sliceId,
      verificationStatus: testResult.status,
      evidencePath
    });
    if (testResult.status !== "passed") {
      throw new Error(`Fixture npm test failed after integrating ${run.sliceId}; see ${evidencePath}`);
    }
  }
  return integrations;
}

async function cleanupRuns(client, fixtureRoot, startedRuns, timeoutMs) {
  const cleanup = [];
  for (const run of startedRuns) {
    cleanup.push(
      await callTool(
        client,
        "agent_team_cleanup",
        {
          cwd: fixtureRoot,
          runId: run.runId,
          force: true
        },
        timeoutMs
      )
    );
  }
  return cleanup.map((item) => ({ runId: item.runId, status: item.status }));
}

async function runLiveDogfood() {
  await assertRuntimeExists();
  const timeoutMs = readPositiveNumber("--timeout-ms", 300000);
  const fixture = await createFixture();
  const transport = new StdioClientTransport({
    command: "node",
    args: [runtimePath],
    cwd: repoRoot,
    env: providerEnvironment(),
    stderr: "pipe"
  });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString("utf8"));
  });
  const client = new Client({
    name: "agent-team-live-dogfood-app",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const doctor = await callTool(client, "agent_team_doctor", { cwd: fixture.root }, 30000);
    if (doctor.ok !== true || !policyLiveSmokeEnabled(doctor)) {
      throw new Error("Doctor did not pass for the live dogfood fixture.");
    }
    await createWorkflow(client, fixture.root, timeoutMs);
    await approvePlanning(client, fixture.root, timeoutMs);
    const startedRuns = await startSlices(client, fixture.root, timeoutMs);
    const status = await waitForRuns(client, fixture.root, startedRuns, timeoutMs);
    const statusRows = compactStatusRows(status);
    await reviewSlices(client, fixture.root, startedRuns, statusRows, timeoutMs);
    const integrations = await integrateSlices(client, fixture.root, startedRuns, statusRows, timeoutMs);
    const workflowReport = await callTool(
      client,
      "agent_team_workflow_report",
      { cwd: fixture.root, workflowId: WORKFLOW_ID },
      timeoutMs
    );
    const dashboard = await callTool(
      client,
      "agent_team_dashboard",
      {
        cwd: fixture.root,
        runs: startedRuns.map((run) => ({
          runId: run.runId,
          cwd: fixture.root,
          correlationId: run.sliceId
        })),
        concurrency: 3
      },
      timeoutMs
    );
    const summary = await callTool(
      client,
      "agent_team_summary",
      {
        cwd: fixture.root,
        runs: startedRuns.map((run) => ({
          runId: run.runId,
          cwd: fixture.root,
          correlationId: run.sliceId
        })),
        concurrency: 3
      },
      timeoutMs
    );
    const cleanup = await cleanupRuns(client, fixture.root, startedRuns, timeoutMs);
    const report = {
      status:
        workflowReport.completionStatus === "complete" &&
        cleanup.every((item) => item.status === "removed")
          ? "completed"
          : "failed",
      liveProviderUse: true,
      claimBoundary: CLAIM_BOUNDARY,
      fixtureRoot: fixture.root,
      providerSelectors: startedRuns.map((run) => run.providerSelector),
      toolFlow: TOOL_FLOW,
      runs: statusRows,
      integrations,
      workflow: {
        workflowId: WORKFLOW_ID,
        completionStatus: workflowReport.completionStatus,
        cleanupReadyCount: workflowReport.cleanupReady?.length
      },
      dashboard: {
        status: dashboard.status,
        counts: dashboard.counts
      },
      summary: {
        status: summary.status,
        groups: summary.groups
      },
      cleanup,
      knownLimitations: KNOWN_LIMITATIONS
    };
    if (!hasFlag("--keep-fixture")) {
      await rm(fixture.root, { recursive: true, force: true });
      return { ...report, fixtureRemoved: true };
    }
    return { ...report, fixtureRemoved: false };
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr.length === 0 ? message : `${message}\nServer stderr:\n${stderr}`);
  } finally {
    await client.close();
  }
}

async function main() {
  if (hasFlag("--dry-run")) {
    console.log(JSON.stringify(dryRunReport(), null, 2));
    return;
  }
  if (!hasFlag("--confirm-live-provider-use")) {
    console.error(
      "Refusing live provider use. Pass --dry-run for a plan or --confirm-live-provider-use to run live dogfood."
    );
    process.exitCode = 1;
    return;
  }
  const report = await runLiveDogfood();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
