import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inspectClaudeEnvironment } from "../providers/claude-code-cli/doctor.js";
import {
  runClaudePrint,
  type ClaudeProcessResult
} from "../providers/claude-code-cli/runner.js";
import { listProviders } from "../providers/index.js";
import { selectProvider } from "./router.js";
import { getRole } from "./roles.js";
import { buildRolePrompt } from "./prompts.js";
import { createRunId as defaultCreateRunId, hashPrompt } from "./run-ids.js";
import { appendMailboxRecord } from "./state/mailbox-store.js";
import { runLogPath, runSidecarPath } from "./state/paths.js";
import { writeRunSidecar } from "./state/run-store.js";
import { parseVerdict } from "./verdict.js";
import type {
  AgentDispatchRequest,
  AgentDispatchResult,
  AgentProviderDescriptor,
  ParsedVerdict,
  RunSidecar,
  RunStatus
} from "./types.js";

export interface DispatchDependencies {
  readonly providers?: readonly AgentProviderDescriptor[];
  readonly runClaude?: typeof runClaudePrint;
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly env?: NodeJS.ProcessEnv;
}

function blockedVerdict(summary: string, evidence: readonly string[] = []): ParsedVerdict {
  return {
    status: "BLOCKED",
    summary,
    requiredChanges: [],
    evidence,
    risks: [],
    warnings: [],
    raw: summary
  };
}

async function writeRawLog(
  workspaceRoot: string,
  runId: string,
  result: Pick<ClaudeProcessResult, "text" | "stdout" | "stderr">
): Promise<string> {
  const path = runLogPath(workspaceRoot, runId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    [
      `TEXT:\n${result.text}`,
      `STDOUT:\n${result.stdout}`,
      `STDERR:\n${result.stderr}`
    ].join("\n\n"),
    "utf8"
  );
  return path;
}

async function appendEvent(input: {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly role: AgentDispatchRequest["role"];
  readonly provider: string;
  readonly messageType: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}): Promise<void> {
  await appendMailboxRecord(input.workspaceRoot, input.runId, "events", {
    role: input.role,
    provider: input.provider,
    messageType: input.messageType,
    correlationId: input.runId,
    createdAt: input.createdAt,
    payload: input.payload
  });
}

async function persist(input: {
  readonly request: AgentDispatchRequest;
  readonly runId: string;
  readonly provider: AgentProviderDescriptor;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly promptHash?: string;
  readonly logPath?: string;
  readonly verdict?: ParsedVerdict;
  readonly outputSummary?: string;
  readonly providerSessionId?: string;
}): Promise<RunSidecar> {
  const sidecar: RunSidecar = {
    runId: input.runId,
    role: input.request.role,
    provider: input.provider.id,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    capabilitiesUsed: input.provider.capabilities,
    evidencePaths: input.logPath === undefined ? [] : [input.logPath],
    authMode: input.provider.authMode,
    ...(input.promptHash === undefined ? {} : { promptHash: input.promptHash }),
    ...(input.outputSummary === undefined ? {} : { outputSummary: input.outputSummary }),
    ...(input.providerSessionId === undefined
      ? {}
      : { providerSessionId: input.providerSessionId }),
    ...(input.verdict === undefined ? {} : { verdict: input.verdict })
  };
  await writeRunSidecar(input.request.cwd, sidecar);
  return sidecar;
}

