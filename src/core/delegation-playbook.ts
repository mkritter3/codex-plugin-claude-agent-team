import type { RoleId } from "./types.js";
import type { WorkflowGuidancePhase } from "./workflow-guidance.js";

export const DELEGATION_WORK_TYPES = [
  "planning",
  "implementation",
  "junior-implementation",
  "ui-ux",
  "search",
  "high-complexity-review",
  "test-hardening",
  "integration",
  "release-docs",
  "debugging"
] as const;

export type DelegationWorkType = (typeof DELEGATION_WORK_TYPES)[number];

export type DelegationSteeringMode =
  | "live_when_supported"
  | "recorded_for_resume"
  | "follow_up_run"
  | "codex_owned";

export type DelegationRiskControl =
  | "read_only_required"
  | "isolated_worktree_required"
  | "bounded_scope_required"
  | "senior_review_required"
  | "codex_integration_required"
  | "no_auto_merge"
  | "no_provider_quality_claims";

export type DelegationUserEscalationCategory =
  | "product"
  | "trust"
  | "cost"
  | "release"
  | "permission"
  | "user_impact";

export interface DelegationRecommendation {
  readonly workType: DelegationWorkType;
  readonly recommendedRoles: readonly RoleId[];
  readonly providerPreferences: readonly string[];
  readonly concurrency: {
    readonly mode: "serial" | "bounded_parallel";
    readonly maxRecommended: number;
  };
  readonly steeringMode: DelegationSteeringMode;
  readonly evidenceRequirements: readonly string[];
  readonly riskControls: readonly DelegationRiskControl[];
  readonly codexOwnedDecisions: readonly string[];
  readonly userEscalationCategories: readonly DelegationUserEscalationCategory[];
  readonly claimBoundary: "routing_guidance_only";
  readonly rationale: string;
}

export interface DelegationRecommendationInput {
  readonly workType: DelegationWorkType;
}

const USER_ESCALATION_CATEGORIES = [
  "product",
  "trust",
  "cost",
  "release",
  "permission",
  "user_impact"
] as const satisfies readonly DelegationUserEscalationCategory[];

const CODEX_OWNED_DECISIONS = [
  "slice decomposition",
  "provider routing under policy",
  "technical implementation approach",
  "merge order",
  "conflict resolution",
  "verification scope"
] as const;

