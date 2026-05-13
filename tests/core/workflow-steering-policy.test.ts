import { describe, expect, it } from "vitest";
import {
  deriveSteeringMode,
  type SteeringInput
} from "../../src/core/workflow-steering-policy.js";

function steeringInput(overrides: Partial<SteeringInput> = {}): SteeringInput {
  return {
    providerId: "claude-code-cli",
    runState: "running",
    supportsStdin: false,
    supportsSessionResume: false,
    supportsCancellation: false,
    ...overrides
  };
}

describe("deriveSteeringMode", () => {
  it("reports live steering only when the active run has an open input channel", () => {
    expect(
      deriveSteeringMode(
        steeringInput({
          providerId: "claude-code-cli",
          supportsStdin: true,
          supportsSessionResume: true,
          supportsCancellation: true
        })
      )
    ).toEqual({
      mode: "live",
      canCancel: true,
      canWindDown: true,
      reason: "Provider run has an open live input channel."
    });
  });

  it("reports recorded-for-resume for Claude Code when stdin is closed but resume is available", () => {
    expect(
      deriveSteeringMode(
        steeringInput({
          providerId: "claude-code-cli",
          supportsSessionResume: true,
          supportsCancellation: true
        })
      )
    ).toEqual({
      mode: "recorded_for_resume",
      canCancel: true,
      canWindDown: true,
      reason:
        "Provider can use durable mailbox evidence on resume or follow-up, but this run is not live-stdin steerable."
    });
  });

  it("reports follow-up run for Codex CLI when background steering is unavailable", () => {
    expect(
      deriveSteeringMode(
        steeringInput({
          providerId: "codex-cli",
          supportsCancellation: true
        })
      )
    ).toMatchObject({
      mode: "follow_up_run",
      canCancel: true,
      canWindDown: true
    });
  });

  it("reports follow-up run for Gemini CLI autonomous workers without claiming live steering", () => {
    expect(
      deriveSteeringMode(
        steeringInput({
          providerId: "gemini-cli",
          supportsCancellation: true
        })
      )
    ).toMatchObject({
      mode: "follow_up_run",
      canCancel: true,
      canWindDown: true
    });
  });

  it("reports unsupported for OpenAI-compatible and Ollama-like profiles without resume or cancellation", () => {
    expect(
      deriveSteeringMode(
        steeringInput({
          providerId: "openai-compatible",
          supportsStdin: false,
          supportsSessionResume: false,
          supportsCancellation: false
        })
      ).mode
    ).toBe("unsupported");

    expect(
      deriveSteeringMode(
        steeringInput({
          providerId: "ollama-cloud:kimi-k2.6",
          supportsStdin: false,
          supportsSessionResume: false,
          supportsCancellation: false
        })
      ).mode
    ).toBe("unsupported");
  });

  it("reports cancel-or-wind-down mode when Codex asks to stop or replace a running worker", () => {
    expect(
      deriveSteeringMode(
        steeringInput({
          providerId: "codex-cli",
          supportsCancellation: true,
          requestedIntervention: "cancel_or_wind_down"
        })
      )
    ).toEqual({
      mode: "cancel_wind_down",
      canCancel: true,
      canWindDown: true,
      reason:
        "Codex can request cancellation or wind-down and then launch a corrected follow-up run with recorded mailbox evidence."
    });
  });

  it("does not steer terminal or failed runs", () => {
    for (const runState of ["terminal", "failed", "cancelled"] as const) {
      expect(
        deriveSteeringMode(
          steeringInput({
            runState,
            supportsStdin: true,
            supportsSessionResume: true,
            supportsCancellation: true
          })
        )
      ).toEqual({
        mode: "unsupported",
        canCancel: false,
        canWindDown: false,
        reason: "Run is not in a steerable lifecycle state."
      });
    }
  });
});
