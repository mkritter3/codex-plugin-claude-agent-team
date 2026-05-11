import { describe, expect, it } from "vitest";
import { createClaudeStreamParser } from "../../../src/providers/claude-code-cli/stream-parser.js";

describe("Claude stream parser", () => {
  it("accumulates assistant text and result chunks", () => {
    const parser = createClaudeStreamParser({ now: () => 42 });

    parser.acceptLine(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "First " }] }
      })
    );
    parser.acceptLine(JSON.stringify({ type: "result", result: "Second" }));

    expect(parser.snapshot().text).toBe("First Second");
    expect(parser.snapshot().recentActivities).toContainEqual({
      type: "text",
      summary: "First ",
      timestamp: 42
    });
  });

  it("extracts session ids when present", () => {
    const parser = createClaudeStreamParser();

    parser.acceptLine(JSON.stringify({ type: "system", session_id: "session_123" }));

    expect(parser.snapshot().providerSessionId).toBe("session_123");
  });

  it("turns tool-use and error events into bounded activities", () => {
    const parser = createClaudeStreamParser({ now: () => 100, maxActivities: 2 });

    parser.acceptLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: { file_path: "package.json" } }
          ]
        }
      })
    );
    parser.acceptLine(JSON.stringify({ type: "error", error: "permission denied" }));
    parser.acceptLine(JSON.stringify({ type: "result", result: "done" }));

    expect(parser.snapshot().recentActivities).toEqual([
      { type: "error", summary: "permission denied", timestamp: 100 },
      { type: "result", summary: "done", timestamp: 100 }
    ]);
    expect(parser.snapshot().currentActivity).toEqual({
      type: "result",
      summary: "done",
      timestamp: 100
    });
  });

  it("records parse warnings for invalid NDJSON without throwing", () => {
    const parser = createClaudeStreamParser();

    const result = parser.acceptLine("not-json");

    expect(result.ok).toBe(false);
    expect(parser.snapshot().warnings).toHaveLength(1);
    expect(parser.snapshot().text).toBe("");
  });

  it("captures explicit structured outbox requests", () => {
    const parser = createClaudeStreamParser();

    parser.acceptLine(
      JSON.stringify({
        type: "agent_team_outbox_request",
        request: {
          id: "ask_1",
          messageType: "clarification_request",
          correlationId: "corr_1",
          createdAt: "2026-05-11T10:00:00.000Z",
          payload: { question: "Which failing test should I inspect first?" }
        }
      })
    );

    expect(parser.snapshot().pendingOutboxRequests).toEqual([
      {
        id: "ask_1",
        messageType: "clarification_request",
        correlationId: "corr_1",
        createdAt: "2026-05-11T10:00:00.000Z",
        payload: { question: "Which failing test should I inspect first?" }
      }
    ]);
  });

  it("does not infer outbox requests from free-form questions", () => {
    const parser = createClaudeStreamParser();

    parser.acceptLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Should I inspect the logs next?" }]
        }
      })
    );

    expect(parser.snapshot().text).toBe("Should I inspect the logs next?");
    expect(parser.snapshot().pendingOutboxRequests).toEqual([]);
  });

  it("warns and ignores malformed structured outbox requests", () => {
    const parser = createClaudeStreamParser();

    parser.acceptLine(
      JSON.stringify({
        type: "agent_team_outbox_request",
        request: {
          id: "",
          messageType: "clarification_request",
          payload: { question: "Missing stable id." }
        }
      })
    );

    expect(parser.snapshot().pendingOutboxRequests).toEqual([]);
    expect(parser.snapshot().warnings).toEqual([
      "Invalid agent_team_outbox_request event."
    ]);
  });
});
