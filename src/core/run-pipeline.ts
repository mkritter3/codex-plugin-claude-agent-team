import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderPrintResult, ProviderSessionSnapshot } from "../providers/types.js";
import { appendEventRecord } from "./state/mailbox-store.js";
import { runLogPath } from "./state/paths.js";
import { transitionRunSidecar } from "./state/run-store.js";
import type {
  AgentProviderDescriptor,
  MailboxRecord,
  ParsedVerdict,
  RoleId,
  RunSidecar,
  RunStatus,
  WorkspaceLease
} from "./types.js";

export type TerminalRunStatus = Extract<RunStatus, "completed" | "failed" | "expired">;

export interface BuildRunSidecarInput {
  readonly runId: string;
  readonly role: RoleId;
  readonly provider: AgentProviderDescriptor;
  readonly status: RunStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly evidencePaths?: readonly string[];
  readonly promptHash?: string;
  readonly outputSummary?: string;
  readonly providerSessionId?: string;
  readonly logPath?: string;
  readonly transcriptPath?: string;
  readonly verdict?: ParsedVerdict;
  readonly cleanup?: RunSidecar["cleanup"];
  readonly parentRunId?: string;
  readonly resumedFromRunId?: string;
  readonly resumeSequence?: number;
  readonly workspaceLease?: WorkspaceLease;
  readonly workspaceFields?: Partial<RunSidecar>;
}

export interface AppendRunEventInput {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly role: RoleId;
  readonly provider: string;
  readonly messageType: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt?: string;
  readonly correlationId?: string;
}

export interface CompletionEvidenceAdditions {
  readonly evidencePaths?: readonly string[];
  readonly logPath?: string;
  readonly transcriptPath?: string;
}

export interface FinalizeRunSidecarInput extends CompletionEvidenceAdditions {
  readonly workspaceRoot: string;
  readonly runId: string;
  readonly status: TerminalRunStatus;
  readonly provider: string;
  readonly updatedAt: string;
  readonly verdict: ParsedVerdict;
  readonly cleanup: Exclude<RunSidecar["cleanup"], undefined>;
  readonly outputSummary?: string;
  readonly providerSessionId?: string;
  readonly snapshot?: ProviderSessionSnapshot;
  readonly sidecarPatch?: Partial<RunSidecar>;
  readonly eventPayload: Record<string, unknown>;
  readonly eventCreatedAt?: string;
  readonly eventCorrelationId?: string;
}

export function blockedVerdict(
  summary: string,
  evidence: readonly string[] = []
): ParsedVerdict {
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

export function buildRunSidecar(input: BuildRunSidecarInput): RunSidecar {
  return {
    runId: input.runId,
    role: input.role,
    provider: input.provider.id,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    capabilitiesUsed: input.provider.capabilities,
    evidencePaths: input.evidencePaths ?? [],
    authMode: input.provider.authMode,
    ...(input.promptHash === undefined ? {} : { promptHash: input.promptHash }),
    ...(input.outputSummary === undefined ? {} : { outputSummary: input.outputSummary }),
    ...(input.providerSessionId === undefined
      ? {}
      : { providerSessionId: input.providerSessionId }),
    ...(input.logPath === undefined ? {} : { logPath: input.logPath }),
    ...(input.transcriptPath === undefined ? {} : { transcriptPath: input.transcriptPath }),
    ...(input.verdict === undefined ? {} : { verdict: input.verdict }),
    ...(input.cleanup === undefined ? {} : { cleanup: input.cleanup }),
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
    ...(input.resumedFromRunId === undefined
      ? {}
      : { resumedFromRunId: input.resumedFromRunId }),
    ...(input.resumeSequence === undefined ? {} : { resumeSequence: input.resumeSequence }),
    ...(input.workspaceLease === undefined
      ? {}
      : {
          sourceCwd: input.workspaceLease.sourceCwd,
          executionCwd: input.workspaceLease.executionCwd,
          workspaceBranchName: input.workspaceLease.branchName,
          workspaceBaseRef: input.workspaceLease.baseRef,
          workspaceIsolation: input.workspaceLease.isolation,
          workspaceRetention: input.workspaceLease.retention,
          workspaceCleanup: input.workspaceLease.cleanup
        }),
    ...(input.workspaceFields ?? {})
  };
}

export async function writeProviderPrintLog(
  workspaceRoot: string,
  runId: string,
  result: Pick<ProviderPrintResult, "text" | "stdout" | "stderr">
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

export async function appendRunEvent(input: AppendRunEventInput): Promise<MailboxRecord> {
  return appendEventRecord(input.workspaceRoot, input.runId, {
    role: input.role,
    provider: input.provider,
    messageType: input.messageType,
    correlationId: input.correlationId ?? input.runId,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    payload: input.payload
  });
}

export function sidecarWithSnapshot(
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

export function completionEvidencePaths(
  current: RunSidecar,
  additions: CompletionEvidenceAdditions = {}
): readonly string[] {
  return [
    ...new Set([
      ...current.evidencePaths,
      ...(additions.logPath === undefined ? [] : [additions.logPath]),
      ...(additions.transcriptPath === undefined ? [] : [additions.transcriptPath]),
      ...(additions.evidencePaths ?? [])
    ])
  ];
}

export async function finalizeRunSidecar(
  input: FinalizeRunSidecarInput
): Promise<RunSidecar> {
  const terminal = await transitionRunSidecar(input.workspaceRoot, input.runId, (current) => {
    const logPath = input.logPath ?? input.snapshot?.logPath;
    const transcriptPath = input.transcriptPath ?? input.snapshot?.transcriptPath;
    const evidencePaths = completionEvidencePaths(current, {
      ...(input.evidencePaths === undefined ? {} : { evidencePaths: input.evidencePaths }),
      ...(logPath === undefined ? {} : { logPath }),
      ...(transcriptPath === undefined ? {} : { transcriptPath })
    });
    const base: RunSidecar = {
      ...current,
      ...(input.sidecarPatch ?? {}),
      status: input.status,
      updatedAt: input.updatedAt,
      outputSummary: input.outputSummary ?? input.verdict.summary,
      cleanup: input.cleanup,
      verdict: input.verdict,
      evidencePaths,
      ...(input.providerSessionId === undefined
        ? {}
        : { providerSessionId: input.providerSessionId }),
      ...(logPath === undefined ? {} : { logPath }),
      ...(transcriptPath === undefined ? {} : { transcriptPath })
    };

    return input.snapshot === undefined ? base : sidecarWithSnapshot(base, input.snapshot);
  });

  await appendRunEvent({
    workspaceRoot: input.workspaceRoot,
    runId: input.runId,
    role: terminal.role,
    provider: input.provider,
    messageType: input.status,
    ...(input.eventCreatedAt === undefined ? {} : { createdAt: input.eventCreatedAt }),
    ...(input.eventCorrelationId === undefined
      ? {}
      : { correlationId: input.eventCorrelationId }),
    payload: input.eventPayload
  });

  return terminal;
}
