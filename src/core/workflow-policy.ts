import { AgentTeamConfigError } from "./errors.js";
import {
  DEFAULT_SENIOR_REVIEW_POLICY,
  SENIOR_REVIEW_MODES,
  type SeniorReviewMode,
  type SeniorReviewPolicyConfig
} from "./workflow-types.js";

const SENIOR_REVIEW_MODE_SET = new Set<string>(SENIOR_REVIEW_MODES);

export interface SeniorReviewEnv {
  readonly AGENT_TEAM_OPUS_PLANNING_REVIEW?: string;
  readonly AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW?: string;
}

function readSeniorReviewMode(
  input: unknown,
  fallback: SeniorReviewMode,
  context: string
): SeniorReviewMode {
  if (input === undefined) {
    return fallback;
  }
  if (typeof input !== "string" || !SENIOR_REVIEW_MODE_SET.has(input)) {
    throw new AgentTeamConfigError(
      `${context} must be one of ${SENIOR_REVIEW_MODES.join(", ")}.`
    );
  }
  return input as SeniorReviewMode;
}

function objectField(input: unknown, key: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return {};
  }
  const value = input[key as keyof typeof input];
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function parseSeniorReviewPolicyConfig(
  parsed: unknown,
  env: SeniorReviewEnv = process.env
): SeniorReviewPolicyConfig {
  const seniorReview = objectField(parsed, "seniorReview");
  const opusPlanning = objectField(seniorReview, "opusPlanning");
  const opusImplementation = objectField(seniorReview, "opusImplementation");

  const envPlanning = readSeniorReviewMode(
    env.AGENT_TEAM_OPUS_PLANNING_REVIEW,
    DEFAULT_SENIOR_REVIEW_POLICY.opusPlanning.mode,
    "AGENT_TEAM_OPUS_PLANNING_REVIEW"
  );
  const envImplementation = readSeniorReviewMode(
    env.AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW,
    DEFAULT_SENIOR_REVIEW_POLICY.opusImplementation.mode,
    "AGENT_TEAM_OPUS_IMPLEMENTATION_REVIEW"
  );

  return {
    opusPlanning: {
      mode: readSeniorReviewMode(
        opusPlanning.mode,
        envPlanning,
        "seniorReview.opusPlanning.mode"
      )
    },
    opusImplementation: {
      mode: readSeniorReviewMode(
        opusImplementation.mode,
        envImplementation,
        "seniorReview.opusImplementation.mode"
      )
    }
  };
}
