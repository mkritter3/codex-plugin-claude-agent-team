#!/usr/bin/env node

import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  buildLiveSmokeReportStatus,
  buildToolRequestOptions,
  compactStatusRows,
  hasAllCompletedRuns,
  nonTerminalRunRefs
} from "./live-smoke-claude-utils.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");

const TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_dispatch",
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
    correlationId: "live-direct-proof"
  },
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

async function callTool(client, name, args, timeoutMs) {
  const options = timeoutMs === undefined ? undefined : buildToolRequestOptions(timeoutMs);
  const result = await client.callTool({ name, arguments: args }, undefined, options);
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

async function waitForCompletionStatuses(client, workspaceRoot, runs, timeoutMs) {
  const maxWaitMs = readNumber("--max-wait-ms", timeoutMs + 15000);
  const startedAt = Date.now();
  let lastStatus = await callTool(client, "agent_team_status_many", {
    cwd: workspaceRoot,
    runs,
    concurrency: 2
  }, timeoutMs);
  while (!hasAllCompletedRuns(lastStatus) && Date.now() - startedAt < maxWaitMs) {
    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    await delay(Math.min(1000, Math.max(0, remainingMs)));
    lastStatus = await callTool(client, "agent_team_status_many", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    }, timeoutMs);
  }
  return lastStatus;
}

function liveReport(input) {
  const runs = compactStatusRows(input.finalStatus);
  return {
    status: input.status ?? buildLiveSmokeReportStatus(runs),
    liveProviderUse: true,
    workspaceRoot: input.workspaceRoot,
    provider: "claude-code-cli",
    authMode: "subscription-oauth",
    toolFlow: TOOL_FLOW,
    directProof: input.directProof,
    runs,
    dashboard: {
      status: input.dashboard?.status,
      counts: input.dashboard?.counts
    },
    summary: {
      status: input.summary?.status,
      groups: input.summary?.groups
    },
    messageStatus: input.messageResult?.status ?? "not_required",
    windDownStatus: input.windDownResult?.status ?? "not_required",
    cleanupStatus: input.cleanupResult?.status ?? "not_required",
    cleanup: input.cleanupResult,
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
    const timeoutMs = readNumber("--timeout-ms", 120000);
    const doctor = await callTool(client, "agent_team_doctor", { cwd: workspaceRoot }, 30000);
    if (doctor.ok !== true) {
      throw new Error("agent_team_doctor did not pass for the live smoke workspace.");
    }
    if (!policyLiveSmokeEnabled(doctor)) {
      throw new Error(
        "Workspace policy.liveSmokeEnabled must be true before live Claude smoke can run."
      );
    }

    const directProof = await callTool(client, "agent_team_dispatch", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      role: "planner",
      task: "Live proof only. Return verdict SHIP with summary exactly MCP dispatch reached Claude. Do not inspect files. Do not edit files.",
      timeoutMs
    }, timeoutMs);
    if (directProof.status !== "completed") {
      throw new Error("agent_team_dispatch did not complete the direct live Claude proof.");
    }

    const start = await callTool(client, "agent_team_start_parallel", {
      cwd: workspaceRoot,
      provider: "claude-code-cli",
      concurrency: 2,
      timeoutMs,
      runs: [
        {
          role: "planner",
          task: "Live smoke only. Do not inspect files. Do not edit files. Return verdict SHIP with summary exactly parallel planner reached Claude.",
          correlationId: "live-planner"
        },
        {
          role: "code-reviewer",
          task: "Live smoke only. Do not inspect files. Do not edit files. Return verdict SHIP with summary exactly parallel reviewer reached Claude.",
          correlationId: "live-reviewer"
        }
      ]
    }, timeoutMs);

    const refs = runRefs(start, workspaceRoot);
    if (refs.length === 0) {
      throw new Error("agent_team_start_parallel did not start any live-smoke runs.");
    }

    const runs = refs.map((ref) => ({
      runId: ref.runId,
      cwd: workspaceRoot,
      correlationId: ref.correlationId
    }));
    let finalStatus = await waitForCompletionStatuses(client, workspaceRoot, runs, timeoutMs);
    let messageResult;
    let windDownResult;
    let cleanupResult;

    if (!hasAllCompletedRuns(finalStatus)) {
      messageResult = await callTool(client, "agent_team_message_many", {
        cwd: workspaceRoot,
        concurrency: 2,
        messages: refs.map((ref) => ({
          runId: ref.runId,
          cwd: workspaceRoot,
          message: "Live smoke operator update: please wrap up with a concise final verdict.",
          messageType: "operator_update",
          correlationId: `${ref.correlationId ?? ref.runId}-message`
        }))
      }, timeoutMs);
      windDownResult = await callTool(client, "agent_team_wind_down_many", {
        cwd: workspaceRoot,
        runs,
        concurrency: 2
      }, timeoutMs);
      finalStatus = await waitForCompletionStatuses(client, workspaceRoot, runs, timeoutMs);
    }

    const lingeringRuns = nonTerminalRunRefs(finalStatus, runs);
    if (lingeringRuns.length > 0) {
      cleanupResult = await callTool(client, "agent_team_cancel_many", {
        cwd: workspaceRoot,
        runs: lingeringRuns,
        concurrency: 2
      }, timeoutMs);
      finalStatus = await callTool(client, "agent_team_status_many", {
        cwd: workspaceRoot,
        runs,
        concurrency: 2
      }, timeoutMs);
    }

    const dashboard = await callTool(client, "agent_team_dashboard", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    }, timeoutMs);
    const summary = await callTool(client, "agent_team_summary", {
      cwd: workspaceRoot,
      runs,
      concurrency: 2
    }, timeoutMs);

    return liveReport({
      workspaceRoot,
      directProof: {
        status: directProof.status,
        runId: directProof.runId,
        verdict: directProof.verdict?.verdict ?? directProof.verdict?.status,
        sidecarPath: directProof.sidecarPath,
        logPath: directProof.logPath
      },
      dashboard,
      summary,
      messageResult,
      windDownResult,
      cleanupResult,
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
  if (report.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
