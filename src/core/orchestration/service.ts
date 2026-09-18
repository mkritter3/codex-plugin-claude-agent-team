import { isAbsolute } from "node:path";
import { loadAgentTeamConfig } from "../config.js";
import { listProviders } from "../../providers/index.js";
import { evaluateStartPolicy } from "../policy.js";
import type { AgentProviderDescriptor, AgentTeamConfig, RoleId } from "../types.js";
import { readWorkflowRecord, writeWorkflowRecord } from "../state/workflow-store.js";
import { toWorkflowView } from "../workflow-view.js";
import { nativeImplementationSchema, orchestrationPolicySchema, sameTarget, type CoordinatorIdentity, type ModelTarget } from "./contract.js";
import { routeAssignment, type AssignmentPhase } from "./routing.js";

function resolveTarget(target: ModelTarget, config: AgentTeamConfig): ModelTarget {
  if (target.kind === "native") return target;
  const descriptor = listProviders({ config }).find(provider => provider.id === target.provider);
  if (!descriptor || !descriptor.model) throw new Error(`Choose an exact configured provider profile with a model: ${target.provider}`);
  if (target.model !== undefined && descriptor.model !== target.model) throw new Error(`Configured provider model changed for ${target.provider}; do not substitute authority`);
  return { ...target, model: descriptor.model };
}

function assertAssignmentPolicy(config: AgentTeamConfig, target: ModelTarget, role: string, write: boolean, worktreePath?: string): AgentProviderDescriptor {
  const descriptor: AgentProviderDescriptor | undefined = target.kind === "native"
    ? { id: `native:${target.model}`, model: target.model, displayName: target.model, available: true, authMode: "subscription-oauth", capabilities: ["structuredOutput", "tools", "edits", "workspaceIsolation"] }
    : listProviders({ config }).find(provider => provider.id === target.provider);
  if (!descriptor?.available) throw new Error("Selected provider is unavailable; do not silently substitute a different model");
  if (write && target.kind === "provider" && !descriptor.capabilities.includes("edits")) throw new Error("Selected provider has no validated implementation capability");
  const policy = evaluateStartPolicy({ config, roleId: role as RoleId, provider: descriptor, executionPolicy: write ? "isolated-edit" : "read-only", ...(worktreePath === undefined ? {} : { plannedWorktreeRoot: worktreePath }) });
  if (policy.status !== "allowed") throw new Error(`Assignment blocked by workspace policy: ${policy.reason}`);
  return descriptor;
}

export async function configureOrchestration(workspaceRoot: string, workflowId: string, input: unknown, configInput?: AgentTeamConfig) {
  const config = configInput ?? await loadAgentTeamConfig(workspaceRoot);
  const parsed = orchestrationPolicySchema.parse(input);
  const resolveMembers = (members: typeof parsed.planning.members) => members.map(member => ({ ...member, target: resolveTarget(member.target, config) }));
  const policy = orchestrationPolicySchema.parse({ planning: { members: resolveMembers(parsed.planning.members) }, review: { members: resolveMembers(parsed.review.members) }, implementation: resolveTarget(parsed.implementation, config) });
  const record = await readWorkflowRecord(workspaceRoot, workflowId);
  if (record.consensusRounds.length > 0 || record.slices.some(slice => !["planned", "ready", "blocked"].includes(slice.state) || (slice.runIds?.length ?? 0) > 0)) {
    throw new Error("Decision membership is frozen once voting or execution begins; create a new workflow to change authority");
  }
  const updated = { ...record, orchestration: policy, updatedAt: new Date().toISOString() };
  await writeWorkflowRecord(workspaceRoot, updated);
  return { workflow: toWorkflowView(updated) };
}

