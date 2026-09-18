import { z } from "zod";
import { coordinatorSchema, modelTargetSchema, nativeImplementationSchema, orchestrationPolicySchema } from "../core/orchestration/contract.js";
import { configureOrchestration, prepareAssignments, recordNativeImplementation } from "../core/orchestration/service.js";
import { jsonToolResult } from "../utils/json.js";
import type { AgentTeamConfig } from "../core/types.js";

const base = { cwd: z.string().min(1).optional(), workflowId: z.string().regex(/^workflow_[A-Za-z0-9_-]+$/) };
const configure = z.strictObject({ ...base, policy: orchestrationPolicySchema });
const prepare = z.strictObject({ ...base, phase: z.enum(["planning", "review", "implementation"]), coordinator: coordinatorSchema.optional(), sliceId: z.string().min(1).optional(), target: modelTargetSchema.optional() });
const record = z.strictObject({ ...base, sliceId: z.string().min(1), evidence: nativeImplementationSchema });
export const ORCHESTRATION_TOOLS = {
  agent_team_configure_orchestration: { title: "Configure Orchestration", description: "Set the exact planning/review decision makers and implementation default before voting. One member decides; a panel requires unanimous approval. Native Codex and configured provider profiles can be mixed.", inputSchema: configure.shape },
  agent_team_prepare_assignments: { title: "Prepare Assignments", description: "Prepare native, active-session or external-provider assignments. Supply current runtime model/effort to reuse matching active planning; never infer from saved defaults. Reviews always use independent executions. Does not launch models.", inputSchema: prepare.shape },
  agent_team_record_native_implementation: { title: "Record Native Implementation", description: "Record host-attested native implementation evidence in the workflow, ready for the selected authority to review. Retain the worktree; supply the immutable commit/diff digest, changed files and test evidence.", inputSchema: record.shape }
} as const;
export type OrchestrationToolName = keyof typeof ORCHESTRATION_TOOLS;

export async function handleOrchestrationTool(name: OrchestrationToolName, args: Record<string, unknown>, cwd: string, config?: AgentTeamConfig) {
  try {
    if (name === "agent_team_configure_orchestration") {
      const input = configure.parse(args);
      return jsonToolResult(await configureOrchestration(input.cwd ?? cwd, input.workflowId, input.policy, config));
    }
    if (name === "agent_team_prepare_assignments") {
      const input = prepare.parse(args);
      return jsonToolResult(await prepareAssignments({ workspaceRoot: input.cwd ?? cwd, workflowId: input.workflowId, phase: input.phase,
        ...(config === undefined ? {} : { config }),
        ...(input.coordinator === undefined ? {} : { coordinator: input.coordinator }),
        ...(input.sliceId === undefined ? {} : { sliceId: input.sliceId }),
        ...(input.target === undefined ? {} : { target: input.target })
      }));
    }
    const input = record.parse(args);
    return jsonToolResult(await recordNativeImplementation(input.cwd ?? cwd, input.workflowId, input.sliceId, input.evidence, config));
  } catch (error) {
    return { ...jsonToolResult({ error: error instanceof Error ? error.message : String(error) }), isError: true as const };
  }
}
