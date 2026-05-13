#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  access,
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
  isTerminalRunStatus
} from "./live-smoke-claude-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");
const PROVIDER_ID = "codex-cli";
const DEFAULT_MODEL = "gpt-5.5";
const IMPLEMENTATION_FILE = "src/math.js";
const TEST_FILE = "tests/math.test.js";
const PROOF_FILE = "TEST_RUN_PROOF.txt";
const PROOF_TEXT = "codex isolated npm test proof";

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
  "This smoke proves isolated write containment and in-worktree npm test execution for the explicitly configured Codex CLI provider only.",
  "Live provider use is operator-triggered and is not part of CI.",
  "The proof fixture is disposable; successful runs still require Codex review before any production write-validation policy is broadened.",
  "This smoke does not prove model quality, provider ranking, or broad autonomous implementation readiness."
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
    if (provider !== PROVIDER_ID) {
      throw new Error("Codex write validation requires --provider codex-cli.");
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
    authMode: "subscription-oauth",
    toolFlow: TOOL_FLOW,
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement:
      "fixture policy.liveSmokeEnabled, writeMode, writeValidated, and isolated worktree roots must be enabled",
    plannedProofs: providerSelectors.map((providerSelector) => ({
      role: "slice-implementer",
      providerSelector,
      expectedFiles: [IMPLEMENTATION_FILE, TEST_FILE, PROOF_FILE],
      verificationCommand: "npm test"
    })),
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(`Missing ${runtimePath}. Run npm run build before Codex write validation.`);
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
  const root = await mkdtemp(join(tmpdir(), "agent-team-codex-write-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "agent-team@example.invalid"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.name", "Agent Team Codex Write Smoke"], {
    cwd: root
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          test: `node --test ${TEST_FILE}`
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(root, IMPLEMENTATION_FILE),
    [
      "export function add(left, right) {",
      "  return left + right;",
      "}",
      "",
      "export function multiply() {",
      "  throw new Error(\"not implemented\");",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
  await execFileAsync("git", ["add", "package.json", IMPLEMENTATION_FILE], { cwd: root });
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
          codexCli: {
            enabled: true,
            executable: "codex",
            model: readValue("--model", DEFAULT_MODEL),
            displayName: "Codex CLI Write Worker",
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
            "slice-implementer": PROVIDER_ID
          },
          providerOrder: [PROVIDER_ID]
        },
        policy: {
          allowedRoles: ["slice-implementer"],
          allowedProviderSelectors: [PROVIDER_ID],
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

async function fileContains(path, text) {
  try {
    return (await readFile(path, "utf8")).includes(text);
  } catch {
    return false;
  }
}

async function gitStatusPorcelain(cwd) {
  const result = await execFileAsync(
    "git",
    ["status", "--porcelain", "--", "package.json", "src", "tests", PROOF_FILE],
    { cwd }
  );
  return result.stdout.trim();
}

async function runNpmTest(cwd) {
  try {
    const result = await execFileAsync("npm", ["test"], {
      cwd,
      timeout: readPositiveNumber("--test-timeout-ms", 60000)
    });
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const commandError = error;
    return {
      ok: false,
      stdout: String(commandError.stdout ?? ""),
      stderr: String(commandError.stderr ?? commandError.message ?? "")
    };
  }
}

async function proofState(statusResult) {
  const run = statusResult?.run ?? {};
  const executionCwd = run.executionCwd;
  const sourceCwd = run.sourceCwd;
  const executionRoot =
    typeof executionCwd === "string" ? executionCwd : undefined;
  const sourceRoot = typeof sourceCwd === "string" ? sourceCwd : undefined;
  const testResult = executionRoot === undefined ? { ok: false } : await runNpmTest(executionRoot);
  const logText =
    typeof run.logPath === "string"
      ? await readFile(run.logPath, "utf8").catch(() => "")
      : "";

  return {
    implementationFile: IMPLEMENTATION_FILE,
    testFile: TEST_FILE,
    proofFile: PROOF_FILE,
    executionHasImplementation:
      executionRoot !== undefined &&
      (await fileContains(join(executionRoot, IMPLEMENTATION_FILE), "return left * right")),
    executionHasTest:
      executionRoot !== undefined &&
      (await fileContains(join(executionRoot, TEST_FILE), "multiply(6, 7)")),
    executionHasProof:
      executionRoot !== undefined &&
      (await fileContains(join(executionRoot, PROOF_FILE), PROOF_TEXT)),
    sourceUnmodified:
      sourceRoot !== undefined &&
      (await gitStatusPorcelain(sourceRoot)) === "" &&
      !(await fileContains(join(sourceRoot, IMPLEMENTATION_FILE), "return left * right")) &&
      !(await fileContains(join(sourceRoot, TEST_FILE), "multiply(6, 7)")) &&
      !(await fileContains(join(sourceRoot, PROOF_FILE), PROOF_TEXT)),
    logMentionsNpmTest: logText.includes("npm test"),
    independentNpmTestPassed: testResult.ok === true
  };
}

function runSucceeded(statusResult, state) {
  const run = statusResult?.run ?? {};
  const changedFiles = Array.isArray(run.changedFiles) ? run.changedFiles : [];
  const changedTests = changedFiles.includes(TEST_FILE) || changedFiles.includes("tests/");
  return (
    run.status === "completed" &&
    run.workspaceIsolation === "git-worktree" &&
    run.workspaceCleanup === "retained" &&
    changedFiles.includes(IMPLEMENTATION_FILE) &&
    changedTests &&
    changedFiles.includes(PROOF_FILE) &&
    state.executionHasImplementation === true &&
    state.executionHasTest === true &&
    state.executionHasProof === true &&
    state.sourceUnmodified === true &&
    state.logMentionsNpmTest === true &&
    state.independentNpmTestPassed === true
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
    throw new Error("codex-cli did not expose all required autonomous worker capabilities.");
  }

  const start = await callTool(
    client,
    "agent_team_start",
    {
      cwd: fixture.root,
      provider: providerSelector,
      role: "slice-implementer",
      task: [
        "Codex CLI isolated write validation proof.",
        `In the execution workspace only, implement multiply in ${IMPLEMENTATION_FILE}.`,
        `Add ${TEST_FILE} using node:test and assert multiply(6, 7) is 42.`,
        "Run npm test from the execution workspace.",
        `Only after npm test passes, create ${PROOF_FILE} containing exactly: ${PROOF_TEXT}`,
        "Do not modify any other files.",
        "Do not edit the source workspace.",
        "Return verdict SHIP with changed file evidence and mention npm test."
      ].join(" "),
      timeoutMs
    },
    timeoutMs
  );
  const status = await waitForTerminalStatus(client, fixture.root, start.runId, timeoutMs);
  const state = await proofState(status);
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
  await rm(fixture.root, { recursive: true, force: true });

  const run = status?.run ?? {};
  const cleanupOk = cleanup.status === "removed";
  const statusOk = runSucceeded(status, state);
  return {
    providerSelector,
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
    proofState: state,
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
  const timeoutMs = readPositiveNumber("--timeout-ms", 300000);

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
    name: "agent-team-codex-write-validation",
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
      authMode: "subscription-oauth",
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
      "Refusing live provider use. Pass --dry-run for a plan or --confirm-live-provider-use to run Codex write validation."
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
