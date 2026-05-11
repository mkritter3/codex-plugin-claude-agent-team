import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { writeJsonAtomic } from "../../core/state/atomic-json.js";
import { STATE_DIR } from "../../core/state/paths.js";
import {
  buildClaudeAgentDefinitions,
  serializeClaudeAgentDefinitions,
  validateClaudeAgentDefinitions
} from "./agents.js";

export interface ClaudeAgentDefinitionArtifactPaths {
  readonly directoryPath: string;
  readonly agentsPath: string;
  readonly manifestPath: string;
}

export interface ClaudeAgentDefinitionManifest {
  readonly providerId: "claude-code-cli";
  readonly definitionCount: number;
  readonly roleIds: readonly string[];
  readonly definitionsHash: string;
  readonly agentsPath: string;
  readonly manifestPath: string;
}

export type ClaudeAgentDefinitionArtifactAction = "created" | "validated" | "repaired";

export interface ClaudeAgentDefinitionArtifactResult {
  readonly agentsPath: string;
  readonly manifestPath: string;
  readonly manifest: ClaudeAgentDefinitionManifest;
  readonly action: ClaudeAgentDefinitionArtifactAction;
}

export class ClaudeAgentDefinitionArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeAgentDefinitionArtifactError";
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function relativePath(workspaceRoot: string, path: string): string {
  return relative(workspaceRoot, path);
}

export function claudeAgentDefinitionArtifacts(
  workspaceRoot: string
): ClaudeAgentDefinitionArtifactPaths {
  const directoryPath = join(workspaceRoot, STATE_DIR, "providers", "claude");
  return {
    directoryPath,
    agentsPath: join(directoryPath, "agents.json"),
    manifestPath: join(directoryPath, "manifest.json")
  };
}

function manifestFor(input: {
  readonly workspaceRoot: string;
  readonly agentsPath: string;
  readonly manifestPath: string;
  readonly serializedDefinitions: string;
  readonly roleIds: readonly string[];
}): ClaudeAgentDefinitionManifest {
  return {
    providerId: "claude-code-cli",
    definitionCount: input.roleIds.length,
    roleIds: input.roleIds,
    definitionsHash: sha256(input.serializedDefinitions),
    agentsPath: relativePath(input.workspaceRoot, input.agentsPath),
    manifestPath: relativePath(input.workspaceRoot, input.manifestPath)
  };
}

export async function ensureClaudeAgentDefinitionArtifacts(input: {
  readonly workspaceRoot: string;
}): Promise<ClaudeAgentDefinitionArtifactResult> {
  const paths = claudeAgentDefinitionArtifacts(input.workspaceRoot);
  const definitions = buildClaudeAgentDefinitions();
  validateClaudeAgentDefinitions(definitions);
  const serializedDefinitions = serializeClaudeAgentDefinitions(definitions);
  const roleIds = Object.keys(definitions);
  const manifest = manifestFor({
    workspaceRoot: input.workspaceRoot,
    agentsPath: paths.agentsPath,
    manifestPath: paths.manifestPath,
    serializedDefinitions,
    roleIds
  });

  await writeJsonAtomic(paths.agentsPath, definitions);
  await writeJsonAtomic(paths.manifestPath, manifest);

  return {
    agentsPath: paths.agentsPath,
    manifestPath: paths.manifestPath,
    manifest,
    action: "created"
  };
}

function isMissingArtifactError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function validateClaudeAgentDefinitionArtifacts(input: {
  readonly workspaceRoot: string;
}): Promise<ClaudeAgentDefinitionArtifactResult> {
  const paths = claudeAgentDefinitionArtifacts(input.workspaceRoot);
  const manifest = JSON.parse(
    await readFile(paths.manifestPath, "utf8")
  ) as ClaudeAgentDefinitionManifest;
  const rawDefinitions = await readFile(paths.agentsPath, "utf8");
  const definitions = JSON.parse(rawDefinitions);
  validateClaudeAgentDefinitions(definitions);
  const serializedDefinitions = serializeClaudeAgentDefinitions(definitions);

  if (sha256(serializedDefinitions) !== manifest.definitionsHash) {
    throw new ClaudeAgentDefinitionArtifactError(
      "Claude agent definition artifact hash mismatch."
    );
  }

  return {
    agentsPath: paths.agentsPath,
    manifestPath: paths.manifestPath,
    manifest,
    action: "validated"
  };
}

export async function ensureValidClaudeAgentDefinitionArtifacts(input: {
  readonly workspaceRoot: string;
}): Promise<ClaudeAgentDefinitionArtifactResult> {
  try {
    return await validateClaudeAgentDefinitionArtifacts(input);
  } catch (error) {
    if (isMissingArtifactError(error)) {
      return ensureClaudeAgentDefinitionArtifacts(input);
    }
    throw error;
  }
}
