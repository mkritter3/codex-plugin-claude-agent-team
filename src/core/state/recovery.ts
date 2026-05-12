import type { StateCorruptionError, StateCorruptionKind } from "../errors.js";
import { archiveCorruptStateFile } from "./archive.js";

export type StateRecoveryStatus = "state_corrupt";
export type StateRecoveryAction = "archived" | "unarchived" | "reported";

export interface StateCorruptionRecoveryInput {
  readonly workspaceRoot: string;
  readonly runId?: string;
  readonly operation?: string;
  readonly error: StateCorruptionError;
  readonly now?: () => Date;
}

export interface StateCorruptionRecoveryResult {
  readonly status: StateRecoveryStatus;
  readonly runId?: string;
  readonly operation?: string;
  readonly kind?: StateCorruptionKind;
  readonly originalPath?: string;
  readonly archivePath?: string;
  readonly reasonPath?: string;
  readonly archivedAt?: string;
  readonly recovery: StateRecoveryAction;
  readonly interventionRequired: true;
  readonly message: string;
}

function operationMessage(operation: string | undefined): string {
  return operation === undefined ? "agent state access" : operation;
}

export async function recoverStateCorruption(
  input: StateCorruptionRecoveryInput
): Promise<StateCorruptionRecoveryResult> {
  const operation = operationMessage(input.operation);
  if (input.error.path === undefined || input.error.kind === undefined) {
    return {
      status: "state_corrupt",
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      ...(input.operation === undefined ? {} : { operation: input.operation }),
      recovery: "unarchived",
      interventionRequired: true,
      message: `State corruption detected during ${operation}. User intervention is required. No archive was possible because corruption metadata was incomplete.`
    };
  }

  const archived = await archiveCorruptStateFile({
    workspaceRoot: input.workspaceRoot,
    path: input.error.path,
    kind: input.error.kind,
    reason: `State corruption detected during ${operation}: ${input.error.message}`,
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return {
    status: "state_corrupt",
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.operation === undefined ? {} : { operation: input.operation }),
    kind: archived.kind,
    originalPath: archived.originalPath,
    archivePath: archived.archivePath,
    reasonPath: archived.reasonPath,
    archivedAt: archived.archivedAt,
    recovery: "archived",
    interventionRequired: true,
    message: `State corruption detected during ${operation}. The corrupt ${archived.kind} artifact was archived and user intervention is required.`
  };
}

export function reportStateCorruption(
  input: StateCorruptionRecoveryInput
): StateCorruptionRecoveryResult {
  const operation = operationMessage(input.operation);
  return {
    status: "state_corrupt",
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    ...(input.operation === undefined ? {} : { operation: input.operation }),
    ...(input.error.kind === undefined ? {} : { kind: input.error.kind }),
    ...(input.error.path === undefined ? {} : { originalPath: input.error.path }),
    recovery: "reported",
    interventionRequired: true,
    message: `State corruption detected during ${operation}. The corrupt artifact was left in place for read-only inspection and user intervention is required.`
  };
}