export function recommendDelegation(
  input: DelegationRecommendationInput
): DelegationRecommendation {
  switch (input.workType) {
    case "planning":
      return recommendation({
        workType: "planning",
        recommendedRoles: [
          "architect",
          "planner",
          "test-designer",
          "security-reviewer",
          "performance-reviewer",
          "devops-release-engineer",
          "docs-dx-writer"
        ],
        providerPreferences: ["claude-code-cli:opus"],
        concurrency: { mode: "bounded_parallel", maxRecommended: 6 },
        steeringMode: "codex_owned",
        evidenceRequirements: [
          "goal packet",
          "slice DAG",
          "specialist dissent",
          "Codex rationale",
          "Opus planning sign-off when available"
        ],
        riskControls: ["read_only_required", "senior_review_required", "no_provider_quality_claims"],
        rationale: "Use Opus-backed senior review and specialist dissent before execution."
      });
    case "implementation":
      return recommendation({
        workType: "implementation",
        recommendedRoles: ["slice-implementer", "backend-engineer", "frontend-engineer"],
        providerPreferences: ["claude-code-cli:sonnet", "codex-cli"],
        concurrency: { mode: "bounded_parallel", maxRecommended: 3 },
        steeringMode: "recorded_for_resume",
        evidenceRequirements: [
          "retained worktree path",
          "changed files",
          "tests run",
          "verdict",
          "known risks"
        ],
        riskControls: [
          "isolated_worktree_required",
          "bounded_scope_required",
          "senior_review_required",
          "codex_integration_required",
          "no_auto_merge"
        ],
        rationale: "Use senior implementation workers for bounded slices with reviewable evidence."
      });
    case "junior-implementation":
      return recommendation({
        workType: "junior-implementation",
        recommendedRoles: ["slice-implementer"],
        providerPreferences: [
          "ollama-claude-code:kimi-k2.6",
          "ollama-claude-code:glm-5.1",
          "ollama-claude-code:deepseek-v4-flash"
        ],
        concurrency: { mode: "bounded_parallel", maxRecommended: 2 },
        steeringMode: "follow_up_run",
        evidenceRequirements: [
          "narrow write scope",
          "retained worktree path",
          "changed files",
          "tests run",
          "senior review evidence"
        ],
        riskControls: [
          "isolated_worktree_required",
          "bounded_scope_required",
          "senior_review_required",
          "codex_integration_required",
          "no_auto_merge",
          "no_provider_quality_claims"
        ],
        rationale: "Use junior workers only for contained implementation with mandatory senior review."
      });
    case "ui-ux":
      return recommendation({
        workType: "ui-ux",
        recommendedRoles: ["ui-ux-designer", "frontend-engineer", "ux-product-critic"],
        providerPreferences: ["gemini-cli", "claude-code-cli:sonnet", "codex-cli"],
        concurrency: { mode: "bounded_parallel", maxRecommended: 2 },
        steeringMode: "recorded_for_resume",
        evidenceRequirements: [
          "user-flow acceptance criteria",
          "visual or browser validation plan",
          "changed files",
          "accessibility risks"
        ],
        riskControls: [
          "isolated_worktree_required",
          "bounded_scope_required",
          "senior_review_required",
          "codex_integration_required"
        ],
        rationale: "Prefer Gemini for UI/UX and frontend surfaces when configured and healthy."
      });
    case "search":
      return recommendation({
        workType: "search",
        recommendedRoles: ["planner", "debugger", "docs-dx-writer"],
        providerPreferences: ["claude-code-cli:haiku"],
        concurrency: { mode: "bounded_parallel", maxRecommended: 4 },
        steeringMode: "live_when_supported",
        evidenceRequirements: ["source references", "scope searched", "open questions"],
        riskControls: ["read_only_required", "no_provider_quality_claims"],
        rationale: "Use Haiku for lightweight read-only reconnaissance and summaries."
      });
    case "high-complexity-review":
      return recommendation({
        workType: "high-complexity-review",
        recommendedRoles: ["code-reviewer", "security-reviewer", "debugger"],
        providerPreferences: ["claude-code-cli:opus", "codex-cli"],
        concurrency: { mode: "bounded_parallel", maxRecommended: 3 },
        steeringMode: "codex_owned",
        evidenceRequirements: [
          "diff evidence",
          "test evidence",
          "risk assessment",
          "Codex final sign-off",
          "Opus sign-off when available"
        ],
        riskControls: ["read_only_required", "senior_review_required", "no_auto_merge"],
        rationale: "Use Opus for high-risk dissent and final senior review."
      });
    case "test-hardening":
      return recommendation({
        workType: "test-hardening",
        recommendedRoles: ["test-designer", "test-hardening-engineer", "qa-engineer"],
        providerPreferences: ["claude-code-cli:opus", "claude-code-cli:sonnet", "codex-cli"],
        concurrency: { mode: "bounded_parallel", maxRecommended: 3 },
        steeringMode: "codex_owned",
        evidenceRequirements: [
          "acceptance criteria",
          "failure-mode matrix",
          "focused tests",
          "regression proof"
        ],
        riskControls: ["read_only_required", "senior_review_required"],
        rationale: "Use test specialists to harden practical success criteria before integration."
      });
    case "integration":
      return recommendation({
        workType: "integration",
        recommendedRoles: ["integration-engineer", "code-reviewer"],
        providerPreferences: ["claude-code-cli:opus", "codex-cli"],
        concurrency: { mode: "serial", maxRecommended: 1 },
        steeringMode: "codex_owned",
        evidenceRequirements: [
          "integration queue",
          "conflict risk",
          "focused verification",
          "full final gate"
        ],
        riskControls: ["read_only_required", "codex_integration_required", "no_auto_merge"],
        rationale: "Codex integrates one reviewed slice at a time using queue evidence."
      });
    case "release-docs":
      return recommendation({
        workType: "release-docs",
        recommendedRoles: ["devops-release-engineer", "docs-dx-writer", "qa-engineer"],
        providerPreferences: ["claude-code-cli:sonnet", "codex-cli"],
        concurrency: { mode: "bounded_parallel", maxRecommended: 2 },
        steeringMode: "codex_owned",
        evidenceRequirements: ["install check", "runbook update", "release gate", "known limitations"],
        riskControls: ["read_only_required", "no_provider_quality_claims"],
        rationale: "Use release and docs specialists for operator readiness."
      });
    case "debugging":
      return recommendation({
        workType: "debugging",
        recommendedRoles: ["debugger", "planner", "code-reviewer"],
        providerPreferences: ["claude-code-cli:opus", "claude-code-cli:haiku", "codex-cli"],
        concurrency: { mode: "bounded_parallel", maxRecommended: 2 },
        steeringMode: "recorded_for_resume",
        evidenceRequirements: ["reproduction evidence", "root cause", "fix options", "verification plan"],
        riskControls: ["read_only_required", "senior_review_required"],
        rationale: "Use Opus for hard diagnosis and Haiku for lightweight evidence gathering."
      });
  }
}

export function recommendDelegationForWorkflowPhase(
  phase: WorkflowGuidancePhase
): readonly DelegationRecommendation[] {
  switch (phase) {
    case "brainstorming":
    case "planning":
    case "awaiting_user_plan_approval":
      return [recommendDelegation({ workType: "planning" })];
    case "approved":
    case "executing":
      return [
        recommendDelegation({ workType: "implementation" }),
        recommendDelegation({ workType: "junior-implementation" })
      ];
    case "reviewing":
      return [
        recommendDelegation({ workType: "high-complexity-review" }),
        recommendDelegation({ workType: "test-hardening" })
      ];
    case "awaiting_integration":
    case "integrating":
      return [recommendDelegation({ workType: "integration" })];
    case "validating":
      return [
        recommendDelegation({ workType: "test-hardening" }),
        recommendDelegation({ workType: "release-docs" })
      ];
    case "cleanup_ready":
    case "completed":
      return [recommendDelegation({ workType: "release-docs" })];
    case "escalated":
      return [recommendDelegation({ workType: "planning" })];
    case "blocked":
      return [
        recommendDelegation({ workType: "debugging" }),
        recommendDelegation({ workType: "search" })
      ];
  }
}

function recommendation(
  input: Omit<
    DelegationRecommendation,
    "claimBoundary" | "codexOwnedDecisions" | "userEscalationCategories"
  >
): DelegationRecommendation {
  return {
    ...input,
    codexOwnedDecisions: CODEX_OWNED_DECISIONS,
    userEscalationCategories: USER_ESCALATION_CATEGORIES,
    claimBoundary: "routing_guidance_only"
  };
}
