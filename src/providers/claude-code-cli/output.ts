import type { ClaudeCompletedOutput } from "./types.js";

interface ClaudeJsonShape {
  readonly session_id?: unknown;
  readonly result?: unknown;
  readonly message?: unknown;
}

export function parseClaudeJsonOutput(raw: string): ClaudeCompletedOutput {
  const parsed = JSON.parse(raw) as ClaudeJsonShape;
  const sessionId =
    typeof parsed.session_id === "string" ? parsed.session_id : undefined;
  const text =
    typeof parsed.result === "string"
      ? parsed.result
      : typeof parsed.message === "string"
        ? parsed.message
        : raw;

  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    text,
    raw: parsed
  };
}

export type ClaudeStreamEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "session"; readonly sessionId: string }
  | { readonly type: "unknown"; readonly raw: unknown };

export function parseClaudeStreamJsonLine(raw: string): ClaudeStreamEvent {
  const parsed = JSON.parse(raw) as {
    readonly type?: unknown;
    readonly session_id?: unknown;
    readonly message?: {
      readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[];
    };
  };

  if (typeof parsed.session_id === "string") {
    return { type: "session", sessionId: parsed.session_id };
  }

  const firstText = parsed.message?.content?.find(
    (item) => item.type === "text" && typeof item.text === "string"
  );
  if (firstText !== undefined && typeof firstText.text === "string") {
    return { type: "text", text: firstText.text };
  }

  return { type: "unknown", raw: parsed };
}
