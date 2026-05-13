#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  buildToolRequestOptions,
  compactStatusRows,
  hasAllCompletedRuns,
  isTerminalRunStatus
} from "./live-smoke-claude-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");

const TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_dispatch",
  "agent_team_start_parallel",
  "agent_team_start",
  "agent_team_status_many",
  "agent_team_message",
  "agent_team_wind_down",
  "agent_team_cancel",
  "agent_team_create_team",
  "agent_team_dashboard",
  "agent_team_summary",
  "agent_team_cleanup"
];

const PLANNED_CAPABILITIES = [
  "direct-dispatch",
  "parallel-read-only-team",
  "isolated-implementation",
  "mailbox-delivery",
  "wind-down",
  "cancellation",
  "team-record",
  "dashboard",
  "summary",
  "cleanup",
  "policy-failure"
];

const KNOWN_LIMITATIONS = [
  "This smoke proves control-plane mechanics only; it makes no provider ranking or model-quality claim.",
  "Live provider use is operator-triggered and is not part of CI.",
  "Implementation changes remain in retained isolated worktrees until Codex reviews and integrates them."
];

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function readValue(name, fallback) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

function readNumber(name, fallback) {
  const raw = readValue(name, String(fallback));
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dryRunReport(workspaceRoot) {
  return {
    status: "dry_run",
    liveProviderUse: false,
    workspaceRoot,
    provider: "claude-code-cli",
    authMode: "subscription-oauth",
    toolFlow: TOOL_FLOW,
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement: "policy.liveSmokeEnabled must be true",
    plannedCapabilities: PLANNED_CAPABILITIES,
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(`Missing ${runtimePath}. Run npm run build before live matrix smoke.`);
  }
}

async function callTool(client, name, args, timeoutMs) {
  const options = timeoutMs === undefined ? undefined : buildToolRequestOptions(timeoutMs);
  const result = await client.callTool({ name, arguments: args }, undefined, options);
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

function policyLiveSmokeEnabled(doctorReport) {
  const checks = Array.isArray(doctorReport.checks) ? doctorReport.checks : [];
  const policy = checks.find((check) => check?.id === "policy");
  return policy?.details?.liveSmokeEnabled === true;
}

function runRefs(startResult, workspaceRoot) {
  return (Array.isArray(startResult.runs) ? startResult.runs : [])
    .filter((item) => item?.status === "started" && typeof item.run?.runId === "string")
    .map((item) => ({
      runId: item.run.runId,
      cwd: workspaceRoot,
      correlationId: item.correlationId,
      role: item.run.role
    }));
}

function singleRunRef(startResult, workspaceRoot, correlationId) {
  if (typeof startResult.runId !== "string") {
    throw new Error(`Expected ${correlationId} start to return a run id.`);
  }
  return {
    runId: startResult.runId,
    cwd: workspaceRoot,
    correlationId,
    role: startResult.role
  };
}

async function waitForTerminalStatus(client, workspaceRoot, run, timeoutMs) {
  const maxWaitMs = readNumber("--max-wait-ms", timeoutMs + 15_000);
  const startedAt = Date.now();
  let status = await callTool(client, "agent_team_status", {
    cwd: workspaceRoot,
    runId: run.runId
  }, timeoutMs);
  while (!isTerminalRunStatus(status?.run?.status) && Date.now() - startedAt < maxWaitMs) {
    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    await delay(Math.min(1000, Math.max(0, remainingMs)));
    status = await callTool(client, "agent_team_status", {
      cwd: workspaceRoot,
      runId: run.runId
    }, timeoutMs);
  }
  return status;
}

async function waitForCompletedStatuses(client, workspaceRoot, runs, timeoutMs) {
  const maxWaitMs = readNumber("--max-wait-ms", timeoutMs + 15_000);
  const startedAt = Date.now();
  let status = await callTool(client, "agent_team_status_many", {
    cwd: workspaceRoot,
    runs,
    concurrency: 2
  }, timeoutMs);
  while (!hasAllCompletedRuns(status) && Date.now() - startedAt < maxWaitMs) {
    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    await delay(Math.min(1000, Math.max(0, remainingMs)));
    status = await callTool(client, "agent_team_status_many", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    }, timeoutMs);
  }
  return status;
}

function compactSingleStatus(statusResult, correlationId) {
  const run = statusResult?.run ?? {};
  return {
    runId: run.runId,
    role: run.role,
    provider: run.provider,
    correlationId,
    status: run.status,
    evidencePaths: run.evidencePaths,
    sidecarPath: run.sidecarPath,
    logPath: run.logPath,
    transcriptPath: run.transcriptPath,
    sourceCwd: run.sourceCwd,
    executionCwd: run.executionCwd,
    workspaceBranchName: run.workspaceBranchName,
    workspaceIsolation: run.workspaceIsolation,
    workspaceCleanup: run.workspaceCleanup,
    changedFiles: run.changedFiles,
    workspaceStatus: run.workspaceStatus,
    cleanup: run.cleanup,
    verdict: run.verdict?.status
  };
}

function compactRows(statusResult) {
  return compactStatusRows(statusResult).map((row) => ({
    runId: row.runId,
    role: row.role,
    correlationId: row.correlationId,
    status: row.status,
    evidencePaths: row.evidencePaths,
    sidecarPath: row.sidecarPath,
    logPath: row.logPath,
    transcriptPath: row.transcriptPath,
    cleanup: row.cleanup,
    workspaceCleanup: row.workspaceCleanup
  }));
}

async function cleanupIfRetained(client, workspaceRoot, statusResult, timeoutMs) {
  const run = statusResult?.run ?? {};
  if (run.workspaceCleanup !== "retained" || typeof run.runId !== "string") {
    return { status: "not_required", runId: run.runId };
  }
  return callTool(client, "agent_team_cleanup", {
    cwd: workspaceRoot,
    runId: run.runId,
    force: true
  }, timeoutMs);
}

async function createPolicyFailureWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "agent-team-policy-failure-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "agent-team@example.invalid"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.name", "Agent Team Smoke"], { cwd: root });
  await writeFile(join(root, "README.md"), "policy failure fixture\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
  await mkdir(join(root, ".agent-team"), { recursive: true });
  await writeFile(
    join(root, ".agent-team", "config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        policy: {
          allowedRoles: ["slice-implementer"],
          allowedProviderSelectors: ["claude-code-cli"],
          allowWriteMode: true,
          allowedWorktreeRoots: [join(root, "not-the-planned-worktree-root")],
          liveSmokeEnabled: true,
          auditEnabled: true
        }
      },
      null,
      2
    )
  );
  return root;
}

