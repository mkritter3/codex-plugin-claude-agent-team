import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startClaudeBackgroundSession } from "../providers/claude-code-cli/background.js";
import { listProviders } from "../providers/index.js";
import type {
  ProviderSessionDoneStatus,
  ProviderSessionHandle,
  ProviderSessionPermissionMode,
  ProviderSessionSnapshot
} from "../providers/types.js";
import { DEFAULT_AGENT_TEAM_CONFIG } from "./config.js";
import {
  buildImplementationPrompt,
  buildReplyPrompt,
  buildRolePrompt
} from "./prompts.js";
import { getRole } from "./roles.js";
import { selectProvider } from "./router.js";
import { createRunId as defaultCreateRunId, hashPrompt } from "./run-ids.js";
import {
  appendControlRecord,
  appendEventRecord,
  appendInboxRecord,
  readMailboxRecords
} from "./state/mailbox-store.js";
import {
  mailboxPath,
  runLogPath,
  runSidecarPath,
  workspaceDiffPath
} from "./state/paths.js";
import {
  InvalidRunTransitionError,
  isTerminalRunStatus,
  readRunSidecar,
  transitionRunSidecar,
  writeRunSidecar
} from "./state/run-store.js";
import { parseVerdict } from "./verdict.js";
import {
  allocateIsolatedWorktree,
  inspectImplementationWorkspace
} from "./workspaces.js";
import type {
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
  ParsedVerdict,
  RunSidecar,
  WorkspaceLease
} from "./types.js";

export type StartProviderSession = (input: {
  readonly prompt: string;
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionId?: string;
  readonly permissionMode?: ProviderSessionPermissionMode;
}) => ProviderSessionHandle;

type AllocateWorkspace = typeof allocateIsolatedWorktree;
type InspectWorkspace = typeof inspectImplementationWorkspace;

export interface AgentLifecycleDependencies {
  readonly providers?: readonly AgentProviderDescriptor[];
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly startSession?: StartProviderSession;
  readonly config?: AgentTeamConfig;
  readonly allocateWorkspace?: AllocateWorkspace;
  readonly inspectWorkspace?: InspectWorkspace;
  readonly env?: NodeJS.ProcessEnv;
  readonly cancelGraceMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface ActiveRun {
  readonly handle: ProviderSessionHandle;
  readonly role: AgentDispatchRequest["role"];
  readonly provider: AgentProviderDescriptor;
}

function activeKey(workspaceRoot: string, runId: string): string {
  return `${workspaceRoot}\0${runId}`;
}

function blockedVerdict(summary: string): ParsedVerdict {
  return {
    status: "BLOCKED",
    summary,
    requiredChanges: [],
    evidence: [],
    risks: [],
    warnings: [],
    raw: summary
  };
}

function sidecarWithSnapshot(
  sidecar: RunSidecar,
  snapshot: ProviderSessionSnapshot
): RunSidecar {
  return {
    ...sidecar,
    ...(snapshot.providerSessionId === undefined
      ? {}
      : { providerSessionId: snapshot.providerSessionId }),
    recentActivities: snapshot.recentActivities,
    currentActivity: snapshot.currentActivity,
    lastStderr: snapshot.lastStderr,
    warnings: snapshot.warnings,
    ...(snapshot.transcriptPath === undefined
      ? {}
      : { transcriptPath: snapshot.transcriptPath }),
    ...(snapshot.logPath === undefined ? {} : { logPath: snapshot.logPath })
  };
}

function mailboxPaths(workspaceRoot: string, runId: string) {
  return {
    inbox: mailboxPath(workspaceRoot, runId, "inbox"),
    outbox: mailboxPath(workspaceRoot, runId, "outbox"),
    control: mailboxPath(workspaceRoot, runId, "control"),
    events: mailboxPath(workspaceRoot, runId, "events")
  };
}

function workspaceSidecarFields(lease: WorkspaceLease | undefined): Partial<RunSidecar> {
  if (lease === undefined) {
    return {};
  }

  return {
    sourceCwd: lease.sourceCwd,
    executionCwd: lease.executionCwd,
    workspaceIsolation: lease.isolation,
    workspaceRetention: lease.retention,
    workspaceCleanup: lease.cleanup
  };
}

export class AgentLifecycleManager {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly providers: readonly AgentProviderDescriptor[] | undefined;
  private readonly now: () => Date;
  private readonly createRunId: () => string;
  private readonly startSession: StartProviderSession;
  private readonly config: AgentTeamConfig;
  private readonly allocateWorkspace: AllocateWorkspace;
  private readonly inspectWorkspace: InspectWorkspace;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly cancelGraceMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: AgentLifecycleDependencies = {}) {
    this.providers = deps.providers;
    this.now = deps.now ?? (() => new Date());
    this.createRunId = deps.createRunId ?? defaultCreateRunId;
    this.config = deps.config ?? DEFAULT_AGENT_TEAM_CONFIG;
    this.allocateWorkspace = deps.allocateWorkspace ?? allocateIsolatedWorktree;
    this.inspectWorkspace = deps.inspectWorkspace ?? inspectImplementationWorkspace;
    this.startSession =
      deps.startSession ??
      ((input) =>
        startClaudeBackgroundSession({
          ...input,
          ...(this.env === undefined ? {} : { env: this.env })
        }));
    this.env = deps.env;
    this.cancelGraceMs = deps.cancelGraceMs ?? 250;
    this.sleep = deps.sleep ?? delay;
  }

