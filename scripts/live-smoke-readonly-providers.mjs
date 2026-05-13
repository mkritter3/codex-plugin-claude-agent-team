#!/usr/bin/env node

import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildToolRequestOptions } from "./live-smoke-claude-utils.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");

const TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_list_providers",
  "agent_team_dispatch",
  "agent_team_dashboard",
  "agent_team_summary"
];

const KNOWN_LIMITATIONS = [
  "This smoke proves explicit read-only provider routing and lifecycle evidence only; it makes no provider comparison, ranking, score, or long-context claim.",
  "Live provider use is operator-triggered and is not part of CI.",
  "Only synchronous read-only dispatch is planned; background sessions, edits, resume, message, wind-down, cancel, and cleanup are not exercised."
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

function readValues(name) {
  const values = [];
  const input = args();
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === name) {
      const value = input[index + 1];
      if (value !== undefined && !value.startsWith("--")) {
        values.push(value);
      }
    }
  }
  return values;
}

function readConcurrency() {
  const raw = readValue("--concurrency", "1");
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 3) {
    throw new Error("--concurrency must be an integer from 1 to 3.");
  }
  return value;
}

function readPositiveNumber(name, fallback) {
  const raw = readValue(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function requireProviderSelectors() {
  const providerSelectors = readValues("--provider");
  if (providerSelectors.length === 0) {
    throw new Error("At least one explicit --provider <selector> is required.");
  }
  return providerSelectors;
}

function dryRunReport(workspaceRoot, providerSelectors) {
  return {
    status: "dry_run",
    liveProviderUse: false,
    workspaceRoot,
    providerSelectors,
    authMode: "explicit-provider-config",
    toolFlow: TOOL_FLOW,
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement: "policy.liveSmokeEnabled must be true",
    plannedRuns: providerSelectors.map((providerSelector, index) => ({
      role: "code-reviewer",
      providerSelector,
      correlationId: `provider-proof-${index}`
    })),
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(`Missing ${runtimePath}. Run npm run build before provider live smoke.`);
  }
}

async function callTool(client, name, toolArgs, timeoutMs) {
  const options = timeoutMs === undefined ? undefined : buildToolRequestOptions(timeoutMs);
  const result = await client.callTool({ name, arguments: toolArgs }, undefined, options);
  return result.structuredContent ?? {};
}

function policyLiveSmokeEnabled(doctorReport) {
  const checks = Array.isArray(doctorReport.checks) ? doctorReport.checks : [];
  const policy = checks.find((check) => check?.id === "policy");
  return policy?.details?.liveSmokeEnabled === true;
}

function providerById(providerList) {
  const map = new Map();
  for (const provider of Array.isArray(providerList.providers) ? providerList.providers : []) {
    if (typeof provider?.id === "string") {
      map.set(provider.id, provider);
    }
  }
  return map;
}

function compactRunResult(input) {
  const provider = input.providerMap.get(input.result.provider);
  return {
    index: input.index,
    status: input.result.status === "completed" ? "completed" : "failed",
    providerSelector: input.providerSelector,
    selectedProviderId: input.result.provider,
    authMode: provider?.authMode,
    runId: input.result.runId,
    runStatus: input.result.status,
    verdict: input.result.verdict?.verdict ?? input.result.verdict?.status,
    sidecarPath: input.result.sidecarPath,
    logPath: input.result.logPath
  };
}

function failedRunResult(index, providerSelector) {
  return {
    index,
    status: "failed",
    providerSelector,
    error: "Provider proof dispatch failed; inspect MCP server logs and provider configuration."
  };
}

async function runBoundedProofs(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

function runRefs(proofs, workspaceRoot) {
  return proofs
    .filter((proof) => proof?.status === "completed" && typeof proof.runId === "string")
    .map((proof) => ({
      runId: proof.runId,
      cwd: workspaceRoot,
      correlationId: `provider-proof-${proof.index}`
    }));
}

function compactEvidenceReport(input) {
  const refs = runRefs(input.proofs, input.workspaceRoot);
  return {
    status: refs.length > 0 ? "completed" : "failed",
    liveProviderUse: true,
    workspaceRoot: input.workspaceRoot,
    providerSelectors: input.providerSelectors,
    authMode: "explicit-provider-config",
    toolFlow: TOOL_FLOW,
    proofs: input.proofs,
    dashboard: {
      status: input.dashboard?.status,
      counts: input.dashboard?.counts
    },
    summary: {
      status: input.summary?.status,
      groups: input.summary?.groups
    },
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function runLiveSmoke(workspaceRoot, providerSelectors) {
  await assertRuntimeExists();
  const concurrency = readConcurrency();
  const timeoutMs = readPositiveNumber("--timeout-ms", 120000);

  const transport = new StdioClientTransport({
    command: "node",
    args: [runtimePath],
    cwd: repoRoot,
    env: process.env,
    stderr: "pipe"
  });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString("utf8"));
  });

  const client = new Client({
    name: "agent-team-provider-live-smoke",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const doctor = await callTool(client, "agent_team_doctor", { cwd: workspaceRoot }, 30000);
    if (doctor.ok !== true) {
      throw new Error("agent_team_doctor did not pass for the provider proof workspace.");
    }
    if (!policyLiveSmokeEnabled(doctor)) {
      throw new Error(
        "Workspace policy.liveSmokeEnabled must be true before provider proof smoke can run."
      );
    }

    const providers = providerById(
      await callTool(client, "agent_team_list_providers", { cwd: workspaceRoot }, 30000)
    );
    const proofs = await runBoundedProofs(
      providerSelectors,
      concurrency,
      async (providerSelector, index) => {
        try {
          const result = await callTool(
            client,
            "agent_team_dispatch",
            {
              cwd: workspaceRoot,
              provider: providerSelector,
              role: "code-reviewer",
              task: "Live provider transport proof only. Do not inspect files. Return a concise SHIP/BLOCK/NEEDS_INPUT verdict stating whether the provider route responded successfully.",
              timeoutMs
            },
            timeoutMs
          );
          return compactRunResult({
            index,
            providerSelector,
            result,
            providerMap: providers
          });
        } catch {
          return failedRunResult(index, providerSelector);
        }
      }
    );

    const refs = runRefs(proofs, workspaceRoot);
    const dashboard =
      refs.length === 0
        ? undefined
        : await callTool(
            client,
            "agent_team_dashboard",
            {
              cwd: workspaceRoot,
              runs: refs,
              concurrency
            },
            timeoutMs
          );
    const summary =
      refs.length === 0
        ? undefined
        : await callTool(
            client,
            "agent_team_summary",
            {
              cwd: workspaceRoot,
              runs: refs,
              concurrency
            },
            timeoutMs
          );

    return compactEvidenceReport({
      workspaceRoot,
      providerSelectors,
      proofs,
      dashboard,
      summary
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
  const providerSelectors = requireProviderSelectors();
  readConcurrency();
  readPositiveNumber("--timeout-ms", 120000);

  if (hasFlag("--dry-run")) {
    console.log(JSON.stringify(dryRunReport(workspaceRoot, providerSelectors), null, 2));
    return;
  }

  if (!hasFlag("--confirm-live-provider-use")) {
    console.error(
      "Refusing to run provider live smoke without --confirm-live-provider-use. Use --dry-run to inspect the planned flow without live provider use."
    );
    process.exitCode = 1;
    return;
  }

  const report = await runLiveSmoke(workspaceRoot, providerSelectors);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
