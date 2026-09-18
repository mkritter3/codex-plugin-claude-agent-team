import { describe, expect, it } from "vitest";
import { orchestrationPolicySchema } from "../../src/core/orchestration/contract.js";
import { routeAssignment } from "../../src/core/orchestration/routing.js";
import { evaluateAuthority } from "../../src/core/orchestration/authority.js";

const astra = { kind: "native", model: "gpt-6-astra", reasoningEffort: "xhigh" } as const;
const members = [
  { id: "astra", target: astra },
  { id: "claude", target: { kind: "provider", provider: "claude-code-cli:fable-5.1" } },
  { id: "gemini", target: { kind: "provider", provider: "agy" } }
] as const;
const coordinator = { source: "runtime", sessionId: "session-main", model: "gpt-6-astra", reasoningEffort: "xhigh" } as const;
const vote = (memberId: string, index: number, status = "approve") => ({
  memberId, status, artifact: "sha256:revision1", summary: "Reviewed this revision",
  execution: { kind: index === 0 ? "native-agent" : "provider-run", id: `review-${index}`, target: members[index]!.target }
});

describe("orchestration routing", () => {
  it("reuses the runtime-confirmed active Astra planning seat", () => {
    expect(routeAssignment(astra, "planning", coordinator)).toMatchObject({ kind: "active-session", sessionId: "session-main" });
  });
  it("uses a native agent from Sol and never guesses an unknown active model", () => {
    for (const current of [undefined, { ...coordinator, model: "gpt-5.6-sol" }, { ...coordinator, source: "unknown" as const }]) {
      expect(routeAssignment(astra, "planning", current)).toMatchObject({ kind: "native-agent", model: "gpt-6-astra", reasoningEffort: "xhigh", forkContext: false });
    }
  });
  it("does not claim xhigh for a lower-effort active session or reuse it for review", () => {
    expect(routeAssignment(astra, "planning", { ...coordinator, reasoningEffort: "high" }).kind).toBe("native-agent");
    expect(routeAssignment(astra, "review", coordinator).kind).toBe("native-agent");
  });
  it("honors a chosen external provider even when the coordinator is Astra", () => {
    expect(routeAssignment(members[1].target, "planning", coordinator)).toMatchObject({ kind: "provider", provider: "claude-code-cli:fable-5.1" });
  });
  it("rejects duplicate model seats and unsupported native effort combinations", () => {
    const policy = { planning: { members }, review: { members: [members[0]] }, implementation: { kind: "native", model: "gpt-5.6-sol", reasoningEffort: "medium" } };
    expect(orchestrationPolicySchema.safeParse(policy).success).toBe(true);
    expect(orchestrationPolicySchema.safeParse({ ...policy, planning: { members: [members[0], { ...members[0], id: "another-astra" }] } }).success).toBe(false);
    expect(orchestrationPolicySchema.safeParse({ ...policy, implementation: { kind: "native", model: "gpt-5.6-luna", reasoningEffort: "ultra" } }).success).toBe(false);
  });
});

describe("decision authority", () => {
  const decide = (votes: unknown[], round = 1) => evaluateAuthority({ members }, { artifact: "sha256:revision1", votes }, "review", round);
  it("lets the sole selected reviewer decide", () => {
    expect(evaluateAuthority({ members: [members[0]] }, { artifact: "sha256:revision1", votes: [vote("astra", 0)] }, "review", 1)).toBe("approved");
  });
  it("requires every panel member's approval of the same revision", () => {
    expect(decide(members.map((m, i) => vote(m.id, i)))).toBe("approved");
    expect(decide([vote("astra", 0)])).toBe("needs-revision");
    for (const status of ["revise", "abstain", "error"]) {
      expect(decide([vote("astra", 0), vote("claude", 1), vote("gemini", 2, status)], 10)).toBe("needs-revision");
    }
    expect(decide([vote("astra", 0), vote("claude", 1), vote("gemini", 2, "block")])).toBe("blocked");
    expect(decide([vote("astra", 0)], 15)).toBe("escalated");
  });
  it("rejects stale votes, substituted models, duplicate votes and shared execution evidence", () => {
    expect(() => decide([{ ...vote("astra", 0), artifact: "old" }])).toThrow(/artifact/);
    expect(() => decide([{ ...vote("astra", 0), execution: vote("claude", 1).execution }])).toThrow(/target/);
    expect(() => decide([vote("astra", 0), vote("astra", 0)])).toThrow(/Duplicate/);
    expect(() => decide([vote("astra", 0), { ...vote("claude", 1), execution: { ...vote("claude", 1).execution, id: "review-0", kind: "native-agent" } }])).toThrow();
  });
  it("requires authority evidence and disallows an active-session self-review", () => {
    expect(() => evaluateAuthority({ members }, undefined, "review", 1)).toThrow(/authority/);
    expect(() => decide([{ ...vote("astra", 0), execution: { ...vote("astra", 0).execution, kind: "active-session" } }])).toThrow(/independent/);
  });
});
