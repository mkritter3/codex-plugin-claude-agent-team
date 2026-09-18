export function buildAgyArgs(input: { prompt: string; model?: string; sessionId?: string; write: boolean }): readonly string[] {
  return ["--print", input.prompt, "--output-format", "json",
    ...(input.model === undefined ? [] : ["--model", input.model]),
    ...(input.sessionId === undefined ? [] : ["--conversation", input.sessionId]),
    "--sandbox", "--mode", input.write ? "accept-edits" : "plan"];
}

export function parseAgyResult(stdout: string): { text: string; conversationId?: string } {
  const result: unknown = JSON.parse(stdout);
  if (typeof result !== "object" || result === null) throw new Error("AGY returned invalid JSON output");
  const value = result as Record<string, unknown>;
  if (value.status !== "SUCCESS" || typeof value.response !== "string") throw new Error(`AGY did not complete successfully (${String(value.status)})`);
  if (Array.isArray(value.denied_actions) && value.denied_actions.length > 0) throw new Error("AGY reported denied actions; inspect the retained log before retrying");
  return { text: value.response, ...(typeof value.conversation_id === "string" && value.conversation_id.trim() ? { conversationId: value.conversation_id } : {}) };
}
