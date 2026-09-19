import { mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  listProviders,
  requireProviderRuntime,
  type AgentProviderRuntime
} from "../providers/index.js";
import type {
  ProviderOutboxRequest,
  ProviderSessionDoneStatus,
  ProviderSessionHandle,
  ProviderSessionPermissionMode,
  ProviderStartSessionInput,
  ProviderSessionSnapshot
} from "../providers/types.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "./config.js";
import { PolicyViolationError } from "./errors.js";
import {
  buildImplementationPrompt,
  buildImplementationReplyPrompt,
  buildReplyPrompt,
  buildRolePrompt
} from "./prompts.js";
import { evaluateStartPolicy } from "./policy.js";
import { getRole } from "./roles.js";
import { selectProvider } from "./router.js";
import { createRunId as defaultCreateRunId, hashPrompt } from "./run-ids.js";
import {
  blockedVerdict,
  buildRunSidecar,
  finalizeRunSidecar,
  sidecarWithSnapshot
} from "./run-pipeline.js";
import {
  appendControlRecord,
  appendEventRecord,
  appendInboxRecord,
  appendOutboxRecord,
  readMailboxRecords
} from "./state/mailbox-store.js";
import { appendAuditRecord } from "./state/audit-store.js";
import {
  mailboxPath,
  runLogPath,
  runSidecarPath,
  runsDir,
  workspaceDiffPath
} from "./state/paths.js";
import {
  InvalidRunTransitionError,
  isTerminalRunStatus,
  readRunSidecar,
  transitionRunSidecar,
  withRunSidecarLock,
  writeRunSidecar
} from "./state/run-store.js";
import { parseVerdict } from "./verdict.js";
import {
  allocateIsolatedWorktree,
  cleanupIsolatedWorktree,
  fingerprintImplementationWorkspace,
  inspectImplementationWorkspace,
  planIsolatedWorktree,
  verifyRetainedWorktree
} from "./workspaces.js";
import { assertWorktreeUnclaimed, claimWorktree, currentProcessStartIdentity, recordClaimedProviderProcess, releaseWorktreeClaim } from "./worktree-ownership.js";
import { reserveWorkflowContinuation } from "./workflow-continuation.js";
import type {
  AgentCleanupRequest,
  AgentCleanupResult,
  AgentControlResult,
  AgentDispatchRequest,
  AgentMessageRequest,
  AgentMessageResult,
  AgentProviderDescriptor,
  AgentReplyRequest,
  AgentReplyResult,
  AgentStartResult,
  AgentTeamConfig,
  MailboxRecord,
  RunSidecar,
  WorkspaceLease
} from "./types.js";

export type StartProviderSession = (
  input: ProviderStartSessionInput
) => ProviderSessionHandle;

type AllocateWorkspace = typeof allocateIsolatedWorktree;
type CleanupWorkspace = typeof cleanupIsolatedWorktree;
type InspectWorkspace = typeof inspectImplementationWorkspace;
type PlanWorkspace = typeof planIsolatedWorktree;
type AppendAudit = typeof appendAuditRecord;
type RecordProviderProcessWarning = (
  workspaceRoot: string,
  runId: string,
  warning: string
) => Promise<void>;

export interface AgentLifecycleDependencies {
  readonly providers?: readonly AgentProviderDescriptor[];
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly startSession?: StartProviderSession;
  readonly runtimes?: readonly AgentProviderRuntime[];
  readonly config?: AgentTeamConfig;
  readonly allocateWorkspace?: AllocateWorkspace;
  readonly cleanupWorkspace?: CleanupWorkspace;
  readonly inspectWorkspace?: InspectWorkspace;
  readonly planWorkspace?: PlanWorkspace;
  readonly appendAudit?: AppendAudit;
  readonly env?: NodeJS.ProcessEnv;
  readonly cancelGraceMs?: number;
  readonly windDownGraceMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly recordClaimedProviderProcess?: typeof recordClaimedProviderProcess;
  readonly recordProviderProcessWarning?: RecordProviderProcessWarning;
}

interface ActiveRun {
  readonly handle: ProviderSessionHandle;
  readonly role: AgentDispatchRequest["role"];
  readonly provider: AgentProviderDescriptor;
  readonly worktreeClaim?: { readonly sourceCwd: string; readonly executionCwd: string; readonly claimToken: string };
}

function activeKey(workspaceRoot: string, runId: string): string {
  return `${workspaceRoot}\0${runId}`;
}

function mailboxPaths(workspaceRoot: string, runId: string) {
  return {
    inbox: mailboxPath(workspaceRoot, runId, "inbox"),
    outbox: mailboxPath(workspaceRoot, runId, "outbox"),
    control: mailboxPath(workspaceRoot, runId, "control"),
    events: mailboxPath(workspaceRoot, runId, "events")
  };
}

async function lineageRootRunId(workspaceRoot: string, sidecar: RunSidecar): Promise<string> {
  let current = sidecar;
  const seen = new Set<string>();
  while (current.parentRunId !== undefined && !seen.has(current.parentRunId)) {
    seen.add(current.runId);
    current = await readRunSidecar(workspaceRoot, current.parentRunId);
  }
  return current.runId;
}

export class AgentLifecycleManager {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly providers: readonly AgentProviderDescriptor[] | undefined;
  private readonly now: () => Date;
  private readonly createRunId: () => string;
  private readonly startSession: StartProviderSession | undefined;
  private readonly runtimes: readonly AgentProviderRuntime[] | undefined;
  private readonly config: AgentTeamConfig;
  private readonly allocateWorkspace: AllocateWorkspace;
  private readonly cleanupWorkspace: CleanupWorkspace;
  private readonly inspectWorkspace: InspectWorkspace;
  private readonly planWorkspace: PlanWorkspace;
  private readonly appendAudit: AppendAudit;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly cancelGraceMs: number;
  private readonly windDownGraceMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly recordClaimedProviderProcess: typeof recordClaimedProviderProcess;
  private readonly recordProviderProcessWarning: RecordProviderProcessWarning;

  constructor(deps: AgentLifecycleDependencies = {}) {
    this.providers = deps.providers;
    this.now = deps.now ?? (() => new Date());
    this.createRunId = deps.createRunId ?? defaultCreateRunId;
    this.config =
      deps.config === undefined
        ? DEFAULT_AGENT_TEAM_CONFIG
        : {
            ...deps.config,
            policy: deps.config.policy ?? DEFAULT_AGENT_TEAM_CONFIG.policy
          };
    this.allocateWorkspace = deps.allocateWorkspace ?? allocateIsolatedWorktree;
    this.cleanupWorkspace = deps.cleanupWorkspace ?? cleanupIsolatedWorktree;
    this.inspectWorkspace = deps.inspectWorkspace ?? inspectImplementationWorkspace;
    this.planWorkspace = deps.planWorkspace ?? planIsolatedWorktree;
    this.appendAudit = deps.appendAudit ?? appendAuditRecord;
    this.startSession = deps.startSession;
    this.runtimes = deps.runtimes;
    this.env = deps.env;
    this.cancelGraceMs = deps.cancelGraceMs ?? 250;
    this.windDownGraceMs = deps.windDownGraceMs ?? 250;
    this.sleep = deps.sleep ?? delay;
    this.recordClaimedProviderProcess = deps.recordClaimedProviderProcess ?? recordClaimedProviderProcess;
    this.recordProviderProcessWarning = deps.recordProviderProcessWarning ?? (async (workspaceRoot, runId, warning) => {
      await transitionRunSidecar(workspaceRoot, runId, (current) => ({
        ...current,
        warnings: [...(current.warnings ?? []), warning],
        updatedAt: this.now().toISOString()
      }));
    });
  }

