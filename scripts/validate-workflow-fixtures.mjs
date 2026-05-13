#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runWorkflowValidationFixture } from "../dist/core/workflow-validation-runner.js";

const fixtures = [
  "tests/fixtures/workflow-validation/simple-production-app.json",
  "tests/fixtures/workflow-validation/failure-modes.json"
];

const results = [];
for (const fixture of fixtures) {
  results.push(await runWorkflowValidationFixture(fixture));
}

const report = {
  generatedAt: new Date().toISOString(),
  claimBoundary: "workflow_mechanics_only",
  liveProviderCalls: 0,
  status: results.every((result) => result.status === "passed") ? "passed" : "failed",
  fixtures: results.map((result) => ({
    fixturePath: result.fixturePath,
    status: result.status,
    summary: result.summary,
    results: result.results.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      status: scenario.status,
      missingEvidence: scenario.missingEvidence,
      failedEvidence: scenario.failedEvidence,
      claimBoundary: scenario.claimBoundary
    }))
  }))
};

const reportPath = resolve(".agent-team/reports/workflow-fixture-validation.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (report.status !== "passed") {
  console.error(`workflow fixture validation failed; report written to ${reportPath}`);
  process.exit(1);
}

console.log(`workflow fixture validation passed; report written to ${reportPath}`);
