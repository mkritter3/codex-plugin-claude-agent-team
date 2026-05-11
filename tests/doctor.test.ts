import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.js";

describe("runDoctor", () => {
  it("reports missing Claude CLI without throwing", async () => {
    const report = await runDoctor({
      env: {},
      findExecutable: async () => undefined,
      getVersion: async () => undefined
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "claude-cli")?.status).toBe(
      "fail"
    );
  });

  it("includes subscription auth precedence warnings", async () => {
    const report = await runDoctor({
      env: { ANTHROPIC_API_KEY: "secret" },
      findExecutable: async () => "/usr/local/bin/claude",
      getVersion: async () => "1.0.0"
    });

    expect(report.warnings).toContain(
      "ANTHROPIC_API_KEY is set and may override Claude Code subscription OAuth."
    );
  });
});