  async startRun(request: AgentDispatchRequest): Promise<AgentStartResult> {
    const role = getRole(request.role);
    if (
      !role.defaultReadOnly &&
      (!this.config.writeMode.enabled || !this.config.writeMode.requireIsolatedWorktree)
    ) {
      throw new Error(`Role ${role.id} cannot start because write mode is disabled.`);
    }

    const providers =
      this.providers ??
      listProviders({
        config: this.config,
        ...(this.env === undefined ? {} : { env: this.env })
      });
    const provider = selectProvider({
      roleId: request.role,
      providers,
      routingPolicy: this.config.routing,
      extraCapabilities: ["sessionResume", "cancellation"],
      ...(request.provider === undefined ? {} : { requestedProviderId: request.provider })
    });
    const runId = this.createRunId();
    const createdAt = this.now().toISOString();

    const plannedLease =
      !role.defaultReadOnly &&
      this.config.policy.allowWriteMode &&
      this.config.policy.allowedWorktreeRoots.length > 0
        ? await this.planWorkspace({
            sourceCwd: request.cwd,
            runId
          })
        : undefined;

    const policyDecision = evaluateStartPolicy({
      config: this.config,
      roleId: request.role,
      provider,
      executionPolicy: role.executionPolicy,
      ...(plannedLease === undefined
        ? {}
        : { plannedWorktreeRoot: plannedLease.executionCwd }),
      ...(request.provider === undefined ? {} : { requestedProvider: request.provider })
    });
    if (this.config.policy.auditEnabled) {
      await this.appendAudit(request.cwd, {
        eventType:
          policyDecision.status === "allowed" ? "policy_allowed" : "policy_blocked",
        operation: "start",
        role: request.role,
        provider: provider.id,
        runId,
        decision: policyDecision.status,
        reason: policyDecision.reason,
        details: policyDecision.details,
        createdAt
      });
    }
    if (policyDecision.status === "blocked") {
      throw new PolicyViolationError({
        reason: policyDecision.reason,
        details: policyDecision.details
      });
    }

    const lease = role.defaultReadOnly
      ? undefined
      : await this.allocateWorkspace({
          sourceCwd: request.cwd,
          runId,
          allowedExecutionRoots: this.config.policy.allowedWorktreeRoots
        });
    const executionCwd = lease?.executionCwd ?? request.cwd;
    const prompt = role.defaultReadOnly
      ? buildRolePrompt({ role, task: request.task, cwd: request.cwd })
      : buildImplementationPrompt({
          role,
          task: request.task,
          sourceCwd: request.cwd,
          executionCwd,
          ...(request.writeScope === undefined ? {} : { writeScope: request.writeScope })
        });
    const promptDigest = hashPrompt(prompt);
    const logPath = runLogPath(request.cwd, runId);
    const sidecar = buildRunSidecar({
      runId,
      role: request.role,
      provider,
      status: "running",
      createdAt,
      updatedAt: createdAt,
      evidencePaths: [logPath],
      promptHash: promptDigest,
      logPath,
      ...(lease === undefined ? {} : { workspaceLease: lease }),
      ...(request.workflowId === undefined ? {} : { workspaceFields: {
        ...(request.sliceId === undefined ? {} : { sliceId: request.sliceId }),
        ...(request.writeScope === undefined ? {} : { writeScope: request.writeScope }),
        workflowId: request.workflowId
      } })
    });

    await writeRunSidecar(request.cwd, sidecar);
    await appendEventRecord(request.cwd, runId, {
      role: request.role,
      provider: provider.id,
      messageType: "running",
      correlationId: runId,
      createdAt,
      payload: { task: request.task }
    });

    let worktreeClaim = lease === undefined ? undefined : {
      sourceCwd: lease.sourceCwd,
      executionCwd: lease.executionCwd,
      claimToken: randomUUID()
    };
    if (worktreeClaim !== undefined) {
      let claimAcquired = false;
      try {
        const identity = await claimWorktree({ ...worktreeClaim, lineageRootRunId: runId, activeRunId: runId, host: hostname(), ownerPid: process.pid, ownerProcessStartIdentity: currentProcessStartIdentity(), claimedAt: createdAt });
        worktreeClaim = { ...worktreeClaim, ...identity };
        claimAcquired = true;
        if (this.allocateWorkspace === allocateIsolatedWorktree) {
          await verifyRetainedWorktree({
            lease: lease!,
            expectedSourceCwd: request.cwd,
            allowedExecutionRoots: this.config.policy.allowedWorktreeRoots
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const verdict = blockedVerdict(`Retained worktree claim failed: ${message}`);
        await finalizeRunSidecar({ workspaceRoot: request.cwd, runId, provider: provider.id, status: "failed", updatedAt: this.now().toISOString(), cleanup: "partial", verdict, outputSummary: verdict.summary, eventPayload: { reason: "worktree_claim_failed", message } });
        if (claimAcquired) await releaseWorktreeClaim(worktreeClaim);
        throw error;
      }
    }
    let handle: ProviderSessionHandle;
    try {
      handle = this.startProviderSession(provider, {
        prompt,
        providerId: provider.id,
        cwd: executionCwd,
        workspaceRoot: request.cwd,
        runId,
        roleId: request.role,
        executionPolicy: role.executionPolicy,
        config: this.config,
        ...(role.defaultReadOnly ? {} : { permissionMode: "acceptEdits" }),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        ...(this.env === undefined ? {} : { env: this.env })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const verdict = blockedVerdict(`Provider session failed to start: ${message}`);
      await finalizeRunSidecar({
        workspaceRoot: request.cwd,
        runId,
        provider: provider.id,
        status: "failed",
        updatedAt: this.now().toISOString(),
        cleanup: "partial",
        eventCreatedAt: this.now().toISOString(),
        eventPayload: { reason: "provider_start_failed", message },
        outputSummary: verdict.summary,
        verdict
      });
      if (worktreeClaim !== undefined) await releaseWorktreeClaim(worktreeClaim);
      throw error;
    }
    this.activeRuns.set(activeKey(request.cwd, runId), {
      handle,
      role: request.role,
      provider,
      ...(worktreeClaim === undefined ? {} : { worktreeClaim })
    });
    this.observeCompletion(request.cwd, runId, handle, provider, worktreeClaim);
    if (worktreeClaim !== undefined && handle.providerProcessId !== undefined) {
      try { await this.recordClaimedProviderProcess({ ...worktreeClaim, providerPid: handle.providerProcessId, ...(handle.providerProcessStartIdentity === undefined ? {} : { providerProcessStartIdentity: handle.providerProcessStartIdentity }) }); }
      catch (error) {
        const warning = `Provider process ownership metadata could not be recorded: ${error instanceof Error ? error.message : String(error)}`;
        try { await this.recordProviderProcessWarning(request.cwd, runId, warning); } catch { /* The observer already owns finalization. */ }
      }
    }

    return {
      runId,
      status: "running",
      provider: provider.id,
      role: request.role,
      sidecarPath: runSidecarPath(request.cwd, runId),
      logPath,
      ...(lease === undefined ? {} : { executionCwd: lease.executionCwd }),
      ...(handle.transcriptPath === undefined
        ? {}
        : { transcriptPath: handle.transcriptPath }),
      mailboxPaths: mailboxPaths(request.cwd, runId)
    };
  }

  async getStatus(workspaceRoot: string, runId: string): Promise<RunSidecar> {
    const sidecar = await readRunSidecar(workspaceRoot, runId);
    const active = this.activeRuns.get(activeKey(workspaceRoot, runId));
    if (active !== undefined) {
      const snapshot = active.handle.snapshot();
      const reconciled = await this.reconcileOutboxRequests(
        workspaceRoot,
        sidecar,
        snapshot
      );
      return sidecarWithSnapshot(reconciled, snapshot);
    }

    if (!isTerminalRunStatus(sidecar.status)) {
      return this.reconcileDetachedRun(workspaceRoot, sidecar);
    }

    return sidecar;
  }

  async messageRun(request: AgentMessageRequest): Promise<AgentMessageResult> {
    let sidecar = await readRunSidecar(request.cwd, request.runId);
    if (this.inputClosed(sidecar)) {
      throw new Error(`Run ${request.runId} is not accepting new messages.`);
    }
    const record = await this.appendUserInboxMessage({
      workspaceRoot: request.cwd,
      sidecar,
      message: request.message,
      ...(request.messageType === undefined ? {} : { messageType: request.messageType }),
      ...(request.correlationId === undefined
        ? {}
        : { correlationId: request.correlationId })
    });
    if (sidecar.status === "awaiting-input") {
      sidecar = await this.resumeAwaitingInputRun(request.cwd, sidecar, record);
    }
    const active = this.activeRuns.get(activeKey(request.cwd, request.runId));
    if (
      active?.handle.supportsStdin === true &&
      active.handle.writeStdin?.(
        `${JSON.stringify({
          type: "agent_team_message",
          runId: request.runId,
          record
        })}\n`
      ) === true
    ) {
      await appendEventRecord(request.cwd, request.runId, {
        role: sidecar.role,
        provider: sidecar.provider,
        messageType: "message_delivered_live",
        correlationId: record.correlationId,
        createdAt: this.now().toISOString(),
        payload: {
          inboxSequence: record.sequence,
          messageType: record.messageType
        }
      });

      return {
        runId: request.runId,
        status: "delivered_live",
        record,
        message: "Message delivered live."
      };
    }

    return {
      runId: request.runId,
      status: "recorded_for_resume",
      record,
      message: "Message recorded for resume."
    };
  }

  async replyRun(request: AgentReplyRequest): Promise<AgentReplyResult> {
    const parent = await readRunSidecar(request.cwd, request.runId);
    if (!isTerminalRunStatus(parent.status)) {
      throw new Error(`Run ${request.runId} must be terminal before it can be resumed.`);
    }
    if (parent.provider === "gemini-cli") {
      throw new Error("Legacy Gemini CLI sessions cannot be resumed through AGY. Start a new AGY run.");
    }
    if (parent.providerSessionId === undefined || parent.providerSessionId.length === 0) {
      throw new Error(`Run ${request.runId} has no provider session id to resume.`);
    }

    let resumeMessage = request.message?.trim() ?? "";
    let resumeSequence: number | undefined;
    if (resumeMessage.length === 0) {
      const latest = await this.latestInboxMessage(request.cwd, parent.runId);
      if (latest === undefined) {
        throw new Error(
          `Run ${request.runId} has no recorded inbox message to resume.`
        );
      }
      resumeMessage = latest.message;
      resumeSequence = latest.sequence;
    }

    const role = getRole(parent.role);
    if (parent.workflowId !== undefined || parent.sliceId !== undefined || parent.writeScope !== undefined) {
      if (request.workflowId !== parent.workflowId || request.sliceId !== parent.sliceId) {
        throw new Error("Workflow-owned write continuation requires its matching workflowId and sliceId; start a fresh approved run if context is unavailable.");
      }
    }
    const parentLease = role.defaultReadOnly ? undefined : this.workspaceLeaseFromSidecar(parent);
    if (!role.defaultReadOnly && parentLease === undefined) {
      throw new Error(`Run ${request.runId} has no verified retained worktree metadata; start a fresh isolated run.`);
    }
    if (!role.defaultReadOnly && (!this.config.writeMode.enabled || !this.config.writeMode.requireIsolatedWorktree)) {
      throw new Error(`Role ${role.id} cannot resume because isolated write mode is disabled.`);
    }
    let verifiedLease = parentLease === undefined ? undefined : await verifyRetainedWorktree({
      lease: parentLease,
      expectedSourceCwd: request.cwd,
      allowedExecutionRoots: this.config.policy.allowedWorktreeRoots
    });
    if (verifiedLease !== undefined) {
      await assertWorktreeUnclaimed(verifiedLease.sourceCwd, verifiedLease.executionCwd);
      await this.assertNoLegacyActiveLineage(request.cwd, parent, verifiedLease);
    }

    const provider = selectProvider({
      roleId: parent.role,
      providers:
        this.providers ??
        listProviders({
          config: this.config,
          ...(this.env === undefined ? {} : { env: this.env })
        }),
      requestedProviderId: request.provider ?? parent.provider,
      extraCapabilities: role.defaultReadOnly
        ? ["sessionResume"]
        : ["sessionResume", "cancellation", "tools", "edits", "workspaceIsolation"]
    });
    if (provider.id !== parent.provider) {
      throw new Error(`Run ${request.runId} can resume only with the same provider (${parent.provider}).`);
    }
    if (parent.model === undefined || parent.model.length === 0) {
      throw new Error(`Run ${request.runId} has no recorded model; start a new run or repair its evidence before resuming.`);
    }
    if (provider.model !== parent.model) {
      throw new Error(`Run ${request.runId} model changed from ${parent.model}; start a new run rather than substituting a model.`);
    }
    const runId = this.createRunId();
    const createdAt = this.now().toISOString();
    const policyDecision = evaluateStartPolicy({
      config: this.config,
      roleId: parent.role,
      provider,
      executionPolicy: role.executionPolicy,
      ...(verifiedLease === undefined ? {} : { plannedWorktreeRoot: verifiedLease.executionCwd }),
      requestedProvider: request.provider ?? parent.provider
    });
    if (this.config.policy.auditEnabled) {
      await this.appendAudit(request.cwd, {
        eventType:
          policyDecision.status === "allowed" ? "policy_allowed" : "policy_blocked",
        operation: "start",
        role: parent.role,
        provider: provider.id,
        runId,
        decision: policyDecision.status,
        reason: policyDecision.reason,
        details: policyDecision.details,
        createdAt
      });
    }
    if (policyDecision.status === "blocked") {
      throw new PolicyViolationError({
        reason: policyDecision.reason,
        details: policyDecision.details
      });
    }
    const workflowWriteScope = request.workflowId !== undefined && request.sliceId !== undefined
      ? await reserveWorkflowContinuation({ workspaceRoot: request.cwd, workflowId: request.workflowId, sliceId: request.sliceId, parent, childRunId: runId, createdAt })
      : undefined;

    if ((request.message?.trim() ?? "").length > 0) {
      const record = await this.appendUserInboxMessage({
        workspaceRoot: request.cwd,
        sidecar: parent,
        message: request.message ?? "",
        ...(request.messageType === undefined ? {} : { messageType: request.messageType }),
        ...(request.correlationId === undefined
          ? {}
          : { correlationId: request.correlationId })
      });
      resumeSequence = record.sequence;
    }

    const promptInput = {
      role,
      cwd: request.cwd,
      parentRunId: parent.runId,
      providerSessionId: parent.providerSessionId,
      message: resumeMessage
    };
    const prompt = verifiedLease === undefined
      ? buildReplyPrompt(promptInput)
      : buildImplementationReplyPrompt({ ...promptInput, executionCwd: verifiedLease.executionCwd, ...(workflowWriteScope === undefined ? {} : { writeScope: workflowWriteScope }) });
    const promptDigest = hashPrompt(prompt);
    const logPath = runLogPath(request.cwd, runId);
    const sidecar = buildRunSidecar({
      runId,
      role: parent.role,
      provider,
      status: "running",
      createdAt,
      updatedAt: createdAt,
      evidencePaths: [logPath],
      promptHash: promptDigest,
      logPath,
      providerSessionId: parent.providerSessionId,
      parentRunId: parent.runId,
      resumedFromRunId: parent.runId,
      ...(resumeSequence === undefined ? {} : { resumeSequence }),
      ...(verifiedLease === undefined ? {} : { workspaceLease: verifiedLease }),
      ...(request.workflowId === undefined ? {} : { workspaceFields: {
        ...(request.sliceId === undefined ? {} : { sliceId: request.sliceId }),
        ...(workflowWriteScope === undefined ? {} : { writeScope: workflowWriteScope }),
        workflowId: request.workflowId
      } })
    });

    await writeRunSidecar(request.cwd, sidecar);
    await appendEventRecord(request.cwd, runId, {
      role: parent.role,
      provider: provider.id,
      messageType: "running",
      correlationId: runId,
      createdAt,
      payload: {
        parentRunId: parent.runId,
        resumedFromRunId: parent.runId,
        providerSessionId: parent.providerSessionId,
        resumeSequence
      }
    });

    let worktreeClaim = verifiedLease === undefined ? undefined : {
      sourceCwd: verifiedLease.sourceCwd,
      executionCwd: verifiedLease.executionCwd,
      claimToken: randomUUID()
    };
    if (worktreeClaim !== undefined) {
      let claimAcquired = false;
      try {
        const claimedLease = verifiedLease;
        if (claimedLease === undefined) throw new Error("Retained worktree metadata disappeared before claim.");
        const identity = await claimWorktree({
          ...worktreeClaim,
          lineageRootRunId: await lineageRootRunId(request.cwd, parent),
          activeRunId: runId,
          host: hostname(),
          ownerPid: process.pid,
          ownerProcessStartIdentity: currentProcessStartIdentity(),
          claimedAt: createdAt
        });
        worktreeClaim = { ...worktreeClaim, ...identity };
        claimAcquired = true;
        // The first verification only protects selection.  Recheck after the
        // exclusive claim so a cleanup/replacement cannot race provider spawn.
        verifiedLease = await verifyRetainedWorktree({
          lease: claimedLease,
          expectedSourceCwd: request.cwd,
          allowedExecutionRoots: this.config.policy.allowedWorktreeRoots
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const verdict = blockedVerdict(`Retained worktree claim failed: ${message}`);
        await finalizeRunSidecar({ workspaceRoot: request.cwd, runId, provider: provider.id, status: "failed", updatedAt: this.now().toISOString(), cleanup: "partial", verdict, outputSummary: verdict.summary, eventPayload: { reason: "worktree_claim_failed", message } });
        if (claimAcquired) await releaseWorktreeClaim(worktreeClaim);
        throw error;
      }
    }
    let handle: ProviderSessionHandle;
    try {
      handle = this.startProviderSession(provider, {
        prompt,
        providerId: provider.id,
        cwd: verifiedLease?.executionCwd ?? request.cwd,
        workspaceRoot: request.cwd,
        runId,
        roleId: parent.role,
        executionPolicy: role.executionPolicy,
        config: this.config,
        sessionId: parent.providerSessionId,
        ...(role.defaultReadOnly ? {} : { permissionMode: "acceptEdits" as const }),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        ...(this.env === undefined ? {} : { env: this.env })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const verdict = blockedVerdict(`Provider session failed to start: ${message}`);
      await finalizeRunSidecar({
        workspaceRoot: request.cwd,
        runId,
        provider: provider.id,
        status: "failed",
        updatedAt: this.now().toISOString(),
        cleanup: "partial",
        eventCreatedAt: this.now().toISOString(),
        eventPayload: { reason: "provider_start_failed", message },
        outputSummary: verdict.summary,
        verdict
      });
      if (worktreeClaim !== undefined) await releaseWorktreeClaim(worktreeClaim);
      throw error;
    }

    this.activeRuns.set(activeKey(request.cwd, runId), {
      handle,
      role: parent.role,
      provider,
      ...(worktreeClaim === undefined ? {} : { worktreeClaim })
    });
    this.observeCompletion(request.cwd, runId, handle, provider, worktreeClaim);
    if (worktreeClaim !== undefined && handle.providerProcessId !== undefined) {
      try { await this.recordClaimedProviderProcess({ ...worktreeClaim, providerPid: handle.providerProcessId, ...(handle.providerProcessStartIdentity === undefined ? {} : { providerProcessStartIdentity: handle.providerProcessStartIdentity }) }); }
      catch (error) {
        const warning = `Provider process ownership metadata could not be recorded: ${error instanceof Error ? error.message : String(error)}`;
        try { await this.recordProviderProcessWarning(request.cwd, runId, warning); } catch { /* The observer already owns finalization. */ }
      }
    }

    return {
      runId,
      status: "running",
      provider: provider.id,
      role: parent.role,
      sidecarPath: runSidecarPath(request.cwd, runId),
      logPath,
      ...(handle.transcriptPath === undefined
        ? {}
        : { transcriptPath: handle.transcriptPath }),
      mailboxPaths: mailboxPaths(request.cwd, runId),
      parentRunId: parent.runId,
      resumedFromRunId: parent.runId,
      providerSessionId: parent.providerSessionId,
      ...(verifiedLease === undefined ? {} : { executionCwd: verifiedLease.executionCwd })
    };
  }

  async cancelRun(
    workspaceRoot: string,
    runId: string
  ): Promise<AgentControlResult> {
    const sidecar = await readRunSidecar(workspaceRoot, runId);
    await appendControlRecord(workspaceRoot, runId, {
      role: sidecar.role,
      provider: sidecar.provider,
      messageType: "cancel_requested",
      correlationId: runId,
      payload: { requestedAt: this.now().toISOString() }
    });

    if (isTerminalRunStatus(sidecar.status)) {
      return this.result(workspaceRoot, sidecar, "Run is already terminal.");
    }

    const active = this.activeRuns.get(activeKey(workspaceRoot, runId));
    if (active === undefined) {
      const detached = await this.reconcileDetachedRun(workspaceRoot, sidecar);
      return this.result(
        workspaceRoot,
        detached,
        "No active process handle is attached; recorded cancellation intent."
      );
    }

    await transitionRunSidecar(workspaceRoot, runId, (current) => ({
      ...current,
      status: "cancelling",
      updatedAt: this.now().toISOString()
    }));
    active.handle.kill();
    await this.sleep(this.cancelGraceMs);
    active.handle.forceKill();
    const cancellingSidecar = await readRunSidecar(workspaceRoot, runId);
    const implementationEvidence = await this.implementationEvidence(
      workspaceRoot,
      runId,
      cancellingSidecar
    );
    const cancelled = await transitionRunSidecar(workspaceRoot, runId, (current) => ({
      ...sidecarWithSnapshot(current, active.handle.snapshot()),
      ...implementationEvidence.sidecar,
      status: isTerminalRunStatus(current.status) ? current.status : "cancelled",
      updatedAt: this.now().toISOString(),
      cleanup: "partial",
      evidencePaths: [
        ...new Set([
          ...current.evidencePaths,
          ...implementationEvidence.evidencePaths
        ])
      ]
    }));

    return this.result(
      workspaceRoot,
      cancelled,
      cancelled.status === "cancelled"
        ? "Run cancelled."
        : "Run reached terminal state while cancellation was requested."
    );
  }

  async windDownRun(
    workspaceRoot: string,
    runId: string
  ): Promise<AgentControlResult> {
    const sidecar = await readRunSidecar(workspaceRoot, runId);
    const requestedAt = this.now().toISOString();
    await appendControlRecord(workspaceRoot, runId, {
      role: sidecar.role,
      provider: sidecar.provider,
      messageType: "wind_down_requested",
      correlationId: runId,
      createdAt: requestedAt,
      payload: { requestedAt }
    });

    if (isTerminalRunStatus(sidecar.status)) {
      return this.result(workspaceRoot, sidecar, "Run is already terminal.");
    }

    const active = this.activeRuns.get(activeKey(workspaceRoot, runId));
    let windingDown: RunSidecar;
    try {
      windingDown = await transitionRunSidecar(workspaceRoot, runId, (current) => ({
        ...current,
        status: "winding-down",
        updatedAt: requestedAt,
        inputClosed: true,
        windDownRequestedAt: requestedAt,
        ...(active === undefined
          ? {
              warnings: [
                ...(current.warnings ?? []),
                `Run ${runId} is winding down, but no active process handle is attached.`
              ]
            }
          : {})
      }));
    } catch (error) {
      if (error instanceof InvalidRunTransitionError) {
        const current = await readRunSidecar(workspaceRoot, runId);
        if (isTerminalRunStatus(current.status)) {
          return this.result(workspaceRoot, current, "Run is already terminal.");
        }
      }
      throw error;
    }
    if (active?.handle.supportsStdin === true) {
      active.handle.writeStdin?.(
        `${JSON.stringify({
          type: "agent_team_wind_down",
          control: "wind_down_requested",
          runId,
          instruction:
            "Summarize current state and emit a final verdict if possible."
        })}\n`
      );
    }

    if (active !== undefined) {
      const settled = await Promise.race([
        active.handle.done.then((status) => ({ kind: "settled" as const, status })),
        this.sleep(this.windDownGraceMs).then(() => ({ kind: "elapsed" as const }))
      ]);
      if (settled.kind === "settled") {
        await this.completeRun(
          workspaceRoot,
          runId,
          active.handle.snapshot(),
          settled.status,
          active.provider
        );
        const terminal = await this.waitForTerminalSidecar(workspaceRoot, runId);
        if (terminal !== undefined) {
          return this.result(workspaceRoot, terminal, "Run completed during wind-down.");
        }
      } else {
        await appendEventRecord(workspaceRoot, runId, {
          role: windingDown.role,
          provider: windingDown.provider,
          messageType: "wind_down_grace_elapsed",
          correlationId: runId,
          createdAt: this.now().toISOString(),
          payload: { graceMs: this.windDownGraceMs }
        });
      }
    }

    const resultSidecar =
      active === undefined
        ? await this.reconcileDetachedRun(workspaceRoot, windingDown)
        : windingDown;
    return this.result(
      workspaceRoot,
      resultSidecar,
      active === undefined
        ? "Wind-down intent recorded; no active process handle is attached."
        : "Wind-down requested."
    );
  }

  async cleanupRunWorkspace(
    request: AgentCleanupRequest
  ): Promise<AgentCleanupResult> {
    const sidecar = await readRunSidecar(request.cwd, request.runId);
    const requestedAt = this.now().toISOString();
    await appendControlRecord(request.cwd, request.runId, {
      role: sidecar.role,
      provider: sidecar.provider,
      messageType: "cleanup_requested",
      correlationId: request.runId,
      createdAt: requestedAt,
      payload: { force: request.force }
    });

    const blocked = (message: string): AgentCleanupResult => ({
      runId: request.runId,
      status: "blocked",
      sidecarPath: runSidecarPath(request.cwd, request.runId),
      message,
      ...(sidecar.workspaceCleanup === undefined
        ? {}
        : { workspaceCleanup: sidecar.workspaceCleanup })
    });

    if (request.force !== true) {
      return blocked("Workspace cleanup requires force: true.");
    }

    if (!isTerminalRunStatus(sidecar.status)) {
      return blocked("Workspace cleanup requires a terminal run.");
    }

    const lease = this.workspaceLeaseFromSidecar(sidecar);
    if (lease === undefined) {
      return blocked("Run has no retained implementation worktree metadata.");
    }

    if (sidecar.workspaceCleanup === "removed") {
      return blocked("Implementation worktree is already removed.");
    }

    let cleanupClaim = {
      sourceCwd: lease.sourceCwd,
      executionCwd: lease.executionCwd,
      claimToken: randomUUID()
    };
    let cleanupClaimAcquired = false;

    try {
      const identity = await claimWorktree({
        ...cleanupClaim,
        lineageRootRunId: await lineageRootRunId(request.cwd, sidecar),
        activeRunId: `cleanup:${request.runId}`,
        host: hostname(),
        ownerPid: process.pid,
        ownerProcessStartIdentity: currentProcessStartIdentity(),
        claimedAt: requestedAt
      });
      cleanupClaim = { ...cleanupClaim, ...identity };
      cleanupClaimAcquired = true;
      const verifiedLease = this.cleanupWorkspace === cleanupIsolatedWorktree
        ? await verifyRetainedWorktree({
            lease,
            expectedSourceCwd: request.cwd,
            allowedExecutionRoots: this.config.policy.allowedWorktreeRoots
          })
        : lease;
      const lineage = await this.matchingWorktreeSidecars(request.cwd, verifiedLease);
      await this.assertNoLegacyActiveLineage(request.cwd, sidecar, verifiedLease, lineage);
      const removed = await this.cleanupWorkspace({ lease: verifiedLease, force: true });
      const updated = await this.markLineageWorktreeRemoved(request.cwd, request.runId, removed.executionCwd, lineage);

      return {
        runId: request.runId,
        status: "removed",
        sidecarPath: runSidecarPath(request.cwd, request.runId),
        workspaceCleanup: removed.cleanup,
        message: "Implementation worktree removed."
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Retained worktree has nonterminal lineage run")) {
        return blocked(message);
      }
      const updated = await transitionRunSidecar(request.cwd, request.runId, (current) => ({
        ...current,
        updatedAt: this.now().toISOString(),
        warnings: [
          ...(current.warnings ?? []),
          `Implementation workspace cleanup failed: ${message}`
        ]
      }));

      return {
        runId: request.runId,
        status: "failed",
        sidecarPath: runSidecarPath(request.cwd, request.runId),
        ...(updated.workspaceCleanup === undefined
          ? {}
          : { workspaceCleanup: updated.workspaceCleanup }),
        message: `Implementation workspace cleanup failed: ${message}`
      };
    } finally {
      if (cleanupClaimAcquired) await releaseWorktreeClaim(cleanupClaim);
    }
  }

  private inputClosed(sidecar: RunSidecar): boolean {
    return (
      sidecar.inputClosed === true ||
      sidecar.status === "winding-down" ||
      sidecar.status === "cancelling" ||
      sidecar.status === "cancelled" ||
      sidecar.status === "failed" ||
      sidecar.status === "expired"
    );
  }

  private async reconcileOutboxRequests(
    workspaceRoot: string,
    sidecar: RunSidecar,
    snapshot: ProviderSessionSnapshot
  ): Promise<RunSidecar> {
    let current = sidecar;
    for (const request of snapshot.pendingOutboxRequests) {
      current = await this.persistOutboxRequest(workspaceRoot, current, request);
    }
    return current;
  }

  private async reconcileDetachedRun(
    workspaceRoot: string,
    sidecar: RunSidecar
  ): Promise<RunSidecar> {
    if (isTerminalRunStatus(sidecar.status)) {
      return sidecar;
    }

    const warning = `Run ${sidecar.runId} is ${sidecar.status}, but no active process handle is attached.`;
    if (sidecar.detached === true) {
      return {
        ...sidecar,
        warnings: [...new Set([...(sidecar.warnings ?? []), warning])]
      };
    }

    const detachedAt = this.now().toISOString();
    const reconciled = await transitionRunSidecar(
      workspaceRoot,
      sidecar.runId,
      (current) => ({
        ...current,
        detached: true,
        detachedAt,
        updatedAt: detachedAt,
        warnings: [...new Set([...(current.warnings ?? []), warning])]
      })
    );

    await appendEventRecord(workspaceRoot, sidecar.runId, {
      role: reconciled.role,
      provider: reconciled.provider,
      messageType: "detached_handle_missing",
      correlationId: sidecar.runId,
      createdAt: detachedAt,
      payload: {
        status: reconciled.status,
        detachedAt
      }
    });

    return reconciled;
  }

  private async persistOutboxRequest(
    workspaceRoot: string,
    sidecar: RunSidecar,
    request: ProviderOutboxRequest
  ): Promise<RunSidecar> {
    const result = await withRunSidecarLock(workspaceRoot, sidecar.runId, async () => {
      const current = await readRunSidecar(workspaceRoot, sidecar.runId);
      if (current.status !== "running" && current.status !== "awaiting-input") {
        return { sidecar: current, record: undefined };
      }
      if ((current.outboxRequestIds ?? []).includes(request.id)) {
        return { sidecar: current, record: undefined };
      }

      const now = this.now().toISOString();
      const record = await appendOutboxRecord(workspaceRoot, sidecar.runId, {
        role: current.role,
        provider: current.provider,
        messageType: request.messageType,
        correlationId: request.correlationId ?? `outbox:${sidecar.runId}:${request.id}`,
        createdAt: request.createdAt ?? now,
        payload: request.payload
      });

      const next: RunSidecar = {
        ...current,
        status: current.status === "running" ? "awaiting-input" : current.status,
        updatedAt: now,
        awaitingInputSince: current.awaitingInputSince ?? now,
        outboxRequestIds: [...(current.outboxRequestIds ?? []), request.id],
        pendingOutboxRequest: {
          id: request.id,
          sequence: record.sequence,
          messageType: record.messageType,
          correlationId: record.correlationId,
          createdAt: record.createdAt,
          payload: record.payload
        }
      };
      await writeRunSidecar(workspaceRoot, next);
      return { sidecar: next, record };
    });

    if (result.record === undefined) {
      return result.sidecar;
    }

    await appendEventRecord(workspaceRoot, sidecar.runId, {
      role: result.sidecar.role,
      provider: result.sidecar.provider,
      messageType: "awaiting_input_requested",
      correlationId: result.record.correlationId,
      createdAt: this.now().toISOString(),
      payload: {
        outboxRequestId: request.id,
        outboxSequence: result.record.sequence,
        messageType: result.record.messageType
      }
    });

    return result.sidecar;
  }

  private async resumeAwaitingInputRun(
    workspaceRoot: string,
    sidecar: RunSidecar,
    record: MailboxRecord
  ): Promise<RunSidecar> {
    const next = await transitionRunSidecar(workspaceRoot, sidecar.runId, (current) => {
      const {
        awaitingInputSince: _awaitingInputSince,
        pendingOutboxRequest: _pendingOutboxRequest,
        ...rest
      } = current;
      return {
        ...rest,
        status: "running",
        updatedAt: this.now().toISOString()
      };
    });

    await appendEventRecord(workspaceRoot, sidecar.runId, {
      role: next.role,
      provider: next.provider,
      messageType: "awaiting_input_replied",
      correlationId: record.correlationId,
      createdAt: this.now().toISOString(),
      payload: {
        inboxSequence: record.sequence,
        outboxRequestId: sidecar.pendingOutboxRequest?.id
      }
    });

    return next;
  }

  private async appendUserInboxMessage(input: {
    readonly workspaceRoot: string;
    readonly sidecar: RunSidecar;
    readonly message: string;
    readonly messageType?: string;
    readonly correlationId?: string;
  }): Promise<MailboxRecord> {
    return appendInboxRecord(input.workspaceRoot, input.sidecar.runId, {
      role: input.sidecar.role,
      provider: input.sidecar.provider,
      messageType: input.messageType ?? "user_message",
      correlationId:
        input.correlationId ?? `message:${input.sidecar.runId}:${this.now().toISOString()}`,
      createdAt: this.now().toISOString(),
      payload: { message: input.message }
    });
  }

  private async latestInboxMessage(
    workspaceRoot: string,
    runId: string
  ): Promise<{ readonly message: string; readonly sequence: number } | undefined> {
    const records = await readMailboxRecords(workspaceRoot, runId, "inbox");
    for (const record of [...records].reverse()) {
      if (
        typeof record.payload === "object" &&
        record.payload !== null &&
        "message" in record.payload &&
        typeof record.payload.message === "string" &&
        record.payload.message.trim().length > 0
      ) {
        return {
          message: record.payload.message,
          sequence: record.sequence
        };
      }
    }
    return undefined;
  }

  private workspaceLeaseFromSidecar(sidecar: RunSidecar): WorkspaceLease | undefined {
    if (
      sidecar.sourceCwd === undefined ||
      sidecar.executionCwd === undefined ||
      sidecar.workspaceIsolation !== "git-worktree" ||
      sidecar.workspaceRetention !== "retain-until-integrated"
    ) {
      return undefined;
    }

    return {
      sourceCwd: sidecar.sourceCwd,
      executionCwd: sidecar.executionCwd,
      branchName: sidecar.workspaceBranchName ?? "",
      baseRef: sidecar.workspaceBaseRef ?? "",
      isolation: "git-worktree",
      retention: "retain-until-integrated",
      cleanup: sidecar.workspaceCleanup ?? "retained"
    };
  }

  private async implementationEvidence(
    workspaceRoot: string,
    runId: string,
    sidecar: RunSidecar
  ): Promise<{
    readonly sidecar: Partial<RunSidecar>;
    readonly evidencePaths: readonly string[];
  }> {
    if (sidecar.executionCwd === undefined) {
      return { sidecar: {}, evidencePaths: [] };
    }

    try {
      const inspection = await this.inspectWorkspace({
        executionCwd: sidecar.executionCwd
      });
      const artifactFingerprint = this.inspectWorkspace === inspectImplementationWorkspace
        ? await fingerprintImplementationWorkspace({ executionCwd: sidecar.executionCwd })
        : inspection.artifactFingerprint;
      let diffPath: string | undefined;
      if (inspection.diffText !== undefined) {
        diffPath = workspaceDiffPath(workspaceRoot, runId);
        await mkdir(dirname(diffPath), { recursive: true });
        await writeFile(diffPath, inspection.diffText, "utf8");
      }

      return {
        sidecar: {
          changedFiles: inspection.changedFiles,
          workspaceStatus: inspection.statusSummary,
          workspaceCleanup: "retained",
          ...(artifactFingerprint === undefined ? {} : { artifactFingerprint }),
          ...(diffPath === undefined ? {} : { workspaceDiffPath: diffPath })
        },
        evidencePaths: diffPath === undefined ? [] : [diffPath]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        sidecar: {
          warnings: [
            ...(sidecar.warnings ?? []),
            `Implementation workspace inspection failed: ${message}`
          ]
        },
        evidencePaths: []
      };
    }
  }

  private async waitForTerminalSidecar(
    workspaceRoot: string,
    runId: string
  ): Promise<RunSidecar | undefined> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const sidecar = await readRunSidecar(workspaceRoot, runId);
      if (isTerminalRunStatus(sidecar.status)) {
        return sidecar;
      }
      await this.sleep(5);
    }
    return undefined;
  }

  private async matchingWorktreeSidecars(
    workspaceRoot: string,
    lease: WorkspaceLease
  ): Promise<readonly RunSidecar[]> {
    let entries: readonly string[];
    try {
      entries = await readdir(runsDir(workspaceRoot));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const sidecars = await Promise.all(entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => readRunSidecar(workspaceRoot, entry.slice(0, -5))));
    const targetIdentity = await this.leaseIdentity(lease);
    const candidates = await Promise.all(sidecars.map(async (candidate) => {
      const candidateLease = this.workspaceLeaseFromSidecar(candidate);
      if (candidateLease === undefined) return undefined;
      const candidateIdentity = await this.leaseIdentity(candidateLease);
      return candidateIdentity === targetIdentity ? candidate : undefined;
    }));
    return candidates.filter((candidate): candidate is RunSidecar => candidate !== undefined);
  }

  private async leaseIdentity(lease: WorkspaceLease): Promise<string> {
    const canonical = async (path: string): Promise<string> => {
      try { return await realpath(path); } catch { return resolve(path); }
    };
    const [sourceCwd, executionCwd] = await Promise.all([canonical(lease.sourceCwd), canonical(lease.executionCwd)]);
    return `${sourceCwd}\0${executionCwd}`;
  }

  private async assertNoLegacyActiveLineage(
    workspaceRoot: string,
    parent: RunSidecar,
    lease: WorkspaceLease,
    knownLineage?: readonly RunSidecar[]
  ): Promise<void> {
    const active = (knownLineage ?? await this.matchingWorktreeSidecars(workspaceRoot, lease))
      .filter((candidate) => candidate.runId !== parent.runId && !isTerminalRunStatus(candidate.status));
    if (active.length > 0) {
      throw new Error(`Retained worktree has nonterminal lineage run ${active[0]!.runId}; verify and recover it before resume or cleanup.`);
    }
  }

  private async markLineageWorktreeRemoved(
    workspaceRoot: string,
    cleanupRunId: string,
    executionCwd: string,
    matching: readonly RunSidecar[]
  ): Promise<RunSidecar> {
    let requested: RunSidecar | undefined;
    await Promise.all(matching.map(async (candidate) => {
      const updated = await transitionRunSidecar(workspaceRoot, candidate.runId, (current) => ({
        ...current,
        workspaceCleanup: "removed",
        updatedAt: this.now().toISOString()
      }));
      await appendEventRecord(workspaceRoot, candidate.runId, {
        role: updated.role,
        provider: updated.provider,
        messageType: "workspace_cleanup_removed",
        correlationId: cleanupRunId,
        createdAt: this.now().toISOString(),
        payload: { executionCwd }
      });
      if (candidate.runId === cleanupRunId) requested = updated;
    }));
    if (requested === undefined) throw new Error(`Cleanup lineage did not contain run ${cleanupRunId}.`);
    return requested;
  }

  private observeCompletion(
    workspaceRoot: string,
    runId: string,
    handle: ProviderSessionHandle,
    provider: AgentProviderDescriptor,
    worktreeClaim?: { readonly sourceCwd: string; readonly executionCwd: string; readonly claimToken: string }
  ): void {
    void handle.done
      .then(async (status) => {
        await this.completeRun(workspaceRoot, runId, handle.snapshot(), status, provider);
        const finalized = await readRunSidecar(workspaceRoot, runId);
        if (worktreeClaim !== undefined && isTerminalRunStatus(finalized.status)) {
          await releaseWorktreeClaim(worktreeClaim);
        }
      })
      .catch(() => {
        // The provider process may settle after its workspace has been removed
        // during tests or manual cleanup. Status callers still rely on the last
        // durable sidecar rather than an unhandled lifecycle rejection.
      })
      .finally(() => {
        this.activeRuns.delete(activeKey(workspaceRoot, runId));
      });
  }

  private startProviderSession(
    provider: AgentProviderDescriptor,
    input: ProviderStartSessionInput
  ): ProviderSessionHandle {
    if (this.startSession !== undefined) {
      return this.startSession(input);
    }

    const runtime = requireProviderRuntime(
      provider.id,
      this.runtimes === undefined ? {} : { runtimes: this.runtimes }
    );
    return runtime.startSession(input);
  }

  private async completeRun(
    workspaceRoot: string,
    runId: string,
    snapshot: ProviderSessionSnapshot,
    status: ProviderSessionDoneStatus,
    provider: AgentProviderDescriptor
  ): Promise<void> {
    try {
      const existing = await readRunSidecar(workspaceRoot, runId);
      if (isTerminalRunStatus(existing.status)) {
        if (existing.status === "cancelled") {
          const implementationEvidence = await this.implementationEvidence(workspaceRoot, runId, existing);
          const finalized = await transitionRunSidecar(workspaceRoot, runId, (current) => ({
            ...sidecarWithSnapshot(current, snapshot),
            ...implementationEvidence.sidecar,
            updatedAt: this.now().toISOString(),
            evidencePaths: [...new Set([...current.evidencePaths, ...implementationEvidence.evidencePaths])],
            ...(snapshot.failureEvidence === undefined ? {} : { failureEvidence: snapshot.failureEvidence })
          }));
          await appendEventRecord(workspaceRoot, runId, {
            role: finalized.role,
            provider: provider.id,
            messageType: "cancelled_finalized",
            correlationId: runId,
            createdAt: this.now().toISOString(),
            payload: {
              ...(snapshot.providerSessionId === undefined ? {} : { providerSessionId: snapshot.providerSessionId }),
              ...(snapshot.failureEvidence === undefined ? {} : { failureEvidence: snapshot.failureEvidence })
            }
          });
        }
        return;
      }
      if (existing.status === "cancelling" && status === "interrupted") {
        const finalized = await transitionRunSidecar(workspaceRoot, runId, (current) => ({
          ...sidecarWithSnapshot(current, snapshot),
          status: "cancelled",
          cleanup: "partial",
          updatedAt: this.now().toISOString(),
          ...(snapshot.failureEvidence === undefined ? {} : { failureEvidence: snapshot.failureEvidence })
        }));
        await appendEventRecord(workspaceRoot, runId, {
          role: finalized.role, provider: provider.id, messageType: "cancelled_finalized", correlationId: runId,
          createdAt: this.now().toISOString(), payload: { status, cancellation: "interrupted" }
        });
        return;
      }
      if (status === "completed") {
        const verdict = parseVerdict(snapshot.text);
        const implementationEvidence = await this.implementationEvidence(
          workspaceRoot,
          runId,
          existing
        );
        await finalizeRunSidecar({
          workspaceRoot,
          runId,
          provider: provider.id,
          status: "completed",
          updatedAt: this.now().toISOString(),
          outputSummary: verdict.summary,
          cleanup: "complete",
          verdict,
          snapshot,
          sidecarPatch: implementationEvidence.sidecar,
          evidencePaths: implementationEvidence.evidencePaths,
          eventPayload: {
            verdict: verdict.status,
            ...(snapshot.failureEvidence === undefined ? {} : { failureEvidence: snapshot.failureEvidence })
          }
        });
        return;
      }

      if (status === "expired") {
        const verdict = blockedVerdict("Provider session expired after timeout.");
        const implementationEvidence = await this.implementationEvidence(
          workspaceRoot,
          runId,
          existing
        );
        await finalizeRunSidecar({
          workspaceRoot,
          runId,
          provider: provider.id,
          status: "expired",
          updatedAt: this.now().toISOString(),
          outputSummary: verdict.summary,
          cleanup: "partial",
          verdict,
          snapshot,
          sidecarPatch: implementationEvidence.sidecar,
          evidencePaths: implementationEvidence.evidencePaths,
          eventPayload: {
            status,
            ...(snapshot.failureEvidence === undefined ? {} : { failureEvidence: snapshot.failureEvidence })
          }
        });
        return;
      }

      const verdict = blockedVerdict(`Provider session ended with status ${status}.`);
      const implementationEvidence = await this.implementationEvidence(
        workspaceRoot,
        runId,
        existing
      );
      await finalizeRunSidecar({
        workspaceRoot,
        runId,
        provider: provider.id,
        status: "failed",
        updatedAt: this.now().toISOString(),
        outputSummary: verdict.summary,
        cleanup: "partial",
        verdict,
        snapshot,
        sidecarPatch: implementationEvidence.sidecar,
        evidencePaths: implementationEvidence.evidencePaths,
        eventPayload: {
          status,
          ...(snapshot.failureEvidence === undefined ? {} : { failureEvidence: snapshot.failureEvidence })
        }
      });
    } catch (error) {
      if (!(error instanceof InvalidRunTransitionError)) {
        throw error;
      }
    }
  }

  private result(
    workspaceRoot: string,
    sidecar: RunSidecar,
    message: string
  ): AgentControlResult {
    return {
      runId: sidecar.runId,
      status: sidecar.status,
      sidecarPath: runSidecarPath(workspaceRoot, sidecar.runId),
      message,
      ...(sidecar.detached === undefined ? {} : { detached: sidecar.detached }),
      ...(sidecar.detachedAt === undefined ? {} : { detachedAt: sidecar.detachedAt })
    };
  }
}

export const defaultLifecycleManager = new AgentLifecycleManager();
