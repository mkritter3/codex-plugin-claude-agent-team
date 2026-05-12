import { StateCorruptionError } from "./errors.js";
import type { StateCorruptionRecoveryInput } from "./state/recovery.js";
import type {
  AgentCancelManyItem,
  AgentCancelManyOk,
  AgentCancelManyRecovered,
  AgentCancelManyRequest,
  AgentCancelManyResult,
  AgentControlResult
} from "./types.js";

export interface CancelManyDependencies {
  readonly cancelRun: (cwd: string, runId: string) => Promise<AgentControlResult>;
  readonly recoverStateCorruption: (
    input: StateCorruptionRecoveryInput
  ) => Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function cancelAgentRuns(
  request: AgentCancelManyRequest,
  deps: CancelManyDependencies
): Promise<AgentCancelManyResult> {
  const results = new Array<AgentCancelManyItem>(request.runs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const run = request.runs[index];
      if (run === undefined) {
        return;
      }

      try {
        const result = await deps.cancelRun(run.cwd, run.runId);
        const ok: AgentCancelManyOk = {
          status: "ok",
          index,
          runId: run.runId,
          cwd: run.cwd,
          ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
          result
        };
        results[index] = ok;
      } catch (error) {
        if (error instanceof StateCorruptionError) {
          try {
            const recovery = await deps.recoverStateCorruption({
              workspaceRoot: run.cwd,
              runId: run.runId,
              operation: "agent_team_cancel_many",
              error
            });
            const recovered: AgentCancelManyRecovered = {
              status: "state_corrupt",
              index,
              runId: run.runId,
              cwd: run.cwd,
              ...(run.correlationId === undefined
                ? {}
                : { correlationId: run.correlationId }),
              recovery
            };
            results[index] = recovered;
          } catch (recoveryError) {
            results[index] = {
              status: "failed",
              index,
              runId: run.runId,
              cwd: run.cwd,
              ...(run.correlationId === undefined
                ? {}
                : { correlationId: run.correlationId }),
              error: `state recovery failed: ${errorMessage(recoveryError)}`
            };
          }
          continue;
        }

        results[index] = {
          status: "failed",
          index,
          runId: run.runId,
          cwd: run.cwd,
          ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
          error: errorMessage(error)
        };
      }
    }
  }

  const workerCount = Math.min(request.concurrency, request.runs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    status: results.some((result) => result.status !== "ok")
      ? "partial_failure"
      : "ok",
    runs: results
  };
}
