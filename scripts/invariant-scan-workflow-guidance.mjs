#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "src/core/workflow-guidance.ts",
  "src/core/workflow-hooks.ts",
  "src/core/workflow-steering-policy.ts",
  "src/core/workflow-role-policy.ts",
  "src/mcp/schemas.ts",
  "src/mcp/tools.ts",
  "scripts/smoke-mcp-stdio.mjs"
];

const forbidden = [
  /internalPrompt/i,
  /rawProviderPayload/i,
  /providerPayload/i,
  /providerSessionId/i,
  /commandArgs/i,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
  /OLLAMA_API_KEY/
];

let failed = false;
for (const file of files) {
  const text = readFileSync(resolve(file), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      console.error(`workflow guidance invariant failed: ${file} matched ${pattern}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log("workflow guidance invariant scan passed");
