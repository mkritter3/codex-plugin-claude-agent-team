import type { WorkflowConsensusStatus } from "../workflow-types.js";
import { authorityEvidenceSchema, decisionPolicySchema, sameTarget } from "./contract.js";

/** The host attests native identities; MCP cannot inspect a Codex agent's runtime. */
export function evaluateAuthority(policyInput: unknown, evidenceInput: unknown, phase: "planning" | "review", round: number, implementationExecutionId?: string): WorkflowConsensusStatus {
  if (evidenceInput === undefined) throw new Error("Selected decision makers require authority evidence");
  const policy = decisionPolicySchema.parse(policyInput);
  const evidence = authorityEvidenceSchema.parse(evidenceInput);
  const members = new Map(policy.members.map(member => [member.id, member]));
  const seen = new Set<string>();
  const executions = new Set<string>();
  for (const vote of evidence.votes) {
    const member = members.get(vote.memberId);
    if (!member) throw new Error(`Unknown authority member: ${vote.memberId}`);
    if (seen.has(member.id)) throw new Error(`Duplicate authority vote: ${member.id}`);
    seen.add(member.id);
    if (executions.has(vote.execution.id)) throw new Error("Duplicate execution cannot occupy two authority seats");
    executions.add(vote.execution.id);
    if (!sameTarget(member.target, vote.execution.target)) throw new Error(`Authority target differs for ${member.id}`);
    if (vote.artifact !== evidence.artifact) throw new Error(`Stale authority artifact for ${member.id}`);
    if (phase === "review" && (vote.execution.kind === "active-session" || vote.execution.id === implementationExecutionId)) {
      throw new Error("Review requires an independent execution, separate from the implementer and coordinator");
    }
  }
  const unanimous = evidence.votes.length === policy.members.length && evidence.votes.every(vote => vote.status === "approve");
  if (unanimous) return "approved";
  if (round >= 15) return "escalated";
  return evidence.votes.some(vote => vote.status === "block") ? "blocked" : "needs-revision";
}
