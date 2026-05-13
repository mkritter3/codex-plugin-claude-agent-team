#!/usr/bin/env node

import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildToolRequestOptions } from "./live-smoke-claude-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const runtimePath = join(repoRoot, "dist", "index.js");

const PROFILE_SPECS = [
  {
    id: "opus",
    providerSelector: "claude-code-cli:opus",
    model: "opus",
    displayName: "Claude Opus",
    capabilities: { structuredOutput: true, longContext: true, reasoning: true }
  },
  {
    id: "sonnet",
    providerSelector: "claude-code-cli:sonnet",
    model: "sonnet",
    displayName: "Claude Sonnet",
    capabilities: { structuredOutput: true, longContext: true, reasoning: true }
  },
  {
    id: "haiku",
    providerSelector: "claude-code-cli:haiku",
    model: "haiku",
    displayName: "Claude Haiku",
    capabilities: { structuredOutput: true }
  }
];

const TOOL_FLOW = [
  "agent_team_doctor",
  "agent_team_list_providers",
  "agent_team_dispatch",
  "agent_team_dashboard",
  "agent_team_summary"
];

const KNOWN_LIMITATIONS = [
  "This smoke proves explicit Claude Code CLI alias routing through the packaged MCP boundary only.",
  "Claude Code resolves opus, sonnet, and haiku aliases; this script does not pin dated model ids.",
  "Live provider use is operator-triggered and is not part of CI.",
  "Only synchronous read-only dispatch is exercised; background sessions, writes, resume, wind-down, cancellation, and cleanup are not exercised."
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

function subscriptionOauthEnv(sourceEnv) {
  const env = { ...sourceEnv };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

function dryRunReport() {
  return {
    status: "dry_run",
    liveProviderUse: false,
    providerSelectors: PROFILE_SPECS.map((profile) => profile.providerSelector),
    authMode: "subscription-oauth",
    toolFlow: TOOL_FLOW,
    requiredConfirmation: "--confirm-live-provider-use",
    policyRequirement: "fixture policy.liveSmokeEnabled must be true",
    plannedRuns: PROFILE_SPECS.map((profile) => ({
      role: "code-reviewer",
      providerSelector: profile.providerSelector,
      model: profile.model,
      correlationId: `claude-model-profile-${profile.id}`
    })),
    knownLimitations: KNOWN_LIMITATIONS
  };
}

async function assertRuntimeExists() {
  try {
    await access(runtimePath);
  } catch {
    throw new Error(`Missing ${runtimePath}. Run npm run build before Claude model profile smoke.`);
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

async function createProfileFixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-team-claude-models-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "agent-team@example.invalid"], {
    cwd: root
  });
  await execFileAsync("git", ["config", "user.name", "Agent Team Claude Model Smoke"], {
    cwd: root
  });
  await writeFile(join(root, "README.md"), "claude model profile proof fixture\n", "utf8");
  await execFileAsync("git", ["add", "README.md"], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: root });
  await mkdir(join(root, ".agent-team"), { recursive: true });
  await writeFile(
    join(root, ".agent-team", "config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        auth: { allowApiKeyFallback: false },
        providers: {
          claudeCodeCli: {
            profiles: PROFILE_SPECS.map((profile) => ({
              id: profile.id,
              model: profile.model,
              displayName: profile.displayName,
              writeValidated: false,
              capabilities: {
                structuredOutput: profile.capabilities.structuredOutput,
                longContext: profile.capabilities.longContext === true,
                reasoning: profile.capabilities.reasoning === true,
                tools: true,
                sessionResume: true,
                cancellation: true
              }
            }))
          }
        },
        policy: {
          allowedRoles: ["code-reviewer"],
          allowedProviderSelectors: PROFILE_SPECS.map((profile) => profile.providerSelector),
          allowWriteMode: false,
          allowedWorktreeRoots: [],
          liveSmokeEnabled: true,
          auditEnabled: true
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return root;
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

function runRefs(proofs, workspaceRoot) {
  return proofs
    .filter((proof) => proof?.status === "completed" && typeof proof.runId === "string")
    .map((proof) => ({
      runId: proof.runId,
      cwd: workspaceRoot,
      correlationId: `claude-model-profile-${proof.model}`
    }));
}

function compactRunResult(input) {
  const provider = input.providerMap.get(input.result.provider);
  return {
    index: input.index,
    status: input.result.status === "completed" ? "completed" : "failed",
    providerSelector: input.profile.providerSelector,
    selectedProviderId: input.result.provider,
    model: provider?.model,
    authMode: provider?.authMode,
    runId: input.result.runId,
    runStatus: input.result.status,
    verdict: input.result.verdict?.verdict ?? input.result.verdict?.status,
    sidecarPath: input.result.sidecarPath,
    logPath: input.result.logPath
  };
}

function failedRunResult(index, profile) {
  return {
    index,
    status: "failed",
    providerSelector: profile.providerSelector,
    model: profile.model,
    error: "Claude model profile proof dispatch failed; inspect MCP server logs and provider evidence."
  };
}

function compactEvidenceReport(input) {
  const refs = runRefs(input.proofs, input.workspaceRoot);
  return {
    status: refs.length === PROFILE_SPECS.length ? "completed" : "failed",
    liveProviderUse: true,
    workspaceRoot: input.workspaceRoot,
    providerSelectors: PROFILE_SPECS.map((profile) => profile.providerSelector),
    authMode: "subscription-oauth",
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

async function runLiveSmoke() {
  await assertRuntimeExists();
  const timeoutMs = readPositiveNumber("--timeout-ms", 180000);
  const workspaceRoot = await createProfileFixture();

  const transport = new StdioClientTransport({
    command: "node",
    args: [runtimePath],
    cwd: repoRoot,
    env: subscriptionOauthEnv(process.env),
    stderr: "pipe"
  });
  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => {
    stderrChunks.push(Buffer.from(chunk).toString("utf8"));
  });

  const client = new Client({
    name: "agent-team-claude-model-profile-smoke",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const doctor = await callTool(client, "agent_team_doctor", { cwd: workspaceRoot }, 30000);
    if (doctor.ok !== true) {
      throw new Error("agent_team_doctor did not pass for the Claude model profile fixture.");
    }
    if (!policyLiveSmokeEnabled(doctor)) {
      throw new Error("Fixture policy.liveSmokeEnabled must be true before profile proof smoke can run.");
    }

    const providers = providerById(
      await callTool(client, "agent_team_list_providers", { cwd: workspaceRoot }, 30000)
    );
    const proofs = [];
    for (const [index, profile] of PROFILE_SPECS.entries()) {
      try {
        const result = await callTool(
          client,
          "agent_team_dispatch",
          {
            cwd: workspaceRoot,
            provider: profile.providerSelector,
            role: "code-reviewer",
            task: "Live Claude model profile route proof only. Do not inspect files. Return a concise SHIP/BLOCK/NEEDS_INPUT verdict stating whether the selected profile route responded successfully.",
            timeoutMs
          },
          timeoutMs
        );
        proofs.push(compactRunResult({ index, profile, result, providerMap: providers }));
      } catch {
        proofs.push(failedRunResult(index, profile));
      }
    }

    const refs = runRefs(proofs, workspaceRoot);
    const dashboard =
      refs.length === 0
        ? undefined
        : await callTool(client, "agent_team_dashboard", { cwd: workspaceRoot, runs: refs }, timeoutMs);
    const summary =
      refs.length === 0
        ? undefined
        : await callTool(client, "agent_team_summary", { cwd: workspaceRoot, runs: refs }, timeoutMs);

    return compactEvidenceReport({ workspaceRoot, proofs, dashboard, summary });
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
    throw new Error(
      "Refusing live Claude model profile use without --confirm-live-provider-use. Use --dry-run to inspect the plan."
    );
  }
  const report = await runLiveSmoke();
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