  async startRun(request: AgentDispatchRequest): Promise<AgentStartResult> {
    const role = getRole(request.role);
    if (
      !role.defaultReadOnly &&
      (!this.config.writeMode.enabled || !this.config.writeMode.requireIsolatedWorktree)
    ) {
      throw new Error(`Role ${role.id} cannot start because write mode is disabled.`);
    }

    const providers = this.providers ?? listProviders({ config: this.config });
    const provider = selectProvider({
      roleId: request.role,
      providers,
      ...(request.provider === undefined ? {} : { requestedProviderId: request.provider })
    });
    const runId = this.createRunId();
    const createdAt = this.now().toISOString();
    const lease = role.defaultReadOnly
      ? undefined
      : await this.allocateWorkspace({
          sourceCwd: request.cwd,
          runId
        });
    const executionCwd = lease?.executionCwd ?? request.cwd;
    const prompt = role.defaultReadOnly
      ? buildRolePrompt({ role, task: request.task, cwd: request.cwd })
      : buildImplementationPrompt({
          role,
          task: request.task,
          sourceCwd: request.cwd,
          executionCwd
        });
    const promptDigest = hashPrompt(prompt);
    const logPath = runLogPath(request.cwd, runId);
    const sidecar: RunSidecar = {
      runId,
      role: request.role,
      provider: provider.id,
      status: "running",
      createdAt,
      updatedAt: createdAt,
      capabilitiesUsed: provider.capabilities,
      evidencePaths: [logPath],
      authMode: provider.authMode,
      promptHash: promptDigest,
      logPath,
      ...workspaceSidecarFields(lease)
    };

    await writeRunSidecar(request.cwd, sidecar);
    await appendEventRecord(request.cwd, runId, {
      role: request.role,
      provider: provider.id,
      messageType: "running",
      correlationId: runId,
      createdAt,
      payload: { task: request.task }
    });

    let handle: ProviderSessionHandle;
    try {
      handle = this.startSession({
        prompt,
        cwd: executionCwd,
        workspaceRoot: request.cwd,
        runId,
        ...(role.defaultReadOnly ? {} : { permissionMode: "acceptEdits" }),
        ...(this.env === undefined ? {} : { env: this.env })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const verdict = blockedVerdict(`Provider session failed to start: ${message}`);
      await transitionRunSidecar(request.cwd, runId, (current) => ({
        ...current,
        status: "failed",
        updatedAt: this.now().toISOString(),
        outputSummary: verdict.summary,
        cleanup: "partial",
        verdict
      }));
      await appendEventRecord(request.cwd, runId, {
        role: request.role,
        provider: provider.id,
        messageType: "failed",
        correlationId: runId,
        createdAt: this.now().toISOString(),
        payload: { reason: "provider_start_failed", message }
      });
      throw error;
    }
    this.activeRuns.set(activeKey(request.cwd, runId), {
      handle,
      role: request.role,
      provider
    });
    this.observeCompletion(request.cwd, runId, handle, provider);

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
      return sidecarWithSnapshot(sidecar, active.handle.snapshot());
    }

    if (!isTerminalRunStatus(sidecar.status)) {
      return {
        ...sidecar,
        detached: true,
        warnings: [
          `Run ${runId} is ${sidecar.status}, but no active process handle is attached.`
        ]
      };
    }

    return sidecar;
  }

  async messageRun(request: AgentMessageRequest): Promise<AgentMessageResult> {
    const sidecar = await readRunSidecar(request.cwd, request.runId);
    const record = await this.appendUserInboxMessage({
      workspaceRoot: request.cwd,
      sidecar,
      message: request.message,
      ...(request.messageType === undefined ? {} : { messageType: request.messageType }),
      ...(request.correlationId === undefined
        ? {}
        : { correlationId: request.correlationId })
    });

    return {
      runId: request.runId,
      status: "recorded_for_resume",
      record,
      message: "Message recorded for resume."
    };
  }

  async replyRun(request: AgentReplyRequest): Promise<AgentReplyResult> {
    const parent = await readRunSidecar(request.cwd, request.runId);
    if (parent.providerSessionId === undefined || parent.providerSessionId.length === 0) {
      throw new Error(`Run ${request.runId} has no provider session id to resume.`);
    }

    let resumeMessage = request.message?.trim() ?? "";
    let resumeSequence: number | undefined;
    if (resumeMessage.length > 0) {
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
    } else {
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
    if (!role.defaultReadOnly) {
      throw new Error(`Role ${role.id} is not supported by background read-only runs.`);
    }

    const provider = selectProvider({
      roleId: parent.role,
      providers: this.providers ?? listProviders(),
      requestedProviderId: request.provider ?? parent.provider,
      extraCapabilities: ["sessionResume"]
    });
    const runId = this.createRunId();
    const createdAt = this.now().toISOString();
    const prompt = buildReplyPrompt({
      role,
      cwd: request.cwd,
      parentRunId: parent.runId,
      providerSessionId: parent.providerSessionId,
      message: resumeMessage
    });
    const promptDigest = hashPrompt(prompt);
    const logPath = runLogPath(request.cwd, runId);
    const sidecar: RunSidecar = {
      runId,
      role: parent.role,
      provider: provider.id,
      status: "running",
      createdAt,
      updatedAt: createdAt,
      capabilitiesUsed: provider.capabilities,
      evidencePaths: [logPath],
      authMode: provider.authMode,
      promptHash: promptDigest,
      logPath,
      providerSessionId: parent.providerSessionId,
      parentRunId: parent.runId,
      resumedFromRunId: parent.runId,
      ...(resumeSequence === undefined ? {} : { resumeSequence })
    };

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

    let handle: ProviderSessionHandle;
    try {
      handle = this.startSession({
        prompt,
        cwd: request.cwd,
        workspaceRoot: request.cwd,
        runId,
        sessionId: parent.providerSessionId,
        ...(this.env === undefined ? {} : { env: this.env })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const verdict = blockedVerdict(`Provider session failed to start: ${message}`);
      await transitionRunSidecar(request.cwd, runId, (current) => ({
        ...current,
        status: "failed",
        updatedAt: this.now().toISOString(),
        outputSummary: verdict.summary,
        cleanup: "partial",
        verdict
      }));
      await appendEventRecord(request.cwd, runId, {
        role: parent.role,
        provider: provider.id,
        messageType: "failed",
        correlationId: runId,
        createdAt: this.now().toISOString(),
        payload: { reason: "provider_start_failed", message }
      });
      throw error;
    }

    this.activeRuns.set(activeKey(request.cwd, runId), {
      handle,
      role: parent.role,
      provider
    });
    this.observeCompletion(request.cwd, runId, handle, provider);

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
      providerSessionId: parent.providerSessionId
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
      return this.result(
        workspaceRoot,
        sidecar,
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
      ...current,
      ...implementationEvidence.sidecar,
      status: "cancelled",
      updatedAt: this.now().toISOString(),
      cleanup: "partial",
      evidencePaths: [
        ...new Set([
          ...current.evidencePaths,
          ...implementationEvidence.evidencePaths
        ])
      ]
    }));

    return this.result(workspaceRoot, cancelled, "Run cancelled.");
  }

  async windDownRun(
    workspaceRoot: string,
    runId: string
  ): Promise<AgentControlResult> {
    const sidecar = await readRunSidecar(workspaceRoot, runId);
    await appendControlRecord(workspaceRoot, runId, {
      role: sidecar.role,
      provider: sidecar.provider,
      messageType: "wind_down_requested",
      correlationId: runId,
      payload: { requestedAt: this.now().toISOString() }
    });

    if (isTerminalRunStatus(sidecar.status)) {
      return this.result(workspaceRoot, sidecar, "Run is already terminal.");
    }

    const active = this.activeRuns.get(activeKey(workspaceRoot, runId));
    const windingDown = await transitionRunSidecar(workspaceRoot, runId, (current) => ({
      ...current,
      status: "winding-down",
      updatedAt: this.now().toISOString()
    }));
    active?.handle.writeStdin?.(
      `${JSON.stringify({ type: "wind_down_requested", runId })}\n`
    );

    return this.result(
      workspaceRoot,
      windingDown,
      active === undefined
        ? "Wind-down intent recorded; no active process handle is attached."
        : "Wind-down requested."
    );
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

  private observeCompletion(
    workspaceRoot: string,
    runId: string,
    handle: ProviderSessionHandle,
    provider: AgentProviderDescriptor
  ): void {
    void handle.done
      .then(async (status) => {
        await this.completeRun(workspaceRoot, runId, handle.snapshot(), status, provider);
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

  private async completeRun(
    workspaceRoot: string,
    runId: string,
    snapshot: ProviderSessionSnapshot,
    status: ProviderSessionDoneStatus,
    provider: AgentProviderDescriptor
  ): Promise<void> {
    try {
      if (status === "completed") {
        const verdict = parseVerdict(snapshot.text);
        const current = await readRunSidecar(workspaceRoot, runId);
        const implementationEvidence = await this.implementationEvidence(
          workspaceRoot,
          runId,
          current
        );
        const completed = await transitionRunSidecar(workspaceRoot, runId, (current) =>
          sidecarWithSnapshot(
            {
              ...current,
              ...implementationEvidence.sidecar,
              status: "completed",
              updatedAt: this.now().toISOString(),
              outputSummary: verdict.summary,
              cleanup: "complete",
              verdict,
              evidencePaths: [
                ...new Set([
                  ...current.evidencePaths,
                  ...(snapshot.logPath === undefined ? [] : [snapshot.logPath]),
                  ...(snapshot.transcriptPath === undefined ? [] : [snapshot.transcriptPath]),
                  ...implementationEvidence.evidencePaths
                ])
              ]
            },
            snapshot
          )
        );
        await appendEventRecord(workspaceRoot, runId, {
          role: completed.role,
          provider: provider.id,
          messageType: "completed",
          correlationId: runId,
          payload: { verdict: verdict.status }
        });
        return;
      }

      const verdict = blockedVerdict(`Provider session ended with status ${status}.`);
      const current = await readRunSidecar(workspaceRoot, runId);
      const implementationEvidence = await this.implementationEvidence(
        workspaceRoot,
        runId,
        current
      );
      const failed = await transitionRunSidecar(workspaceRoot, runId, (current) =>
        sidecarWithSnapshot(
          {
            ...current,
            ...implementationEvidence.sidecar,
            status: "failed",
            updatedAt: this.now().toISOString(),
            outputSummary: verdict.summary,
            cleanup: "partial",
            verdict,
            evidencePaths: [
              ...new Set([
                ...current.evidencePaths,
                ...(snapshot.logPath === undefined ? [] : [snapshot.logPath]),
                ...(snapshot.transcriptPath === undefined ? [] : [snapshot.transcriptPath]),
                ...implementationEvidence.evidencePaths
              ])
            ]
          },
          snapshot
        )
      );
      await appendEventRecord(workspaceRoot, runId, {
        role: failed.role,
        provider: provider.id,
        messageType: "failed",
        correlationId: runId,
        payload: { status }
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
      message
    };
  }
}

export const defaultLifecycleManager = new AgentLifecycleManager();
