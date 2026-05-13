import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("keeps local ci aligned with typecheck, tests, build, stdio smoke, and package smoke gates", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["smoke:mcp-stdio"]).toBe(
      "node scripts/smoke-mcp-stdio.mjs"
    );
    expect(packageJson.scripts?.["smoke:workflow-orchestrator"]).toBe(
      "node scripts/smoke-workflow-orchestrator.mjs"
    );
    expect(packageJson.scripts?.["smoke:package"]).toBe(
      "node scripts/smoke-package.mjs"
    );
    expect(packageJson.scripts?.["smoke:claude-live"]).toBe(
      "node scripts/live-smoke-claude-team.mjs"
    );
    expect(packageJson.scripts?.["smoke:claude-live-matrix"]).toBe(
      "node scripts/live-smoke-claude-capability-matrix.mjs"
    );
    expect(packageJson.scripts?.["smoke:providers-live"]).toBe(
      "node scripts/live-smoke-readonly-providers.mjs"
    );
    expect(packageJson.scripts?.["smoke:gemini-write"]).toBe(
      "node scripts/live-smoke-gemini-write-validation.mjs"
    );
    expect(packageJson.scripts?.["install:check"]).toBe(
      "node scripts/install-check.mjs"
    );
    expect(packageJson.scripts?.["scan:workflow-guidance"]).toBe(
      "node scripts/invariant-scan-workflow-guidance.mjs"
    );
    expect(packageJson.scripts?.["validate:workflow-fixtures"]).toBe(
      "npm run build && node scripts/validate-workflow-fixtures.mjs"
    );
    expect(packageJson.scripts?.["validate:workflow-live"]).toBe(
      "node scripts/live-validate-agent-team-workflow.mjs"
    );
    expect(packageJson.scripts?.["scan:workflow-validation"]).toBe(
      "node scripts/invariant-scan-workflow-validation.mjs"
    );
    expect(packageJson.scripts?.ci).toBe(
      "npm run typecheck && npm test && npm run build && npm run install:check && npm run smoke:mcp-stdio && npm run smoke:workflow-orchestrator && npm run smoke:package && npm run scan:workflow-guidance && npm run validate:workflow-fixtures && npm run scan:workflow-validation"
    );
    expect(packageJson.scripts?.ci).not.toContain("smoke:claude-live");
    expect(packageJson.scripts?.ci).not.toContain("smoke:claude-live-matrix");
    expect(packageJson.scripts?.ci).not.toContain("smoke:providers-live");
    expect(packageJson.scripts?.ci).not.toContain("smoke:gemini-write");
    expect(packageJson.scripts?.ci).not.toContain("validate:workflow-live");
    const ci = packageJson.scripts?.ci ?? "";
    expect(ci.indexOf("npm run build")).toBeLessThan(
      ci.indexOf("npm run install:check")
    );
    expect(ci.indexOf("npm run install:check")).toBeLessThan(
      ci.indexOf("npm run smoke:mcp-stdio")
    );
    expect(ci.indexOf("npm run smoke:mcp-stdio")).toBeLessThan(
      ci.indexOf("npm run smoke:workflow-orchestrator")
    );
    expect(ci.indexOf("npm run smoke:workflow-orchestrator")).toBeLessThan(
      ci.indexOf("npm run smoke:package")
    );
    expect(ci.indexOf("npm run smoke:package")).toBeLessThan(
      ci.indexOf("npm run scan:workflow-guidance")
    );
    expect(ci.indexOf("npm run scan:workflow-guidance")).toBeLessThan(
      ci.indexOf("npm run validate:workflow-fixtures")
    );
    expect(ci.indexOf("npm run validate:workflow-fixtures")).toBeLessThan(
      ci.indexOf("npm run scan:workflow-validation")
    );
  });

  it("runs the packaged stdio smoke gate in GitHub CI", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8"
    );

    expect(workflow).toContain("- run: npm run ci");
    expect(workflow).not.toContain("- run: npm run typecheck\n      - run: npm test\n      - run: npm run build");
  });
});
