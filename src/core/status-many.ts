import { StateCorruptionError } from "./errors.js";
import type { StateCorruptionRecoveryInput } from "./state/recovery.js";
import type {
  AgentStatusManyItem,
  AgentStatusManyOk,
  AgentStatusManyRecovered,
  AgentStatusManyRequest,
  AgentStatusManyResult,
  RunSidecar
} from "./types.js";

export interface StatusManyDependencies {
  readonly getStatus: (cwd: string, runId: string) => Promise<RunSidecar>;
  readonly recoverStateCorruption: (
    input: StateCorruptionRecoveryInput
  ) => Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readAgentStatuses(
  request: AgentStatusManyRequest,
  deps: StatusManyDependencies
): Promise<AgentStatusManyResult> {
  const results = new Array<AgentStatusManyItem>(request.runs.length);
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
        const status = await deps.getStatus(run.cwd, run.runId);
        const ok: AgentStatusManyOk = {
          status: "ok",
          index,
          runId: run.runId,
          cwd: run.cwd,
          ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
          run: status
        };
        results[index] = ok;
      } catch (error) {
        if (error instanceof StateCorruptionError) {
          const recovery = await deps.recoverStateCorruption({
            workspaceRoot: run.cwd,
            runId: run.runId,
            operation: "agent_team_status_many",
            error
          });
          const recovered: AgentStatusManyRecovered = {
            status: "state_corrupt",
            index,
            runId: run.runId,
            cwd: run.cwd,
            ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
            recovery
          };
          results[index] = recovered;
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
