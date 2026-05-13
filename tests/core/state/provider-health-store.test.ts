import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  readProviderHealthRecords,
  upsertProviderHealthRecord
} from "../../../src/core/state/provider-health-store.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-team-provider-health-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider health store", () => {
  it("persists and reloads provider health records by provider id", async () => {
    const root = await tempRoot();
    await upsertProviderHealthRecord(root, {
      providerId: "ollama-claude-code:kimi-k2.6",
      status: "degraded",
      reason: "rate_limited",
      failureCount: 1,
      updatedAt: "2026-05-13T10:00:00.000Z",
      degradedUntil: "2026-05-13T10:30:00.000Z",
      evidencePaths: ["/tmp/run.log"]
    });

    await upsertProviderHealthRecord(root, {
      providerId: "gemini-cli",
      status: "healthy",
      reason: "manual_probe_succeeded",
      failureCount: 0,
      updatedAt: "2026-05-13T10:01:00.000Z",
      evidencePaths: []
    });

    await expect(readProviderHealthRecords(root)).resolves.toEqual([
      expect.objectContaining({ providerId: "gemini-cli", status: "healthy" }),
      expect.objectContaining({
        providerId: "ollama-claude-code:kimi-k2.6",
        status: "degraded",
        reason: "rate_limited",
        degradedUntil: "2026-05-13T10:30:00.000Z"
      })
    ]);
  });

  it("returns an empty list when provider health state does not exist yet", async () => {
    await expect(readProviderHealthRecords(await tempRoot())).resolves.toEqual([]);
  });
});
