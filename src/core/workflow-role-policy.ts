import type { RoleId } from "./types.js";
import type { WorkflowRiskLevel } from "./workflow-types.js";

export const WORKFLOW_ROLE_SURFACES = [
  "architecture",
  "backend",
  "frontend",
  "ui-ux",
  "visual",
  "browser-flow",
  "security",
  "performance",
  "devops",
  "docs",
  "search"
] as const;

export type WorkflowRoleSurface = (typeof WORKFLOW_ROLE_SURFACES)[number];

export const WORKFLOW_ROLE_COMPLEXITIES = ["low", "medium", "high"] as const;

export type WorkflowRoleComplexity = (typeof WORKFLOW_ROLE_COMPLEXITIES)[number];

export type WorkflowProviderClass =
  | "senior-claude"
  | "codex"
  | "gemini"
  | "junior-ollama";

export type WorkflowModelFamily =
  | "claude-opus"
  | "claude-sonnet"
  | "claude-haiku"
  | "codex-cli"
  | "gemini-cli"
  | "ollama-kimi-k2.6"
  | "ollama-glm-5.1"
  | "ollama-deepseek";

export type WorkflowWorkerAutonomy =
  | "read_only"
  | "full_autonomous"
  | "bounded_junior";

export interface WorkflowRolePolicyInput {
  readonly role: RoleId | "researcher";
  readonly complexity: WorkflowRoleComplexity;
  readonly surface: WorkflowRoleSurface;
  readonly providerClass?: WorkflowProviderClass;
}

export interface WorkflowRolePolicyRecommendation {
  readonly preferredModelFamily: WorkflowModelFamily;
  readonly preferredModelFamilies: readonly WorkflowModelFamily[];
  readonly requiredSeniorReview: boolean;
  readonly seniorSignoffRequired: boolean;
  readonly requiresIsolatedWorktree: boolean;
  readonly maxSliceRisk: WorkflowRiskLevel;
  readonly autonomy: WorkflowWorkerAutonomy;
  readonly defaultSurfaces: readonly WorkflowRoleSurface[];
  readonly rationale: string;
}

const OPUS_ROLES = new Set<WorkflowRolePolicyInput["role"]>([
  "architect",
  "planner",
  "code-reviewer",
  "security-reviewer",
  "integration-engineer"
]);

const EXECUTION_ROLES = new Set<WorkflowRolePolicyInput["role"]>([
  "frontend-engineer",
  "backend-engineer",
  "slice-implementer"
]);

const GEMINI_SURFACES = ["ui-ux", "frontend", "visual", "browser-flow"] as const;

export function recommendRolePolicy(
  input: WorkflowRolePolicyInput
): WorkflowRolePolicyRecommendation {
  if (input.surface === "search" || input.role === "researcher") {
    return recommendation({
      preferredModelFamilies: ["claude-haiku"],
      requiredSeniorReview: false,
      seniorSignoffRequired: false,
      requiresIsolatedWorktree: false,
      maxSliceRisk: "low",
      autonomy: "read_only",
      defaultSurfaces: ["search"],
      rationale: "Search and reconnaissance should default to fast Haiku-class read-only work."
    });
  }

  if (
    OPUS_ROLES.has(input.role) ||
    input.complexity === "high" ||
    input.surface === "architecture" ||
    input.surface === "security"
  ) {
    return recommendation({
      preferredModelFamilies: ["claude-opus"],
      requiredSeniorReview: true,
      seniorSignoffRequired: true,
      requiresIsolatedWorktree: false,
      maxSliceRisk: "high",
      autonomy: "read_only",
      defaultSurfaces: ["architecture", "security"],
      rationale:
        "Planning, high-complexity, review, and security-sensitive work require senior Opus-class reasoning."
    });
  }

  if (input.providerClass === "junior-ollama") {
    return recommendation({
      preferredModelFamilies: [
        "ollama-kimi-k2.6",
        "ollama-glm-5.1",
        "ollama-deepseek"
      ],
      requiredSeniorReview: true,
      seniorSignoffRequired: true,
      requiresIsolatedWorktree: true,
      maxSliceRisk: "medium",
      autonomy: "bounded_junior",
      defaultSurfaces: ["backend", "frontend", "docs"],
      rationale:
        "Ollama-hosted Kimi, GLM, and DeepSeek workers are junior implementers for bounded isolated slices only."
    });
  }

  if (
    input.providerClass === "gemini" ||
    input.surface === "ui-ux" ||
    input.surface === "frontend" ||
    input.surface === "visual" ||
    input.surface === "browser-flow"
  ) {
    return recommendation({
      preferredModelFamilies: ["gemini-cli", "claude-sonnet", "codex-cli"],
      requiredSeniorReview: true,
      seniorSignoffRequired: true,
      requiresIsolatedWorktree: true,
      maxSliceRisk: "medium",
      autonomy: "full_autonomous",
      defaultSurfaces: GEMINI_SURFACES,
      rationale:
        "Gemini CLI is a full autonomous worker, with default preference for UI, UX, frontend, visual, and browser-flow work."
    });
  }

  if (EXECUTION_ROLES.has(input.role) || input.providerClass === "codex") {
    return recommendation({
      preferredModelFamilies: ["claude-sonnet", "codex-cli"],
      requiredSeniorReview: true,
      seniorSignoffRequired: true,
      requiresIsolatedWorktree: true,
      maxSliceRisk: "high",
      autonomy: "full_autonomous",
      defaultSurfaces: ["backend", "frontend", "devops", "performance"],
      rationale:
        "Execution should prefer Sonnet or Codex CLI in retained isolated worktrees with senior sign-off before integration."
    });
  }

  return recommendation({
    preferredModelFamilies: ["claude-sonnet", "codex-cli"],
    requiredSeniorReview: true,
    seniorSignoffRequired: true,
    requiresIsolatedWorktree: false,
    maxSliceRisk: "medium",
    autonomy: "read_only",
    defaultSurfaces: [input.surface],
    rationale:
      "General workflow roles should provide evidence for Codex and senior review before downstream execution."
  });
}

function recommendation(
  input: Omit<WorkflowRolePolicyRecommendation, "preferredModelFamily">
): WorkflowRolePolicyRecommendation {
  return {
    preferredModelFamily: input.preferredModelFamilies[0]!,
    ...input
  };
}
