import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, relative, sep } from "node:path";
import type { StateCorruptionKind } from "../errors.js";
import { stateRoot } from "./paths.js";

export interface ArchiveCorruptStateFileInput {
  readonly workspaceRoot: string;
  readonly path: string;
  readonly reason: string;
  readonly kind: StateCorruptionKind;
  readonly now?: () => Date;
}

export interface ArchivedCorruptStateFile {
  readonly originalPath: string;
  readonly archivePath: string;
  readonly reasonPath: string;
  readonly reason: string;
  readonly kind: StateCorruptionKind;
  readonly archivedAt: string;
}

function safeRelativePath(workspaceRoot: string, path: string): string {
  const relativePath = relative(workspaceRoot, path);
  const safe = relativePath
    .split(sep)
    .filter((part) => part.length > 0 && part !== "..")
    .join("__");
  return safe.length === 0 ? basename(path) : safe;
}

export async function archiveCorruptStateFile(
  input: ArchiveCorruptStateFileInput
): Promise<ArchivedCorruptStateFile> {
  const archivedAt = (input.now ?? (() => new Date()))().toISOString();
  const archiveDir = `${stateRoot(input.workspaceRoot)}/archive`;
  await mkdir(archiveDir, { recursive: true });

  const baseName = safeRelativePath(input.workspaceRoot, input.path);
  const archivePath = `${archiveDir}/${archivedAt.replaceAll(":", "-")}__${randomUUID()}__${baseName}`;
  await rename(input.path, archivePath);

  const reasonPath = `${archivePath}.reason.json`;
  const archived: ArchivedCorruptStateFile = {
    originalPath: input.path,
    archivePath,
    reasonPath,
    reason: input.reason,
    kind: input.kind,
    archivedAt
  };
  await writeFile(reasonPath, `${JSON.stringify(archived, null, 2)}\n`, "utf8");
  return archived;
}