export async function dispatchReadOnlyAgent(
  request: AgentDispatchRequest,
  deps: DispatchDependencies = {}
): Promise<AgentDispatchResult> {
  const runId = deps.createRunId?.() ?? defaultCreateRunId();
  const now = deps.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const role = getRole(request.role);
  const providers = deps.providers ?? listProviders();
  const provider = role.defaultReadOnly
    ? selectProvider({
        roleId: request.role,
        providers,
        ...(request.provider === undefined ? {} : { requestedProviderId: request.provider })
      })
    : providers[0] ?? listProviders()[0]!;

  const finish = async (input: {
    readonly status: RunStatus;
    readonly verdict: ParsedVerdict;
    readonly logPath?: string;
    readonly promptHash?: string;
    readonly outputSummary?: string;
    readonly providerSessionId?: string;
  }): Promise<AgentDispatchResult> => {
    const updatedAt = now().toISOString();
    const persistInput = {
      request,
      runId,
      provider,
      status: input.status,
      createdAt,
      updatedAt,
      verdict: input.verdict,
      ...(input.logPath === undefined ? {} : { logPath: input.logPath }),
      ...(input.promptHash === undefined ? {} : { promptHash: input.promptHash }),
      ...(input.outputSummary === undefined
        ? {}
        : { outputSummary: input.outputSummary }),
      ...(input.providerSessionId === undefined
        ? {}
        : { providerSessionId: input.providerSessionId })
    };
    await persist(persistInput);
    return {
      runId,
      status: input.status,
      provider: provider.id,
      role: request.role,
      verdict: input.verdict,
      sidecarPath: runSidecarPath(request.cwd, runId),
      logPath: input.logPath ?? runLogPath(request.cwd, runId)
    };
  };

  if (!role.defaultReadOnly) {
    const verdict = blockedVerdict(
      `Role ${role.id} is not supported by read-only dispatch in this milestone.`
    );
    await appendEvent({
      workspaceRoot: request.cwd,
      runId,
      role: request.role,
      provider: provider.id,
      messageType: "failed",
      createdAt,
      payload: { reason: "unsupported_role" }
    });
    return finish({ status: "failed", verdict, outputSummary: verdict.summary });
  }

  const envInspection = inspectClaudeEnvironment({
    authMode: provider.authMode,
    env: deps.env ?? process.env
  });
  if (envInspection.warnings.length > 0) {
    const verdict = blockedVerdict(envInspection.warnings.join(" "));
    await appendEvent({
      workspaceRoot: request.cwd,
      runId,
      role: request.role,
      provider: provider.id,
      messageType: "failed",
      createdAt,
      payload: { reason: "auth_precedence", warnings: envInspection.warnings }
    });
    return finish({ status: "failed", verdict, outputSummary: verdict.summary });
  }

  const prompt = buildRolePrompt({ role, task: request.task, cwd: request.cwd });
  const promptDigest = hashPrompt(prompt);
  await persist({
    request,
    runId,
    provider,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    promptHash: promptDigest
  });
  await appendEvent({
    workspaceRoot: request.cwd,
    runId,
    role: request.role,
    provider: provider.id,
    messageType: "queued",
    createdAt,
    payload: { task: request.task }
  });
  await persist({
    request,
    runId,
    provider,
    status: "running",
    createdAt,
    updatedAt: now().toISOString(),
    promptHash: promptDigest
  });
  await appendEvent({
    workspaceRoot: request.cwd,
    runId,
    role: request.role,
    provider: provider.id,
    messageType: "running",
    createdAt: now().toISOString(),
    payload: { provider: provider.id }
  });

  const runClaude = deps.runClaude ?? runClaudePrint;
  const providerResult = await runClaude({
    prompt,
    cwd: request.cwd,
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(deps.env === undefined ? {} : { env: deps.env })
  });
  const logPath = await writeRawLog(request.cwd, runId, providerResult);

  if (!providerResult.ok) {
    const verdict = blockedVerdict("Claude Code CLI run failed.", [
      `exitCode: ${providerResult.exitCode}`,
      providerResult.stderr
    ]);
    await appendEvent({
      workspaceRoot: request.cwd,
      runId,
      role: request.role,
      provider: provider.id,
      messageType: "failed",
      createdAt: now().toISOString(),
      payload: { exitCode: providerResult.exitCode }
    });
    return finish({
      status: "failed",
      verdict,
      logPath,
      promptHash: promptDigest,
      outputSummary: verdict.summary
    });
  }

  const verdict = parseVerdict(providerResult.text);
  await appendEvent({
    workspaceRoot: request.cwd,
    runId,
    role: request.role,
    provider: provider.id,
    messageType: "completed",
    createdAt: now().toISOString(),
    payload: { verdict: verdict.status }
  });
  return finish({
    status: "completed",
    verdict,
    logPath,
    promptHash: promptDigest,
    outputSummary: verdict.summary,
    ...(providerResult.sessionId === undefined
      ? {}
      : { providerSessionId: providerResult.sessionId })
  });
}
