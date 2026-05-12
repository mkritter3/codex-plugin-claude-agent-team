#!/usr/bin/env node

import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");

const TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_start_parallel",
  "agent_team_status_many",
  "agent_team_dashboard",
  "agent_team_summary",
  "agent_team_message_many",
  "agent_team_wind_down_many",
  "agent_team_status_many"
];

const PLANNED_RUNS = [
  {
    role: "planner",
    provider: "claude-code-cli",
    correlationId: "live-planner"
  },
  {
    role: "code-reviewer",
    provider: "claude-code-cli",
    correlationId: "live-reviewer"
  }
];

const KNOWN_LIMITATIONS = [
  "This smoke proves transport and lifecycle mechanics only; it makes no provider ranking, comparative capability, or long-context claim.",
  "Live provider use is operator-triggered and is not part of CI.",
  "Only read-only roles are planned; implementation worktrees and cleanup are not exercised."
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
    plannedRuns: PLANNED_RUNS,
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(`Missing ${runtimePath}. Run npm run build before live smoke.`);
  }
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
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
      cwd: item.run.executionCwd ?? workspaceRoot,
      correlationId: item.correlationId,
      role: item.run.role
    }));
}

function compactStatusRows(statusResult) {
  return (Array.isArray(statusResult.runs) ? statusResult.runs : []).map((item) => ({
    runId: item.runId,
    role: item.run?.role,
    correlationId: item.correlationId,
    status: item.run?.status ?? item.status,
    verdict: item.run?.verdict?.verdict,
    sidecarPath: item.run?.sidecarPath,
    logPath: item.run?.logPath,
    transcriptPath: item.run?.transcriptPath,
    evidencePaths: item.run?.evidencePaths,
    cleanup: item.run?.cleanup,
    workspaceCleanup: item.run?.workspaceCleanup
  }));
}

function hasSettledStatus(statusResult) {
  const terminalStatuses = new Set([
    "awaiting-input",
    "cancelled",
    "completed",
    "expired",
    "failed",
    "winding-down"
  ]);
  const rows = Array.isArray(statusResult.runs) ? statusResult.runs : [];
  return (
    rows.length > 0 &&
    rows.every((item) => terminalStatuses.has(item.run?.status ?? item.status))
  );
}

async function waitForInitialStatuses(client, workspaceRoot, runs) {
  const maxWaitMs = readNumber("--max-wait-ms", 15000);
  const startedAt = Date.now();
  let lastStatus = await callTool(client, "agent_team_status_many", {
    cwd: workspaceRoot,
    runs,
    concurrency: 2
  });
  while (!hasSettledStatus(lastStatus) && Date.now() - startedAt < maxWaitMs) {
    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    await delay(Math.min(1000, Math.max(0, remainingMs)));
    lastStatus = await callTool(client, "agent_team_status_many", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    });
  }
  return lastStatus;
}

function liveReport(input) {
  return {
    status: "completed",
    liveProviderUse: true,
    workspaceRoot: input.workspaceRoot,
    provider: "claude-code-cli",
    authMode: "subscription-oauth",
    toolFlow: TOOL_FLOW,
    runs: compactStatusRows(input.finalStatus),
    dashboard: {
      status: input.dashboard.status,
      counts: input.dashboard.counts
    },
    summary: {
      status: input.summary.status,
      groups: input.summary.groups
    },
    messageStatus: input.messageResult.status,
    windDownStatus: input.windDownResult.status,
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function runLiveSmoke(workspaceRoot) {
  await assertRuntimeExists();

  const transport = new StdioClientTransport({
    command: "node",
    args: [runtimePath],
    cwd: repoRoot,
    stderr: "pipe"
  });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString("utf8"));
  });

  const client = new Client({
    name: "agent-team-claude-live-smoke",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const doctor = await callTool(client, "agent_team_doctor", { cwd: workspaceRoot });
    if (doctor.ok !== true) {
      throw new Error("agent_team_doctor did not pass for the live smoke workspace.");
    }
    if (!policyLiveSmokeEnabled(doctor)) {
      throw new Error(
        "Workspace policy.liveSmokeEnabled must be true before live Claude smoke can run."
      );
    }

    const timeoutMs = readNumber("--timeout-ms", 120000);
    const start = await callTool(client, "agent_team_start_parallel", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      concurrency: 2,
      timeoutMs,
      runs: [
        {
          role: "planner",
          task: "Live smoke only: confirm the workspace can be inspected and return a concise SHIP/BLOCK/NEEDS_INPUT verdict without editing files.",
          correlationId: "live-planner"
        },
        {
          role: "code-reviewer",
          task: "Live smoke only: confirm the provider path can return a concise SHIP/BLOCK/NEEDS_INPUT verdict without editing files.",
          correlationId: "live-reviewer"
        }
      ]
    });

    const refs = runRefs(start, workspaceRoot);
    if (refs.length === 0) {
      throw new Error("agent_team_start_parallel did not start any live-smoke runs.");
    }

    const runs = refs.map((ref) => ({
      runId: ref.runId,
      cwd: workspaceRoot,
      correlationId: ref.correlationId
    }));
    await waitForInitialStatuses(client, workspaceRoot, runs);
    const dashboard = await callTool(client, "agent_team_dashboard", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    });
    const summary = await callTool(client, "agent_team_summary", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    });
    const messageResult = await callTool(client, "agent_team_message_many", {
      cwd: workspaceRoot,
      concurrency: 2,
      messages: refs.map((ref) => ({
        runId: ref.runId,
        cwd: workspaceRoot,
        message: "Live smoke operator update: please wrap up with a concise final verdict.",
        messageType: "operator_update",
        correlationId: `${ref.correlationId ?? ref.runId}-message`
      }))
    });
    const windDownResult = await callTool(client, "agent_team_wind_down_many", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    });
    const finalStatus = await callTool(client, "agent_team_status_many", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    });

    return liveReport({
      workspaceRoot,
      dashboard,
      summary,
      messageResult,
      windDownResult,
      finalStatus
    });
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr.length === 0 ? message : `${message}\nServer stderr:\n${stderr}`);
  } finally {
    await client.close();
  }
}

async function main() {
  const workspaceRoot = resolve(readValue("--cwd", process.cwd()));
  if (hasFlag("--dry-run")) {
    console.log(JSON.stringify(dryRunReport(workspaceRoot), null, 2));
    return;
  }

  if (!hasFlag("--confirm-live-provider-use")) {
    console.error(
      "Refusing to run live Claude smoke without --confirm-live-provider-use. Use --dry-run to inspect the planned flow without live provider use."
    );
    process.exitCode = 1;
    return;
  }

  const report = await runLiveSmoke(workspaceRoot);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
