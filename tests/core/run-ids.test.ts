import { describe, expect, it } from "vitest";
import { createRunId, hashPrompt } from "../../src/core/run-ids.js";

describe("run id helpers", () => {
  it("creates unique run ids with a stable prefix", () => {
    const ids = new Set(
      Array.from({ length: 20 }, () => createRunId(new Date("2026-05-11T00:00:00.000Z")))
    );

    expect(ids.size).toBe(20);
    expect([...ids].every((id) => id.startsWith("run_"))).toBe(true);
  });

  it("hashes prompts stably", () => {
    expect(hashPrompt("review this")).toBe(hashPrompt("review this"));
    expect(hashPrompt("review this")).not.toBe(hashPrompt("review that"));
    expect(hashPrompt("review this")).toMatch(/^[a-f0-9]{64}$/);
  });
});
