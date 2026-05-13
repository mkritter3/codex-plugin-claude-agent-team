#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "src/core/workflow-validation.ts",
  "src/core/workflow-validation-runner.ts",
  "scripts/validate-workflow-fixtures.mjs",
  "scripts/live-validate-agent-team-workflow.mjs",
  "docs/superpowers/reports/2026-05-13-agent-team-workflow-validation-methodology.md"
];

const forbidden = [
  /best model/i,
  /provider superiority/i,
  /model intelligence is/i,
  /heuristic score/i,
  /rawProvider/i,
  /rawPayload/i,
  /systemPrompt/i,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
  /OLLAMA_API_KEY/
];

let failed = false;
for (const file of files) {
  const text = readFileSync(resolve(file), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      console.error(`workflow validation invariant failed: ${file} matched ${pattern}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log("workflow validation invariant scan passed");
