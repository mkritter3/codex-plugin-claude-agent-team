import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runWorkflowValidationFixture } from "../../src/core/workflow-validation-runner.js";

describe("workflow validation fixtures", () => {
  it("defines a simple production app scenario with review and verification evidence", () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve("tests/fixtures/workflow-validation/simple-production-app.json"),
        "utf8"
      )
    ) as {
      requiredEvidence: readonly string[];
      slices: readonly unknown[];
    };

    expect(fixture.requiredEvidence).toEqual(
      expect.arrayContaining([
        "workflow",
        "approval",
        "slice",
        "review",
        "integration",
        "verification",
        "cleanup",
        "public_sanitization"
      ])
    );
    expect(fixture.slices).toHaveLength(2);
  });

  it("defines failure-mode scenarios for real-world workflow risks", () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve("tests/fixtures/workflow-validation/failure-modes.json"),
        "utf8"
      )
    ) as {
      scenarios: readonly { scenarioId: string }[];
    };

    expect(fixture.scenarios.map((scenario) => scenario.scenarioId)).toEqual(
      expect.arrayContaining([
        "missing-auth",
        "blocked-dependency",
        "conflicting-write-scopes",
        "failed-tests",
        "cleanup-partial-failure"
      ])
    );
  });

  it("runs fixture validation without live provider calls", async () => {
    const result = await runWorkflowValidationFixture(
      "tests/fixtures/workflow-validation/simple-production-app.json"
    );

    expect(result.status).toBe("passed");
    expect(result.liveProviderCalls).toBe(0);
    expect(result.results.every((scenario) => scenario.claimBoundary === "workflow_mechanics_only")).toBe(true);
  });
});