async function provePolicyFailure(client, timeoutMs) {
  const fixtureRoot = await createPolicyFailureWorkspace();
  try {
    await callTool(client, "agent_team_start", {
      cwd: fixtureRoot,
      provider: "claude-code-cli",
      role: "slice-implementer",
      task: "Policy failure fixture. This provider should never start.",
      timeoutMs
    }, timeoutMs);
    return { status: "failed", reason: "policy unexpectedly allowed start" };
  } catch (error) {
    return {
      status: "blocked",
      reason: error instanceof Error ? error.message.split("\n")[0] : String(error)
    };
  }
}

function matrixStatus(report) {
  const statuses = [
    report.directProof?.status,
    ...(report.readOnlyRuns ?? []).map((run) => run.status),
    report.implementationRun?.status,
    report.mailboxRun?.status,
    report.windDownRun?.status,
    report.cancelRun?.status
  ].filter(Boolean);
  const policyOk = report.policyFailure?.status === "blocked";
  const dashboardOk = report.dashboard?.status === "ok";
  const summaryOk = report.summary?.status === "ok";
  const cleanupOk = (report.cleanup ?? []).every((item) =>
    ["removed", "not_required"].includes(item?.status)
  );
  return statuses.every((status) => isTerminalRunStatus(status)) &&
    policyOk &&
    dashboardOk &&
    summaryOk &&
    cleanupOk
    ? "completed"
    : "failed";
}

