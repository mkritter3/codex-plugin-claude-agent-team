import { modelTargetSchema, type CoordinatorIdentity, type ModelTarget } from "./contract.js";

export type AssignmentPhase = "planning" | "review" | "implementation";

export function routeAssignment(target: ModelTarget, phase: AssignmentPhase, coordinator?: CoordinatorIdentity) {
  const selected = modelTargetSchema.parse(target);
  if (selected.kind === "provider") return { kind: "provider" as const, provider: selected.provider };
  if (phase !== "review" && coordinator?.source === "runtime" && coordinator.model === selected.model && coordinator.reasoningEffort === selected.reasoningEffort) {
    return { kind: "active-session" as const, sessionId: coordinator.sessionId, model: selected.model, reasoningEffort: selected.reasoningEffort };
  }
  return { kind: "native-agent" as const, model: selected.model, reasoningEffort: selected.reasoningEffort, forkContext: false as const };
}
