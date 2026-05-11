import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { StateCorruptionError } from "../errors.js";

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StateCorruptionError(`Invalid JSON at ${path}: ${message}`);
  }
}