async function runLiveMatrix(workspaceRoot) {
  await assertRuntimeExists();
  const timeoutMs = readNumber("--timeout-ms", 120000);

  const transport = new StdioClientTransport({
    command: "node",
    args: [runtimePath],
    cwd: repoRoot,
    env: process.env,
    stderr: "pipe"
  });
  const client = new Client({
    name: "agent-team-claude-live-capability-matrix",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const doctor = await callTool(client, "agent_team_doctor", { cwd: workspaceRoot }, 30000);
    if (doctor.ok !== true) {
      throw new Error("agent_team_doctor did not pass for the live matrix workspace.");
    }
    if (!policyLiveSmokeEnabled(doctor)) {
      throw new Error(
        "Workspace policy.liveSmokeEnabled must be true before live Claude matrix can run."
      );
    }

    const directProof = await callTool(client, "agent_team_dispatch", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      role: "planner",
      task: "Live matrix direct proof only. Return verdict SHIP with summary exactly matrix dispatch reached Claude. Do not edit files.",
      timeoutMs
    }, timeoutMs);

    const readOnlyStart = await callTool(client, "agent_team_start_parallel", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      concurrency: 2,
      timeoutMs,
      runs: [
        {
          role: "planner",
          task: "Live matrix read-only planner proof. Return verdict SHIP with summary exactly matrix planner reached Claude. Do not edit files.",
          correlationId: "matrix-planner"
        },
        {
          role: "code-reviewer",
          task: "Live matrix read-only reviewer proof. Return verdict SHIP with summary exactly matrix reviewer reached Claude. Do not edit files.",
          correlationId: "matrix-reviewer"
        }
      ]
    }, timeoutMs);
    const readOnlyRefs = runRefs(readOnlyStart, workspaceRoot);
    const readOnlyStatus = await waitForCompletedStatuses(
      client,
      workspaceRoot,
      readOnlyRefs,
      timeoutMs
    );

    const implementationStart = await callTool(client, "agent_team_start", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      role: "slice-implementer",
      task: "Live matrix implementation proof. In the execution worktree only, create MATRIX_WRITE_PROOF.txt with exactly one line: matrix isolated write proof. Do not modify any other files. Return verdict SHIP with changed file evidence.",
      timeoutMs
    }, timeoutMs);
    const implementationRef = singleRunRef(
      implementationStart,
      workspaceRoot,
      "matrix-implementation"
    );
    const implementationStatus = await waitForTerminalStatus(
      client,
      workspaceRoot,
      implementationRef,
      timeoutMs
    );

    const mailboxStart = await callTool(client, "agent_team_start", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      role: "slice-implementer",
      task: "Live matrix mailbox proof. Wait briefly for an operator update. When you receive it, create MATRIX_MAILBOX_PROOF.txt with exactly one line: mailbox received. Return verdict SHIP with changed file evidence. Do not modify any other files.",
      timeoutMs
    }, timeoutMs);
    const mailboxRef = singleRunRef(mailboxStart, workspaceRoot, "matrix-mailbox");
    await callTool(client, "agent_team_message", {
      cwd: workspaceRoot,
      runId: mailboxRef.runId,
      message: "Live matrix operator update: create the mailbox proof file now and finish.",
      messageType: "operator_update",
      correlationId: "matrix-mailbox-message"
    }, timeoutMs);
    const mailboxStatus = await waitForTerminalStatus(client, workspaceRoot, mailboxRef, timeoutMs);

    const windDownStart = await callTool(client, "agent_team_start", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      role: "slice-implementer",
      task: "Live matrix wind-down proof. Wait briefly for an operator wind-down request, then finish with a SHIP verdict. Do not modify files.",
      timeoutMs
    }, timeoutMs);
    const windDownRef = singleRunRef(windDownStart, workspaceRoot, "matrix-wind-down");
    await callTool(client, "agent_team_wind_down", {
      cwd: workspaceRoot,
      runId: windDownRef.runId
    }, timeoutMs);
    const windDownStatus = await waitForTerminalStatus(
      client,
      workspaceRoot,
      windDownRef,
      timeoutMs
    );

    const cancelStart = await callTool(client, "agent_team_start", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      role: "slice-implementer",
      task: "Live matrix cancellation proof. Keep the run alive until cancellation. Do not modify files.",
      timeoutMs
    }, timeoutMs);
    const cancelRef = singleRunRef(cancelStart, workspaceRoot, "matrix-cancel");
    await callTool(client, "agent_team_cancel", {
      cwd: workspaceRoot,
      runId: cancelRef.runId
    }, timeoutMs);
    const cancelStatus = await waitForTerminalStatus(client, workspaceRoot, cancelRef, timeoutMs);

    const cleanup = [];
    for (const status of [
      implementationStatus,
      mailboxStatus,
      windDownStatus,
      cancelStatus
    ]) {
      cleanup.push(await cleanupIfRetained(client, workspaceRoot, status, timeoutMs));
    }

    const allRunRefs = [
      ...readOnlyRefs,
      implementationRef,
      mailboxRef,
      windDownRef,
      cancelRef
    ];
    const team = await callTool(client, "agent_team_create_team", {
      cwd: workspaceRoot,
      name: "Claude Live Capability Matrix",
      description: "Operator-run proof for Agent Team Claude control-plane capabilities.",
      runs: allRunRefs
    }, timeoutMs);
    const dashboard = await callTool(client, "agent_team_dashboard", {
      cwd: workspaceRoot,
      teamId: team.team?.teamId ?? team.teamId,
      concurrency: 2
    }, timeoutMs);
    const summary = await callTool(client, "agent_team_summary", {
      cwd: workspaceRoot,
      runs: allRunRefs,
      concurrency: 2
    }, timeoutMs);
    const policyFailure = await provePolicyFailure(client, timeoutMs);

    const report = {
      status: "pending",
      liveProviderUse: true,
      workspaceRoot,
      provider: "claude-code-cli",
      authMode: "subscription-oauth",
      toolFlow: TOOL_FLOW,
      directProof: {
        status: directProof.status,
        runId: directProof.runId,
        verdict: directProof.verdict,
        sidecarPath: directProof.sidecarPath,
        logPath: directProof.logPath
      },
      readOnlyRuns: compactRows(readOnlyStatus),
      implementationRun: compactSingleStatus(implementationStatus, "matrix-implementation"),
      mailboxRun: compactSingleStatus(mailboxStatus, "matrix-mailbox"),
      windDownRun: compactSingleStatus(windDownStatus, "matrix-wind-down"),
      cancelRun: compactSingleStatus(cancelStatus, "matrix-cancel"),
      team: {
        status: team.status,
        teamId: team.team?.teamId ?? team.teamId
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
      policyFailure,
      knownLimitations: KNOWN_LIMITATIONS
    };
    return { ...report, status: matrixStatus(report) };
  } finally {
    await client.close();
  }
}

async function main() {
  const workspaceRoot = readValue("--cwd", process.cwd());
  if (hasFlag("--dry-run")) {
    console.log(JSON.stringify(dryRunReport(workspaceRoot), null, 2));
    return;
  }
  if (!hasFlag("--confirm-live-provider-use")) {
    console.error(
      "Refusing live provider use. Pass --dry-run for a plan or --confirm-live-provider-use to run the live capability matrix."
    );
    process.exitCode = 1;
    return;
  }

  const report = await runLiveMatrix(workspaceRoot);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
