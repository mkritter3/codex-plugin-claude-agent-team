import {
  listProviders,
  requireProviderRuntime,
  type AgentProviderRuntime
} from "../providers/index.js";
import {
  DEFAULT_AGENT_TEAM_CONFIG,
  loadAgentTeamConfig
} from "./config.js";
import { selectProvider } from "./router.js";
import { getRole } from "./roles.js";
import { buildRolePrompt } from "./prompts.js";
import { evaluateStartPolicy } from "./policy.js";
import { createRunId as defaultCreateRunId, hashPrompt } from "./run-ids.js";
import { runLogPath, runSidecarPath } from "./state/paths.js";
import { appendAuditRecord } from "./state/audit-store.js";
import {
  readProviderHealthRecords,
  upsertProviderHealthRecord
} from "./state/provider-health-store.js";
import { writeRunSidecar } from "./state/run-store.js";
import {
  appendRunEvent,
  blockedVerdict,
  buildRunSidecar,
  finalizeRunSidecar,
  writeProviderPrintLog
} from "./run-pipeline.js";
import { parseVerdict } from "./verdict.js";
import {
  classifyProviderFailure,
  recordProviderFailure
} from "./provider-health.js";
import type {
  AgentDispatchRequest,
  AgentDispatchResult,
  AgentProviderDescriptor,
  AgentTeamConfig,
  ParsedVerdict,
  RunStatus
} from "./types.js";

export interface DispatchDependencies {
  readonly providers?: readonly AgentProviderDescriptor[];
  readonly runtimes?: readonly AgentProviderRuntime[];
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  readonly config?: AgentTeamConfig;
  readonly loadConfig?: typeof loadAgentTeamConfig;
  readonly appendAudit?: typeof appendAuditRecord;
}

async function writeDispatchSidecar(input: {
  readonly request: AgentDispatchRequest;
  readonly runId: string;
  readonly provider: AgentProviderDescriptor;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly promptHash?: string;
  readonly logPath?: string;
}): Promise<void> {
  await writeRunSidecar(input.request.cwd, buildRunSidecar({
    runId: input.runId,
    role: input.request.role,
    provider: input.provider,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    evidencePaths: input.logPath === undefined ? [] : [input.logPath],
    ...(input.promptHash === undefined ? {} : { promptHash: input.promptHash }),
    ...(input.logPath === undefined ? {} : { logPath: input.logPath })
  }));
}

