import type { RunSidecar } from "../types.js";
import { readJsonFile, writeJsonAtomic } from "./atomic-json.js";
import { runSidecarPath } from "./paths.js";

export async function writeRunSidecar(
  workspaceRoot: string,
  sidecar: RunSidecar
): Promise<void> {
  await writeJsonAtomic(runSidecarPath(workspaceRoot, sidecar.runId), sidecar);
}

export async function readRunSidecar(
  workspaceRoot: string,
  runId: string
): Promise<RunSidecar> {
  return readJsonFile<RunSidecar>(runSidecarPath(workspaceRoot, runId));
}
