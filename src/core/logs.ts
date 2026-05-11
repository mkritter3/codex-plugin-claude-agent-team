import { appendFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface BoundedLogOptions {
  readonly maxBytes: number;
  readonly maxRotatedFiles: number;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function rotate(path: string, maxRotatedFiles: number): Promise<void> {
  if (maxRotatedFiles <= 0) {
    await rm(path, { force: true });
    return;
  }

  await rm(`${path}.${maxRotatedFiles}`, { force: true });
  for (let index = maxRotatedFiles - 1; index >= 1; index -= 1) {
    try {
      await rename(`${path}.${index}`, `${path}.${index + 1}`);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }

  try {
    await rename(path, `${path}.1`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

function fitToBudget(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength <= maxBytes) {
    return text;
  }
  return bytes.subarray(bytes.byteLength - maxBytes).toString("utf8");
}

export async function appendBoundedLog(
  path: string,
  text: string,
  options: BoundedLogOptions
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const incoming = Buffer.byteLength(text, "utf8");
  const currentSize = await fileSize(path);

  if (currentSize > 0 && currentSize + incoming > options.maxBytes) {
    await rotate(path, options.maxRotatedFiles);
  }

  const boundedText = fitToBudget(text, options.maxBytes);
  if (Buffer.byteLength(boundedText, "utf8") >= options.maxBytes) {
    await writeFile(path, boundedText, "utf8");
    return;
  }

  const sizeAfterRotation = await fileSize(path);
  if (sizeAfterRotation + Buffer.byteLength(boundedText, "utf8") > options.maxBytes) {
    await rotate(path, options.maxRotatedFiles);
  }
  await appendFile(path, boundedText, "utf8");
}
