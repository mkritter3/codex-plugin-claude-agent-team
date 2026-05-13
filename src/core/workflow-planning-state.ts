import type {
  CodexRationaleCategory,
  WorkflowCodexRationale,
  WorkflowRecord,
  WorkflowSliceState
} from "./workflow-types.js";

export interface InitialSliceStateInput {
  readonly dependencies: readonly string[];
  readonly requestedState?: string;
}

export function deriveInitialSliceState(input: InitialSliceStateInput): WorkflowSliceState {
  if (input.requestedState !== undefined) {
    if (
      input.requestedState !== "planned" &&
      input.requestedState !== "blocked" &&
      input.requestedState !== "ready"
    ) {
      throw new Error("initial slice state must be planned, blocked, or ready");
    }
    return input.requestedState;
  }
  return input.dependencies.length === 0 ? "ready" : "blocked";
}

export function appendCodexRationale(
  record: WorkflowRecord,
  rationale: WorkflowCodexRationale
): WorkflowRecord {
  return {
    ...record,
    updatedAt: rationale.createdAt,
    codexRationale: [...(record.codexRationale ?? []), rationale]
  };
}

const USER_ESCALATION_CATEGORIES = new Set<CodexRationaleCategory>([
  "product-behavior",
  "user-trust",
  "security-risk",
  "provider-cost",
  "release-posture"
]);

export function classifyUserEscalation(category: CodexRationaleCategory): {
  readonly category: CodexRationaleCategory;
  readonly shouldEscalateToUser: boolean;
} {
  return {
    category,
    shouldEscalateToUser: USER_ESCALATION_CATEGORIES.has(category)
  };
}
