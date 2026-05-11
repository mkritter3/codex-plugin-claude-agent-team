import { describe, expect, it } from "vitest";
import {
  parseClaudeJsonOutput,
  parseClaudeStreamJsonLine
} from "../../../src/providers/claude-code-cli/output.js";

describe("Claude output parsing", () => {
  it("normalizes completed json output", () => {
    const parsed = parseClaudeJsonOutput(
      JSON.stringify({
        session_id: "session_123",
        result: "Done",
        total_cost_usd: 0
      })
    );

    expect(parsed.sessionId).toBe("session_123");
    expect(parsed.text).toBe("Done");
  });

  it("normalizes stream json assistant text", () => {
    const parsed = parseClaudeStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hello" }]
        }
      })
    );

    expect(parsed).toEqual({ type: "text", text: "hello" });
  });
});
