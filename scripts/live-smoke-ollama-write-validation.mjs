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
import { basename, dirname, join, resolve } from "node:path";
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
const PROVIDER_PREFIX = "ollama-claude-code:";
const PROOF_FILE = "OLLAMA_WRITE_PROOF.txt";

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
  "This smoke proves isolated write containment for explicitly selected Ollama Claude Code profiles only.",
  "Live provider use is operator-triggered and is not part of CI.",
  "The proof fixture is disposable; successful runs still require Codex review before any production write-validation policy is broadened."
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
    throw new Error("At least one exact --provider ollama-claude-code:<profile> selector is required.");
  }
  for (const provider of providers) {
    if (!provider.startsWith(PROVIDER_PREFIX) || provider.slice(PROVIDER_PREFIX.length).length === 0) {
      throw new Error("Write validation requires exact provider selectors like ollama-claude-code:<profile>.");
    }
  }
  return providers;
}

function profileId(providerSelector) {
  return providerSelector.slice(PROVIDER_PREFIX.length);
}

function defaultModelForProfile(id) {
  return id === "glm-5.2" || id === "kimi-k2.7-code" ? `${id}:cloud` : id;
}

function dryRunReport(providerSelectors) {
  return {
    status: "dry_run",
    liveProviderUse: false,
    providerSelectors,
    authMode: "explicit-provider-config",
    toolFlow: TOOL_FLOW,
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement: "fixture policy.liveSmokeEnabled and writeMode must be true",
    plannedProofs: providerSelectors.map((providerSelector) => ({
      role: "slice-implementer",
      providerSelector,
      expectedFile: PROOF_FILE
    })),
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(`Missing ${runtimePath}. Run npm run build before Ollama write validation.`);
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

async function createWriteValidationFixture(providerSelector) {
  const root = await mkdtemp(join(tmpdir(), "agent-team-ollama-write-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "agent-team@example.invalid"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.name", "Agent Team Write Smoke"], {
    cwd: root
  });
  await writeFile(join(root, "README.md"), "ollama write validation fixture\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
  const gitRoot = (
    await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: root })
  ).stdout.trim();

  const id = profileId(providerSelector);
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
          ollamaClaudeCode: {
            enabled: true,
            launchMode: "ollama-launch",
            baseUrl: "http://localhost:11434",
            authToken: "ollama",
            executable: "ollama",
            apiKeyEnv: "OLLAMA_API_KEY",
            profiles: [
              {
                id,
                model: defaultModelForProfile(id),
                displayName: `Ollama ${id}`,
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
        },
        policy: {
          allowedRoles: ["slice-implementer"],
          allowedProviderSelectors: [providerSelector],
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

function providerHasWriteCapabilities(providerList, providerSelector) {
  const providers = Array.isArray(providerList.providers) ? providerList.providers : [];
  const provider = providers.find((item) => item?.id === providerSelector);
  const capabilities = Array.isArray(provider?.capabilities) ? provider.capabilities : [];
  return capabilities.includes("edits") && capabilities.includes("workspaceIsolation");
}

async function waitForTerminalStatus(client, workspaceRoot, runId, timeoutMs) {
  const maxWaitMs = readPositiveNumber("--max-wait-ms", timeoutMs + 15_000);
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
  const expectedLine = "ollama isolated write proof";
  let content;
  let sourceFileExists = false;
  if (typeof executionCwd === "string") {
    try {
      content = (await readFile(join(executionCwd, PROOF_FILE), "utf8")).trim();
    } catch {
      content = undefined;
    }
  }
  if (typeof sourceCwd === "string") {
    try {
      await access(join(sourceCwd, PROOF_FILE));
      sourceFileExists = true;
    } catch {
      sourceFileExists = false;
    }
  }
  return {
    expectedFile: PROOF_FILE,
    expectedLine,
    contentMatches: content === expectedLine,
    sourceUnmodified: sourceFileExists === false
  };
}

function runSucceeded(statusResult, fileState) {
  const run = statusResult?.run ?? {};
  const changedFiles = Array.isArray(run.changedFiles) ? run.changedFiles : [];
  return run.status === "completed" &&
    run.workspaceIsolation === "git-worktree" &&
    run.workspaceCleanup === "retained" &&
    changedFiles.includes(PROOF_FILE) &&
    fileState.contentMatches === true &&
    fileState.sourceUnmodified === true;
}

async function validateProvider(client, providerSelector, timeoutMs) {
  const fixture = await createWriteValidationFixture(providerSelector);
  const doctor = await callTool(client, "agent_team_doctor", { cwd: fixture.root }, 30000);
  if (doctor.ok !== true || !policyLiveSmokeEnabled(doctor)) {
    throw new Error(`Doctor did not pass for ${providerSelector} write validation fixture.`);
  }
  const providerList = await callTool(client, "agent_team_list_providers", { cwd: fixture.root }, 30000);
  if (!providerHasWriteCapabilities(providerList, providerSelector)) {
    throw new Error(`${providerSelector} did not expose edits and workspaceIsolation in the fixture.`);
  }

  const start = await callTool(
    client,
    "agent_team_start",
    {
      cwd: fixture.root,
      provider: providerSelector,
      role: "slice-implementer",
      task: `Ollama write validation proof. In the execution workspace only, create ${PROOF_FILE} with exactly one line: ollama isolated write proof. Do not modify any other files. Do not edit the source workspace. Return verdict SHIP with changed file evidence.`,
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
    name: "agent-team-ollama-write-validation",
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
      authMode: "explicit-provider-config",
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
      "Refusing live provider use. Pass --dry-run for a plan or --confirm-live-provider-use to run Ollama write validation."
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
