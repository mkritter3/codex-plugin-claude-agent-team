export function isAgyExecutable(executable: string): boolean {
  const name = executable.trim().split(/[\\/]/).at(-1)?.toLowerCase();
  return Boolean(name) && !["gemini", "gemini.exe", "gemini.cmd", "gemini.bat"].includes(name!);
}

export function buildAgyArgs(input: { prompt: string; model?: string; sessionId?: string; write: boolean }): readonly string[] {
  return ["--print", input.prompt, "--output-format", "json",
    ...(input.model === undefined ? [] : ["--model", input.model]),
    ...(input.sessionId === undefined ? [] : ["--conversation", input.sessionId]),
    "--sandbox", "--mode", input.write ? "accept-edits" : "plan"];
}

const MAX_DENIED_ACTIONS = 10;
const MAX_DENIED_ACTION_LENGTH = 400;
const MAX_CONVERSATION_ID_LENGTH = 200;

function deniedActionLabel(value: unknown): string {
  if (typeof value === "string") return value.slice(0, MAX_DENIED_ACTION_LENGTH);
  if (typeof value === "object" && value !== null) {
    const action = (value as Record<string, unknown>).action;
    const displayName = (value as Record<string, unknown>).display_name;
    // AGY's object envelope identifies an action type and display name.  It
    // does not promise that `action` is safe command text, so preserve only
    // bounded identity evidence for operators.
    if (typeof displayName === "string" && typeof action === "string") {
      return `${displayName.slice(0, 200)} (${action.slice(0, 180)})`;
    }
    if (typeof displayName === "string") return displayName.slice(0, MAX_DENIED_ACTION_LENGTH);
    if (typeof action === "string") return action.slice(0, MAX_DENIED_ACTION_LENGTH);
  }
  return "[unparseable denied action]";
}

export interface AgyDecodedResult {
  readonly text?: string;
  readonly conversationId?: string;
  readonly failureEvidence?: {
    readonly reason: string;
    readonly deniedActions?: readonly string[];
    readonly details?: readonly string[];
  };
}

/** Parses complete AGY JSON once, retaining safe metadata even when the outcome failed. */
export function decodeAgyResult(stdout: string): AgyDecodedResult | undefined {
  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof result !== "object" || result === null || Array.isArray(result)) return undefined;
  const value = result as Record<string, unknown>;
  const candidateConversationId = typeof value.conversation_id === "string" ? value.conversation_id.trim() : "";
  const conversationId = candidateConversationId.length > 0 && candidateConversationId.length <= MAX_CONVERSATION_ID_LENGTH
    ? candidateConversationId
    : undefined;
  const deniedActions = Array.isArray(value.denied_actions)
    ? value.denied_actions.slice(0, MAX_DENIED_ACTIONS).map(deniedActionLabel)
    : [];
  if (Array.isArray(value.denied_actions) && value.denied_actions.length > 0) {
    return { ...(conversationId === undefined ? {} : { conversationId }), failureEvidence: { reason: "denied_actions", deniedActions } };
  }
  if (value.status !== "SUCCESS" || typeof value.response !== "string") {
    return {
      ...(conversationId === undefined ? {} : { conversationId }),
      failureEvidence: { reason: "provider_outcome_failed", details: [`status: ${String(value.status).slice(0, 120)}`] }
    };
  }
  return { text: value.response, ...(conversationId === undefined ? {} : { conversationId }) };
}

export function parseAgyResult(stdout: string): { text: string; conversationId?: string } {
  const decoded = decodeAgyResult(stdout);
  if (decoded === undefined) throw new Error("AGY returned invalid JSON output");
  if (decoded.failureEvidence !== undefined || decoded.text === undefined) {
    throw new Error(decoded.failureEvidence?.reason === "denied_actions"
      ? "AGY reported denied actions; inspect the retained log before retrying"
      : "AGY did not complete successfully");
  }
  return { text: decoded.text, ...(decoded.conversationId === undefined ? {} : { conversationId: decoded.conversationId }) };
}
