import { setTimeout as delay } from "node:timers/promises";
import { startClaudeBackgroundSession } from "../providers/claude-code-cli/background.js";
import { listProviders } from "../providers/index.js";
import type {
  ProviderSessionDoneStatus,
  ProviderSessionHandle,
  ProviderSessionSnapshot
} from "../providers/types.js";
import { buildRolePrompt } from "./prompts.js";
import { getRole } from "./roles.js";
import { selectProvider } from "./router.js";
import { createRunId as defaultCreateRunId, hashPrompt } from "./run-ids.js";
import {
  appendControlRecord,
  appendEventRecord
} from "./state/mailbox-store.js";
import { mailboxPath, runLogPath, runSidecarPath } from "./state/paths.js";
import {
  InvalidRunTransitionError,
  isTerminalRunStatus,
  readRunSidecar,
  transitionRunSidecar,
  writeRunSidecar
} from "./state/run-store.js";
import { parseVerdict } from "./verdict.js";
import type {
  AgentControlResult,
  AgentDispatchRequest,
  AgentProviderDescriptor,
  AgentStartResult,
  ParsedVerdict,
  RunSidecar
} from "./types.js";

export type StartProviderSession = (input: {
  readonly prompt: string;
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly env?: NodeJS.ProcessEnv;
}) => ProviderSessionHandle;

export interface AgentLifecycleDependencies {
  readonly providers?: readonly AgentProviderDescriptor[];
  readonly now?: () => Date;
  readonly createRunId?: () => string;
  readonly startSession?: StartProviderSession;
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

export class AgentLifecycleManager {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly providers: readonly AgentProviderDescriptor[] | undefined;
  private readonly now: () => Date;
  private readonly createRunId: () => string;
  private readonly startSession: StartProviderSession;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly cancelGraceMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: AgentLifecycleDependencies = {}) {
    this.providers = deps.providers;
    this.now = deps.now ?? (() => new Date());
    this.createRunId = deps.createRunId ?? defaultCreateRunId;
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
    if (!role.defaultReadOnly) {
      throw new Error(`Role ${role.id} is not supported by background read-only runs.`);
    }

    const provider = selectProvider({
      roleId: request.role,
      providers: this.providers ?? listProviders(),
      ...(request.provider === undefined ? {} : { requestedProviderId: request.provider })
    });
    const runId = this.createRunId();
    const createdAt = this.now().toISOString();
    const prompt = buildRolePrompt({ role, task: request.task, cwd: request.cwd });
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
      logPath
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
        cwd: request.cwd,
        workspaceRoot: request.cwd,
        runId,
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
    const cancelled = await transitionRunSidecar(workspaceRoot, runId, (current) => ({
      ...current,
      status: "cancelled",
      updatedAt: this.now().toISOString(),
      cleanup: "partial"
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
        const completed = await transitionRunSidecar(workspaceRoot, runId, (current) =>
          sidecarWithSnapshot(
            {
              ...current,
              status: "completed",
              updatedAt: this.now().toISOString(),
              outputSummary: verdict.summary,
              cleanup: "complete",
              verdict,
              evidencePaths: [
                ...new Set([
                  ...current.evidencePaths,
                  ...(snapshot.logPath === undefined ? [] : [snapshot.logPath]),
                  ...(snapshot.transcriptPath === undefined ? [] : [snapshot.transcriptPath])
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
      const failed = await transitionRunSidecar(workspaceRoot, runId, (current) =>
        sidecarWithSnapshot(
          {
            ...current,
            status: "failed",
            updatedAt: this.now().toISOString(),
            outputSummary: verdict.summary,
            cleanup: "partial",
            verdict
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
