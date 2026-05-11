import type {
  AgentDispatchRequest,
  AgentParallelStartFailure,
  AgentParallelStartRequest,
  AgentParallelStartResult,
  AgentParallelStartRunResult,
  AgentParallelStartSuccess,
  AgentStartResult
} from "./types.js";

export interface ParallelStartDependencies {
  readonly startRun: (request: AgentDispatchRequest) => Promise<AgentStartResult>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startAgentTeamInParallel(
  request: AgentParallelStartRequest,
  deps: ParallelStartDependencies
): Promise<AgentParallelStartResult> {
  const results = new Array<AgentParallelStartRunResult>(request.runs.length);
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
        const started = await deps.startRun({
          role: run.role,
          task: run.task,
          cwd: run.cwd,
          ...(run.provider === undefined ? {} : { provider: run.provider }),
          ...(run.timeoutMs === undefined ? {} : { timeoutMs: run.timeoutMs })
        });
        const success: AgentParallelStartSuccess = {
          status: "started",
          index,
          ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
          run: started
        };
        results[index] = success;
      } catch (error) {
        const failure: AgentParallelStartFailure = {
          status: "failed",
          index,
          ...(run.correlationId === undefined ? {} : { correlationId: run.correlationId }),
          role: run.role,
          task: run.task,
          error: errorMessage(error)
        };
        results[index] = failure;
      }
    }
  }

  const workerCount = Math.min(request.concurrency, request.runs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    status: results.some((result) => result.status === "failed")
      ? "partial_failure"
      : "started",
    batchId: request.batchId,
    concurrency: request.concurrency,
    runs: results
  };
}
