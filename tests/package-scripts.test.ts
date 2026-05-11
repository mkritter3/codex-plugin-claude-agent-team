import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("keeps local ci aligned with typecheck, tests, build, and packaged stdio smoke gates", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["smoke:mcp-stdio"]).toBe(
      "node scripts/smoke-mcp-stdio.mjs"
    );
    expect(packageJson.scripts?.ci).toBe(
      "npm run typecheck && npm test && npm run build && npm run smoke:mcp-stdio"
    );
    const ci = packageJson.scripts?.ci ?? "";
    expect(ci.indexOf("npm run build")).toBeLessThan(
      ci.indexOf("npm run smoke:mcp-stdio")
    );
  });
});
