import { describe, expect, it } from "vitest";
import { formatVerdict, parseVerdict } from "../../src/core/verdict.js";

describe("parseVerdict", () => {
  it("parses a structured SHIP verdict", () => {
    const verdict = parseVerdict(`
Some prelude.
<<<VERDICT>>>
status: SHIP
summary: Ready to ship.
required_changes:
- none
evidence:
- npm test passed
risks:
- low residual risk
<<<END_VERDICT>>>
`);

    expect(verdict.status).toBe("SHIP");
    expect(verdict.summary).toBe("Ready to ship.");
    expect(verdict.requiredChanges).toEqual(["none"]);
    expect(verdict.evidence).toEqual(["npm test passed"]);
    expect(verdict.risks).toEqual(["low residual risk"]);
    expect(verdict.warnings).toEqual([]);
  });

  it("parses REVISE and BLOCKED statuses", () => {
    expect(
      parseVerdict(`<<<VERDICT>>>
status: REVISE
summary: Needs changes.
required_changes:
- add tests
evidence:
- diff lacks coverage
risks:
- regression
<<<END_VERDICT>>>`).status
    ).toBe("REVISE");

    expect(
      parseVerdict(`<<<VERDICT>>>
status: BLOCKED
summary: Missing auth.
required_changes:
- login
evidence:
- claude auth failed
risks:
- cannot run provider
<<<END_VERDICT>>>`).status
    ).toBe("BLOCKED");
  });

  it("rejects lowercase status as inconclusive", () => {
    const verdict = parseVerdict(`<<<VERDICT>>>
status: ship
summary: Looks fine.
required_changes:
- none
evidence:
- tests
risks:
- none
<<<END_VERDICT>>>`);

    expect(verdict.status).toBe("INCONCLUSIVE");
    expect(verdict.warnings).toContain("Unsupported verdict status: ship");
  });

  it("returns inconclusive when the verdict block is missing", () => {
    const raw = "plain model output";
    const verdict = parseVerdict(raw);

    expect(verdict.status).toBe("INCONCLUSIVE");
    expect(verdict.raw).toBe(raw);
    expect(verdict.warnings).toContain("Missing verdict block");
  });

  it("formats verdicts using the shared protocol", () => {
    expect(
      formatVerdict({
        status: "REVISE",
        summary: "Add coverage.",
        requiredChanges: ["cover auth precedence"],
        evidence: ["tests/providers failed"],
        risks: ["silent API billing"],
        warnings: [],
        raw: ""
      })
    ).toContain("status: REVISE");
  });
});
