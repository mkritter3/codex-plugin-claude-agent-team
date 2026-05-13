import { readFile } from "node:fs/promises";
import {
  evaluateWorkflowValidationScenario,
  summarizeWorkflowValidationResults,
  type WorkflowValidationObservation,
  type WorkflowValidationResult,
  type WorkflowValidationScenario
} from "./workflow-validation.js";

interface WorkflowValidationFixtureScenario {
  readonly scenarioId: string;
  readonly requiredEvidence: readonly WorkflowValidationScenario["requiredEvidence"][number][];
  readonly observations?: readonly WorkflowValidationObservation[];
}

interface WorkflowValidationFixture {
  readonly scenarioId: string;
  readonly requiredEvidence?: readonly WorkflowValidationScenario["requiredEvidence"][number][];
  readonly observations?: readonly WorkflowValidationObservation[];
  readonly scenarios?: readonly WorkflowValidationFixtureScenario[];
}

export interface WorkflowValidationRunResult {
  readonly fixturePath: string;
  readonly status: "passed" | "failed";
  readonly liveProviderCalls: 0;
  readonly claimBoundary: "workflow_mechanics_only";
  readonly results: readonly WorkflowValidationResult[];
  readonly summary: ReturnType<typeof summarizeWorkflowValidationResults>;
}

export async function runWorkflowValidationFixture(
  fixturePath: string
): Promise<WorkflowValidationRunResult> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as WorkflowValidationFixture;
  const scenarios = normalizeFixtureScenarios(fixture);
  const results = scenarios.map(evaluateWorkflowValidationScenario);
  const summary = summarizeWorkflowValidationResults(results);

  return {
    fixturePath,
    status: summary.status,
    liveProviderCalls: 0,
    claimBoundary: "workflow_mechanics_only",
    results,
    summary
  };
}

function normalizeFixtureScenarios(
  fixture: WorkflowValidationFixture
): readonly WorkflowValidationScenario[] {
  if (fixture.scenarios !== undefined) {
    return fixture.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      requiredEvidence: scenario.requiredEvidence,
      observations:
        scenario.observations ??
        scenario.requiredEvidence.map((kind) => ({
          kind,
          ref: `${scenario.scenarioId}_${kind}`
        }))
    }));
  }

  const requiredEvidence = fixture.requiredEvidence ?? [];
  return [
    {
      scenarioId: fixture.scenarioId,
      requiredEvidence,
      observations:
        fixture.observations ??
        requiredEvidence.map((kind) => ({
          kind,
          ref: `${fixture.scenarioId}_${kind}`
        }))
    }
  ];
}
