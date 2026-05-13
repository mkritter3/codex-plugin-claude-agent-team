#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
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
  isTerminalRunStatus
} from "./live-smoke-claude-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");
const PROVIDER_ID = "gemini-cli";
const PROVIDER_FAMILY = "family:gemini-cli";
const DEFAULT_MODEL = "gemini-3-flash-preview";
const PROOF_FILE = "index.html";
const PROOF_TEXT = "Gemini UI write proof";

const TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_list_providers",
  "agent_team_start",
  "agent_team_status",
  "agent_team_dashboard",
  "agent_team_summary",
  "agent_team_cleanup"
];

const KNOWN_LIMITATIONS = [
  "This smoke proves isolated write containment for the explicitly configured Gemini CLI provider only.",
  "Live provider use is operator-triggered and is not part of CI.",
  "The proof fixture is disposable; successful runs still require Codex review before any production write-validation policy is broadened.",
  "This smoke does not prove model quality, provider ranking, broad UI excellence, or mid-flight steering."
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

function readPositiveNumber(name, fallback) {
  const raw = readValue(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function requireProviderSelectors() {
  const providers = readValues("--provider");
  if (providers.length === 0) {
    return [PROVIDER_ID];
  }
  for (const provider of providers) {
    if (provider !== PROVIDER_ID && provider !== PROVIDER_FAMILY) {
      throw new Error(
        "Gemini write validation requires --provider gemini-cli or --provider family:gemini-cli."
      );
    }
  }
  return providers;
}

function dryRunReport(providerSelectors) {
  const model = readValue("--model", DEFAULT_MODEL);
  return {
    status: "dry_run",
    liveProviderUse: false,
    providerSelectors,
    model,
    authMode: "oauth",
    toolFlow: TOOL_FLOW,
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement:
      "fixture policy.liveSmokeEnabled, writeMode, writeValidated, and isolated worktree roots must be enabled",
    plannedProofs: providerSelectors.map((providerSelector) => ({
      role: "frontend-engineer",
      providerSelector,
      expectedFile: PROOF_FILE,
      expectedText: PROOF_TEXT
    })),
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(`Missing ${runtimePath}. Run npm run build before Gemini write validation.`);
  }
}

function assertTrustedWorkspaceEnv() {
  if (process.env.GEMINI_CLI_TRUST_WORKSPACE !== "true") {
    throw new Error(
      "Gemini write validation requires GEMINI_CLI_TRUST_WORKSPACE=true for the disposable fixture."
    );
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

async function createWriteValidationFixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-team-gemini-write-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "agent-team@example.invalid"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.name", "Agent Team Gemini Write Smoke"], {
    cwd: root
  });
  await writeFile(
    join(root, PROOF_FILE),
    [
      "<!doctype html>",
      '<main id="app">',
      "  <h1>Before Gemini write validation</h1>",
      "</main>",
      ""
    ].join("\n"),
    "utf8"
  );
  await execFileAsync("git", ["add", PROOF_FILE], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
  const gitRoot = (
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: root })
  ).stdout.trim();

  const allowedWorktreeRoot = join(dirname(gitRoot), ".agent-team-worktrees", basename(gitRoot));
  await mkdir(join(root, ".agent-team"), { recursive: true });
  await writeFile(
    join(root, ".agent-team", "config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        writeMode: { enabled: true, requireIsolatedWorktree: true },
        auth: { allowApiKeyFallback: false },
        providers: {
          geminiCli: {
            enabled: true,
            executable: "gemini",
            model: readValue("--model", DEFAULT_MODEL),
            displayName: "Gemini CLI UI Worker",
            projectEnv: "GOOGLE_CLOUD_PROJECT",
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
        },
        routing: {
          rolePins: {
            "ui-ux-designer": PROVIDER_ID,
            "ux-product-critic": PROVIDER_ID,
            "frontend-engineer": PROVIDER_ID
          },
          providerOrder: [PROVIDER_ID]
        },
        policy: {
          allowedRoles: ["frontend-engineer"],
          allowedProviderSelectors: [PROVIDER_ID, PROVIDER_FAMILY],
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

  return { root, allowedWorktreeRoot };
}

function policyLiveSmokeEnabled(doctorReport) {
  const checks = Array.isArray(doctorReport.checks) ? doctorReport.checks : [];
  const policy = checks.find((check) => check?.id === "policy");
  return policy?.details?.liveSmokeEnabled === true;
}

function providerHasWriteCapabilities(providerList) {
  const providers = Array.isArray(providerList.providers) ? providerList.providers : [];
  const provider = providers.find((item) => item?.id === PROVIDER_ID);
  const capabilities = Array.isArray(provider?.capabilities) ? provider.capabilities : [];
  return [
    "tools",
    "sessionResume",
    "cancellation",
    "edits",
    "workspaceIsolation"
  ].every((capability) => capabilities.includes(capability));
}

async function waitForTerminalStatus(client, workspaceRoot, runId, timeoutMs) {
  const maxWaitMs = readPositiveNumber("--max-wait-ms", timeoutMs + 15000);
  const startedAt = Date.now();
  let status = await callTool(client, "agent_team_status", { cwd: workspaceRoot, runId }, timeoutMs);
  while (!isTerminalRunStatus(status?.run?.status) && Date.now() - startedAt < maxWaitMs) {
    const remainingMs = maxWaitMs - (Date.now() - startedAt);
    await delay(Math.min(1000, Math.max(0, remainingMs)));
    status = await callTool(client, "agent_team_status", { cwd: workspaceRoot, runId }, timeoutMs);
  }
  return status;
}

async function proofFileState(statusResult) {
  const run = statusResult?.run ?? {};
  const executionCwd = run.executionCwd;
  const sourceCwd = run.sourceCwd;
  let executionContent;
  let sourceContent;
  if (typeof executionCwd === "string") {
    try {
      executionContent = await readFile(join(executionCwd, PROOF_FILE), "utf8");
    } catch {
      executionContent = undefined;
    }
  }
  if (typeof sourceCwd === "string") {
    try {
      sourceContent = await readFile(join(sourceCwd, PROOF_FILE), "utf8");
    } catch {
      sourceContent = undefined;
    }
  }
  return {
    expectedFile: PROOF_FILE,
    expectedText: PROOF_TEXT,
    executionContainsProof: executionContent?.includes(PROOF_TEXT) === true,
    sourceUnmodified: sourceContent?.includes(PROOF_TEXT) === false
  };
}

function runSucceeded(statusResult, fileState) {
  const run = statusResult?.run ?? {};
  const changedFiles = Array.isArray(run.changedFiles) ? run.changedFiles : [];
  return (
    run.status === "completed" &&
    run.workspaceIsolation === "git-worktree" &&
    run.workspaceCleanup === "retained" &&
    changedFiles.length === 1 &&
    changedFiles.includes(PROOF_FILE) &&
    fileState.executionContainsProof === true &&
    fileState.sourceUnmodified === true
  );
}

async function validateProvider(client, providerSelector, timeoutMs) {
  const fixture = await createWriteValidationFixture();
  const doctor = await callTool(client, "agent_team_doctor", { cwd: fixture.root }, 30000);
  if (doctor.ok !== true || !policyLiveSmokeEnabled(doctor)) {
    throw new Error(`Doctor did not pass for ${providerSelector} write validation fixture.`);
  }
  const providerList = await callTool(client, "agent_team_list_providers", { cwd: fixture.root }, 30000);
  if (!providerHasWriteCapabilities(providerList)) {
    throw new Error("gemini-cli did not expose all required autonomous worker capabilities.");
  }

  const start = await callTool(
    client,
    "agent_team_start",
    {
      cwd: fixture.root,
      provider: providerSelector,
      role: "frontend-engineer",
      task: `Gemini UI write validation proof. In the execution workspace only, edit ${PROOF_FILE} so the h1 text is exactly: ${PROOF_TEXT}. Do not modify any other files. Do not edit the source workspace. Return verdict SHIP with changed file evidence.`,
      timeoutMs
    },
    timeoutMs
  );
  const status = await waitForTerminalStatus(client, fixture.root, start.runId, timeoutMs);
  const fileState = await proofFileState(status);
  const dashboard = await callTool(
    client,
    "agent_team_dashboard",
    {
      cwd: fixture.root,
      runs: [{ runId: start.runId, cwd: fixture.root, correlationId: providerSelector }],
      concurrency: 1
    },
    timeoutMs
  );
  const summary = await callTool(
    client,
    "agent_team_summary",
    {
      cwd: fixture.root,
      runs: [{ runId: start.runId, cwd: fixture.root, correlationId: providerSelector }],
      concurrency: 1
    },
    timeoutMs
  );
  const cleanup = await callTool(
    client,
    "agent_team_cleanup",
    {
      cwd: fixture.root,
      runId: start.runId,
      force: true
    },
    timeoutMs
  );

  const run = status?.run ?? {};
  const cleanupOk = cleanup.status === "removed";
  const statusOk = runSucceeded(status, fileState);
  return {
    providerSelector,
    fixtureRoot: fixture.root,
    status: statusOk && cleanupOk ? "completed" : "failed",
    runId: start.runId,
    runStatus: run.status,
    verdict: run.verdict?.status,
    sidecarPath: run.sidecarPath,
    logPath: run.logPath,
    executionCwd: run.executionCwd,
    workspaceIsolation: run.workspaceIsolation,
    workspaceCleanup: run.workspaceCleanup,
    changedFiles: run.changedFiles,
    fileState,
    dashboard: {
      status: dashboard.status,
      counts: dashboard.counts
    },
    summary: {
      status: summary.status,
      groups: summary.groups
    },
    cleanup: {
      status: cleanup.status,
      runId: cleanup.runId
    }
  };
}

async function runLiveValidation(providerSelectors) {
  await assertRuntimeExists();
  assertTrustedWorkspaceEnv();
  const timeoutMs = readPositiveNumber("--timeout-ms", 240000);

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
    name: "agent-team-gemini-write-validation",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const proofs = [];
    for (const providerSelector of providerSelectors) {
      proofs.push(await validateProvider(client, providerSelector, timeoutMs));
    }
    return {
      status: proofs.every((proof) => proof.status === "completed") ? "completed" : "failed",
      liveProviderUse: true,
      providerSelectors,
      authMode: "oauth",
      model: readValue("--model", DEFAULT_MODEL),
      toolFlow: TOOL_FLOW,
      proofs,
      knownLimitations: KNOWN_LIMITATIONS
    };
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr.length === 0 ? message : `${message}\nServer stderr:\n${stderr}`);
  } finally {
    await client.close();
  }
}

async function main() {
  const providerSelectors = requireProviderSelectors();

  if (hasFlag("--dry-run")) {
    console.log(JSON.stringify(dryRunReport(providerSelectors), null, 2));
    return;
  }

  if (!hasFlag("--confirm-live-provider-use")) {
    console.error(
      "Refusing live provider use. Pass --dry-run for a plan or --confirm-live-provider-use to run Gemini write validation."
    );
    process.exitCode = 1;
    return;
  }

  const report = await runLiveValidation(providerSelectors);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
