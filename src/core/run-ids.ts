import { createHash, randomUUID } from "node:crypto";

export function createRunId(now: Date = new Date()): string {
  const timestamp = now.toISOString().replace(/[^0-9]/g, "");
  return `run_${timestamp}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}
