import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("keeps local ci aligned with typecheck, tests, and build gates", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.ci).toBe(
      "npm run typecheck && npm test && npm run build"
    );
  });
});
