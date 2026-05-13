export const STEERING_MODES = [
  "live",
  "recorded_for_resume",
  "follow_up_run",
  "cancel_wind_down",
  "unsupported"
] as const;

export type SteeringMode = (typeof STEERING_MODES)[number];

export type SteeringRunState =
  | "running"
  | "awaiting-input"
  | "winding-down"
  | "terminal"
  | "failed"
  | "cancelled";

export type SteeringIntervention =
  | "mailbox_update"
  | "follow_up"
  | "cancel_or_wind_down";

export interface SteeringInput {
  readonly providerId: string;
  readonly runState: SteeringRunState;
  readonly supportsStdin: boolean;
  readonly supportsSessionResume: boolean;
  readonly supportsCancellation: boolean;
  readonly requestedIntervention?: SteeringIntervention;
}

export interface SteeringDecision {
  readonly mode: SteeringMode;
  readonly canCancel: boolean;
  readonly canWindDown: boolean;
  readonly reason: string;
}

const ACTIVE_RUN_STATES = new Set<SteeringRunState>(["running", "awaiting-input"]);

function canActivelySteer(runState: SteeringRunState): boolean {
  return ACTIVE_RUN_STATES.has(runState);
}

export function deriveSteeringMode(input: SteeringInput): SteeringDecision {
  if (input.runState === "winding-down") {
    return {
      mode: "cancel_wind_down",
      canCancel: false,
      canWindDown: false,
      reason: "Run is already winding down; new guidance should be recorded for follow-up evidence."
    };
  }

  if (!canActivelySteer(input.runState)) {
    return {
      mode: "unsupported",
      canCancel: false,
      canWindDown: false,
      reason: "Run is not in a steerable lifecycle state."
    };
  }

  const canCancel = input.supportsCancellation;
  const canWindDown =
    input.supportsStdin || input.supportsSessionResume || input.supportsCancellation;

  if (input.requestedIntervention === "cancel_or_wind_down" && canWindDown) {
    return {
      mode: "cancel_wind_down",
      canCancel,
      canWindDown,
      reason:
        "Codex can request cancellation or wind-down and then launch a corrected follow-up run with recorded mailbox evidence."
    };
  }

  if (input.supportsStdin) {
    return {
      mode: "live",
      canCancel,
      canWindDown,
      reason: "Provider run has an open live input channel."
    };
  }

  if (input.supportsSessionResume) {
    return {
      mode: "recorded_for_resume",
      canCancel,
      canWindDown,
      reason:
        "Provider can use durable mailbox evidence on resume or follow-up, but this run is not live-stdin steerable."
    };
  }

  if (input.supportsCancellation) {
    return {
      mode: "follow_up_run",
      canCancel,
      canWindDown,
      reason:
        "Provider cannot receive live steering for this run; Codex can cancel or launch a follow-up run with mailbox evidence."
    };
  }

  return {
    mode: "unsupported",
    canCancel: false,
    canWindDown: false,
    reason: "Provider exposes no live steering, resume, or cancellation capability for this run."
  };
}
