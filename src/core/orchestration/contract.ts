import { z } from "zod";

const text = z.string().trim().min(1);
export const nativeTargetSchema = z.strictObject({
  kind: z.literal("native"),
  model: z.enum(["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"]),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"])
}).refine(target => !(["gpt-5.6-luna", "gpt-5.5"].includes(target.model) && target.reasoningEffort === "ultra") && !(target.model === "gpt-5.5" && target.reasoningEffort === "max"), "Unsupported native model/effort combination");

// A provider selector identifies a configured profile, including its model. Routing
// must not silently turn an unavailable profile into a different model.
export const modelTargetSchema = z.union([
  nativeTargetSchema,
  z.strictObject({ kind: z.literal("provider"), provider: text, model: text.optional() })
]);
export type ModelTarget = z.infer<typeof modelTargetSchema>;
export function targetKey(target: ModelTarget): string {
  return target.model === undefined ? `provider:${target.kind === "provider" ? target.provider : ""}` : `model:${target.model.replace(/:cloud$/, "")}`;
}
export function sameTarget(left: ModelTarget, right: ModelTarget): boolean {
  if (left.kind === "native" && right.kind === "native") return left.model === right.model && left.reasoningEffort === right.reasoningEffort;
  return left.kind === "provider" && right.kind === "provider" && left.provider === right.provider && left.model === right.model;
}
export const decisionPolicySchema = z.strictObject({
  members: z.array(z.strictObject({ id: text, target: modelTargetSchema })).min(1).max(8)
}).superRefine((policy, context) => {
  if (new Set(policy.members.map(m => m.id)).size !== policy.members.length || new Set(policy.members.map(m => targetKey(m.target))).size !== policy.members.length) {
    context.addIssue({ code: "custom", message: "Duplicate member or model seat; one model gets one vote" });
  }
});
export type DecisionPolicy = z.infer<typeof decisionPolicySchema>;
export const orchestrationPolicySchema = z.strictObject({
  planning: decisionPolicySchema,
  review: decisionPolicySchema,
  implementation: modelTargetSchema
});
export type OrchestrationPolicy = z.infer<typeof orchestrationPolicySchema>;
export const coordinatorSchema = z.strictObject({
  source: z.enum(["runtime", "unknown"]),
  sessionId: text,
  model: text.optional(),
  reasoningEffort: text.optional()
});
export type CoordinatorIdentity = z.infer<typeof coordinatorSchema>;
export const executionSchema = z.strictObject({
  kind: z.enum(["native-agent", "active-session", "provider-run"]),
  id: text,
  target: modelTargetSchema
}).refine(execution => (execution.kind === "provider-run") === (execution.target.kind === "provider"), "Execution kind must match its target");
export const authorityEvidenceSchema = z.strictObject({
  artifact: text.describe("Immutable plan digest or implementation commit/diff digest reviewed by every member."),
  votes: z.array(z.strictObject({
    memberId: text,
    status: z.enum(["approve", "revise", "block", "abstain", "error"]),
    artifact: text,
    summary: text,
    execution: executionSchema
  })).max(8)
});
export type AuthorityEvidence = z.infer<typeof authorityEvidenceSchema>;
export const nativeImplementationSchema = z.strictObject({
  execution: executionSchema.refine(value => value.kind !== "provider-run", "Use Agent Team lifecycle tools for provider runs"),
  artifact: text,
  summary: text,
  changedFiles: z.array(text),
  testsRun: z.array(text).min(1),
  evidencePaths: z.array(text).min(1),
  worktreePath: text
});
export type NativeImplementation = z.infer<typeof nativeImplementationSchema>;
