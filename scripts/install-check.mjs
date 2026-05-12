#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstallPreflightReport } from "./lib/install-preflight.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

function readValue(name, fallback) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

async function main() {
  const packageRoot = resolve(readValue("--package-root", repoRoot));
  const serverName = readValue("--server-name", "agent-team");
  const report = await buildInstallPreflightReport({ packageRoot, serverName });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ready") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
