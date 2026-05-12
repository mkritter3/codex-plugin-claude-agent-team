import { StateCorruptionError } from "./errors.js";
import type { StateCorruptionRecoveryInput } from "./state/recovery.js";
import type {
  AgentMessageManyItem,
  AgentMessageManyOk,
  AgentMessageManyRecovered,
  AgentMessageManyRequest,
  AgentMessageManyResult,
  AgentMessageRequest,
  AgentMessageResult
} from "./types.js";

export interface MessageManyDependencies {
  readonly messageRun: (request: AgentMessageRequest) => Promise<AgentMessageResult>;
  readonly recoverStateCorruption: (
    input: StateCorruptionRecoveryInput
  ) => Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function sendAgentMessages(
  request: AgentMessageManyRequest,
  deps: MessageManyDependencies
): Promise<AgentMessageManyResult> {
  const results = new Array<AgentMessageManyItem>(request.messages.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const message = request.messages[index];
      if (message === undefined) {
        return;
      }

      try {
        const result = await deps.messageRun({
          runId: message.runId,
          cwd: message.cwd,
          message: message.message,
          ...(message.messageType === undefined
            ? {}
            : { messageType: message.messageType }),
          ...(message.correlationId === undefined
            ? {}
            : { correlationId: message.correlationId })
        });
        const ok: AgentMessageManyOk = {
          status: "ok",
          index,
          runId: message.runId,
          cwd: message.cwd,
          ...(message.correlationId === undefined
            ? {}
            : { correlationId: message.correlationId }),
          result
        };
        results[index] = ok;
      } catch (error) {
        if (error instanceof StateCorruptionError) {
          const recovery = await deps.recoverStateCorruption({
            workspaceRoot: message.cwd,
            runId: message.runId,
            operation: "agent_team_message_many",
            error
          });
          const recovered: AgentMessageManyRecovered = {
            status: "state_corrupt",
            index,
            runId: message.runId,
            cwd: message.cwd,
            ...(message.correlationId === undefined
              ? {}
              : { correlationId: message.correlationId }),
            recovery
          };
          results[index] = recovered;
          continue;
        }

        results[index] = {
          status: "failed",
          index,
          runId: message.runId,
          cwd: message.cwd,
          ...(message.correlationId === undefined
            ? {}
            : { correlationId: message.correlationId }),
          error: errorMessage(error)
        };
      }
    }
  }

  const workerCount = Math.min(request.concurrency, request.messages.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    status: results.some((result) => result.status !== "ok")
      ? "partial_failure"
      : "ok",
    messages: results
  };
}