export async function dispatchReadOnlyAgent(
  request: AgentDispatchRequest,
  deps: DispatchDependencies = {}
): Promise<AgentDispatchResult> {
  const runId = deps.createRunId?.() ?? defaultCreateRunId();
  const now = deps.now ?? (() => new Date());
  const createdAt = now().toISOString();
  const role = getRole(request.role);
  const config =
    deps.config ??
    (deps.providers === undefined
      ? await (deps.loadConfig ?? loadAgentTeamConfig)(request.cwd)
      : DEFAULT_AGENT_TEAM_CONFIG);
  const providerEnv = deps.env ?? process.env;
  const providers = deps.providers ?? listProviders({ config, env: providerEnv });
  const providerHealth = await readProviderHealthRecords(request.cwd);
  const provider = role.defaultReadOnly
    ? selectProvider({
        roleId: request.role,
        providers,
        routingPolicy: config.routing,
        providerHealth,
        now: now(),
        ...(request.provider === undefined ? {} : { requestedProviderId: request.provider })
      })
    : providers[0] ?? listProviders({ env: providerEnv })[0]!;
  const appendAudit = deps.appendAudit ?? appendAuditRecord;

  const policyDecision = evaluateStartPolicy({
    config,
    roleId: request.role,
    provider,
    executionPolicy: role.executionPolicy,
    ...(request.provider === undefined ? {} : { requestedProvider: request.provider })
  });
  if (config.policy.auditEnabled) {
    await appendAudit(request.cwd, {
      eventType:
        policyDecision.status === "allowed" ? "policy_allowed" : "policy_blocked",
      operation: "dispatch",
      role: request.role,
      provider: provider.id,
      runId,
      decision: policyDecision.status,
      reason: policyDecision.reason,
      details: policyDecision.details,
      createdAt
    });
  }

  const finish = async (input: {
    readonly status: RunStatus;
    readonly verdict: ParsedVerdict;
    readonly logPath?: string;
    readonly outputSummary?: string;
    readonly providerSessionId?: string;
    readonly failureEvidence?: import("../providers/types.js").ProviderFailureEvidence;
    readonly cleanup?: "complete" | "partial" | "not-needed";
    readonly eventPayload: Record<string, unknown>;
    readonly eventCreatedAt?: string;
  }): Promise<AgentDispatchResult> => {
    const terminal = await finalizeRunSidecar({
      workspaceRoot: request.cwd,
      runId,
      provider: provider.id,
      status: input.status === "completed" ? "completed" : "failed",
      updatedAt: now().toISOString(),
      verdict: input.verdict,
      cleanup: input.cleanup ?? (input.status === "completed" ? "complete" : "partial"),
      outputSummary: input.outputSummary ?? input.verdict.summary,
      ...(input.logPath === undefined ? {} : { logPath: input.logPath }),
      ...(input.providerSessionId === undefined
        ? {}
        : { providerSessionId: input.providerSessionId }),
      ...(input.failureEvidence === undefined ? {} : { failureEvidence: input.failureEvidence }),
      eventPayload: input.eventPayload,
      ...(input.eventCreatedAt === undefined ? {} : { eventCreatedAt: input.eventCreatedAt })
    });
    return {
      runId,
      status: terminal.status,
      provider: provider.id,
      role: request.role,
      verdict: terminal.verdict ?? input.verdict,
      sidecarPath: runSidecarPath(request.cwd, runId),
      logPath: input.logPath ?? runLogPath(request.cwd, runId)
    };
  };

  if (!role.defaultReadOnly) {
    const verdict = blockedVerdict(
      `Role ${role.id} is not supported by read-only dispatch in this milestone.`
    );
    await writeDispatchSidecar({
      request,
      runId,
      provider,
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    return finish({
      status: "failed",
      verdict,
      outputSummary: verdict.summary,
      eventCreatedAt: createdAt,
      eventPayload: { reason: "unsupported_role" }
    });
  }

  if (policyDecision.status === "blocked") {
    const verdict = blockedVerdict(
      `Agent team policy blocked operation: ${policyDecision.reason}`
    );
    await writeDispatchSidecar({
      request,
      runId,
      provider,
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    return finish({
      status: "failed",
      verdict,
      outputSummary: verdict.summary,
      eventCreatedAt: createdAt,
      eventPayload: {
        reason: "policy_blocked",
        policyReason: policyDecision.reason,
        details: policyDecision.details
      }
    });
  }

  const runtime = requireProviderRuntime(
    provider.id,
    deps.runtimes === undefined ? {} : { runtimes: deps.runtimes }
  );

  const envInspection = runtime.inspectEnvironment({
    providerId: provider.id,
    authMode: provider.authMode,
    env: providerEnv,
    config
  });
  if (envInspection.warnings.length > 0) {
    const verdict = blockedVerdict(envInspection.warnings.join(" "));
    await writeDispatchSidecar({
      request,
      runId,
      provider,
      status: "queued",
      createdAt,
      updatedAt: createdAt
    });
    return finish({
      status: "failed",
      verdict,
      outputSummary: verdict.summary,
      eventCreatedAt: createdAt,
      eventPayload: { reason: "auth_precedence", warnings: envInspection.warnings }
    });
  }

  const prompt = buildRolePrompt({ role, task: request.task, cwd: request.cwd });
  const promptDigest = hashPrompt(prompt);
  await writeDispatchSidecar({
    request,
    runId,
    provider,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    promptHash: promptDigest
  });
  await appendRunEvent({
    workspaceRoot: request.cwd,
    runId,
    role: request.role,
    provider: provider.id,
    messageType: "queued",
    createdAt,
    payload: { task: request.task }
  });
  await writeDispatchSidecar({
    request,
    runId,
    provider,
    status: "running",
    createdAt,
    updatedAt: now().toISOString(),
    promptHash: promptDigest
  });
  await appendRunEvent({
    workspaceRoot: request.cwd,
    runId,
    role: request.role,
    provider: provider.id,
    messageType: "running",
    createdAt: now().toISOString(),
    payload: { provider: provider.id }
  });

  const providerResult = await runtime.runPrint({
    prompt,
    providerId: provider.id,
    cwd: request.cwd,
    roleId: request.role,
    executionPolicy: role.executionPolicy,
    config,
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    env: providerEnv
  });
  const logPath = await writeProviderPrintLog(request.cwd, runId, providerResult);

  if (!providerResult.ok) {
    const classification = classifyProviderFailure(providerResult);
    const verdict = blockedVerdict("Provider runtime run failed.", [
      `exitCode: ${providerResult.exitCode}`,
      providerResult.stderr
    ]);
    if (classification.transient) {
      await upsertProviderHealthRecord(
        request.cwd,
        recordProviderFailure({
          providerId: provider.id,
          failure: providerResult,
          now: now(),
          ...(providerHealth.find((record) => record.providerId === provider.id) === undefined
            ? {}
            : {
                previous: providerHealth.find(
                  (record) => record.providerId === provider.id
                )!
              }),
          evidencePath: logPath
        })
      );
    }
    return finish({
      status: "failed",
      verdict,
      logPath,
      outputSummary: verdict.summary,
      eventPayload: {
        exitCode: providerResult.exitCode,
        ...(providerResult.failureEvidence === undefined
          ? {}
          : { failureEvidence: providerResult.failureEvidence })
      },
      ...(providerResult.sessionId === undefined ? {} : { providerSessionId: providerResult.sessionId }),
      ...(providerResult.failureEvidence === undefined ? {} : { failureEvidence: providerResult.failureEvidence })
    });
  }

  const verdict = parseVerdict(providerResult.text);
  return finish({
    status: "completed",
    verdict,
    logPath,
    outputSummary: verdict.summary,
    eventPayload: { verdict: verdict.status },
    ...(providerResult.sessionId === undefined
      ? {}
      : { providerSessionId: providerResult.sessionId })
  });
}