export async function prepareAssignments(input: {
  workspaceRoot: string; workflowId: string; phase: AssignmentPhase;
  coordinator?: CoordinatorIdentity; sliceId?: string; target?: ModelTarget;
  config?: AgentTeamConfig;
}) {
  const config = input.config ?? await loadAgentTeamConfig(input.workspaceRoot);
  const record = await readWorkflowRecord(input.workspaceRoot, input.workflowId);
  if (!record.orchestration) throw new Error("Configure orchestration before preparing assignments");
  if (input.target !== undefined && input.phase !== "implementation") throw new Error("Only implementation assignments allow a target override; decision membership is fixed");
  const slice = record.slices.find(item => item.sliceId === input.sliceId);
  if (input.phase !== "planning" && !slice) throw new Error("A valid sliceId is required for review or implementation");
  if (input.phase !== "planning" && record.planningStatus !== "approved") throw new Error("Planning authority must approve before execution or review");
  if (input.phase === "implementation" && slice) {
    if (!["planned", "ready", "needs-revision"].includes(slice.state)) throw new Error(`Slice ${slice.sliceId} is ${slice.state}, not ready for assignment`);
    if (slice.dependencies.some(id => !record.slices.some(item => item.sliceId === id && ["approved", "integrated"].includes(item.state)))) throw new Error("Implementation dependencies must be approved first");
  }
  const members = input.phase === "implementation"
    ? [{ id: slice!.sliceId, target: input.target ?? slice?.implementationTarget ?? record.orchestration.implementation }]
    : record.orchestration[input.phase].members;
  const assignments = members.map(member => {
    const target = resolveTarget(member.target, config);
    const role = input.phase === "planning" ? "architect" : input.phase === "review" ? "code-reviewer" : slice!.ownerRole;
    const descriptor = assertAssignmentPolicy(config, target, role, input.phase === "implementation");
    const route = routeAssignment(target, input.phase, input.coordinator);
    const providerTool = input.phase === "implementation" ? "agent_team_start_slices"
      : descriptor.capabilities.includes("sessionResume") && descriptor.capabilities.includes("cancellation") ? "agent_team_start" : "agent_team_dispatch";
    return {
      memberId: member.id,
      target,
      role,
      route: route.kind === "provider" ? { ...route, tool: providerTool } : route,
      context: { goal: record.goal, ...(slice ? { slice } : { slices: record.slices }), ...(input.phase === "review" ? { artifact: slice?.nativeImplementation?.artifact ?? slice?.implementationEvidence?.artifact } : {}) }
    };
  });
  if (input.phase === "implementation") {
    const target = assignments[0]!.target;
    await writeWorkflowRecord(input.workspaceRoot, {
      ...record, updatedAt: new Date().toISOString(),
      slices: record.slices.map(item => item.sliceId === slice!.sliceId ? { ...item, implementationTarget: target } : item)
    });
  }
  return {
    workflowId: record.workflowId, phase: input.phase,
    authority: input.phase === "implementation" ? "implementation-only" : members.length === 1 ? "sole-reviewer" : "unanimous-panel",
    assignments,
    instructions: "Native routes are executed by the host's agent tools; provider routes use Agent Team start/dispatch with the exact configured provider selector. Never silently substitute an unavailable model. Send a bounded goal, scopes, acceptance tests and artifact; return concise evidence. Native identities and artifact digests are host-attested."
  };
}

export async function recordNativeImplementation(workspaceRoot: string, workflowId: string, sliceId: string, input: unknown, configInput?: AgentTeamConfig) {
  const evidence = nativeImplementationSchema.parse(input);
  const record = await readWorkflowRecord(workspaceRoot, workflowId);
  const slice = record.slices.find(item => item.sliceId === sliceId);
  if (!record.orchestration || record.planningStatus !== "approved") throw new Error("Configured planning authority must approve before native implementation");
  if (!slice || !["planned", "ready", "running", "needs-revision"].includes(slice.state)) throw new Error("Native implementation requires a ready or running slice");
  if (!sameTarget(slice.implementationTarget ?? record.orchestration.implementation, evidence.execution.target)) throw new Error("Native implementation target differs from the assignment; prepare an explicit override first");
  if (slice.dependencies.some(id => !record.slices.some(item => item.sliceId === id && ["approved", "integrated"].includes(item.state)))) throw new Error("Implementation dependencies must be approved first");
  if (!isAbsolute(evidence.worktreePath)) throw new Error("A retained absolute worktreePath is required");
  assertAssignmentPolicy(configInput ?? await loadAgentTeamConfig(workspaceRoot), evidence.execution.target, slice.ownerRole, true, evidence.worktreePath);
  const timestamp = new Date().toISOString();
  const updated = {
    ...record, updatedAt: timestamp,
    slices: record.slices.map(item => item.sliceId === sliceId ? {
      ...item, state: "awaiting-review" as const, nativeImplementation: evidence,
      implementationEvidence: {
        recordedAt: timestamp, artifact: evidence.artifact, summary: evidence.summary,
        changedFiles: evidence.changedFiles, testsRun: evidence.testsRun,
        evidencePaths: evidence.evidencePaths, worktreePath: evidence.worktreePath
      }
    } : item)
  };
  await writeWorkflowRecord(workspaceRoot, updated);
  return { workflow: toWorkflowView(updated) };
}
