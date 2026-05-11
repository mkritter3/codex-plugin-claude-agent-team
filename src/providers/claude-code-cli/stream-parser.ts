import type { ProviderSessionActivity } from "../types.js";

export interface ClaudeStreamParserOptions {
  readonly now?: () => number;
  readonly maxActivities?: number;
}

export interface ClaudeStreamParserSnapshot {
  readonly providerSessionId?: string;
  readonly text: string;
  readonly warnings: readonly string[];
  readonly recentActivities: readonly ProviderSessionActivity[];
  readonly currentActivity: ProviderSessionActivity | null;
}

export type ClaudeStreamParseResult =
  | { readonly ok: true; readonly raw: unknown }
  | { readonly ok: false; readonly warning: string };

interface ClaudeStreamShape {
  readonly type?: unknown;
  readonly session_id?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly message?: {
    readonly content?: readonly ClaudeContentBlock[];
  };
}

interface ClaudeContentBlock {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly name?: unknown;
  readonly input?: unknown;
}

export interface ClaudeStreamParser {
  acceptLine(rawLine: string): ClaudeStreamParseResult;
  snapshot(): ClaudeStreamParserSnapshot;
}

function summarize(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value);
}

function toolSummary(block: ClaudeContentBlock): string {
  const name = typeof block.name === "string" ? block.name : "tool";
  if (
    block.input !== null &&
    typeof block.input === "object" &&
    "file_path" in block.input &&
    typeof block.input.file_path === "string"
  ) {
    return `${name} ${block.input.file_path}`;
  }
  return name;
}

export function createClaudeStreamParser(
  options: ClaudeStreamParserOptions = {}
): ClaudeStreamParser {
  const now = options.now ?? Date.now;
  const maxActivities = options.maxActivities ?? 10;
  const textParts: string[] = [];
  const warnings: string[] = [];
  const recentActivities: ProviderSessionActivity[] = [];
  let providerSessionId: string | undefined;
  let currentActivity: ProviderSessionActivity | null = null;

  function pushActivity(activity: ProviderSessionActivity): void {
    recentActivities.push(activity);
    while (recentActivities.length > maxActivities) {
      recentActivities.shift();
    }
    currentActivity = activity;
  }

  return {
    acceptLine(rawLine: string): ClaudeStreamParseResult {
      let parsed: ClaudeStreamShape;
      try {
        parsed = JSON.parse(rawLine) as ClaudeStreamShape;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const warning = `Invalid stream-json line: ${message}`;
        warnings.push(warning);
        return { ok: false, warning };
      }

      if (typeof parsed.session_id === "string") {
        providerSessionId = parsed.session_id;
      }

      const content = parsed.message?.content ?? [];
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
          pushActivity({
            type: "text",
            summary: block.text,
            timestamp: now()
          });
        }
        if (block.type === "tool_use") {
          pushActivity({
            type: "tool_start",
            summary: toolSummary(block),
            timestamp: now()
          });
        }
      }

      if (parsed.type === "result" && typeof parsed.result === "string") {
        textParts.push(parsed.result);
        pushActivity({
          type: "result",
          summary: parsed.result,
          timestamp: now()
        });
      }

      if (parsed.type === "error") {
        pushActivity({
          type: "error",
          summary: summarize(parsed.error),
          timestamp: now()
        });
      }

      return { ok: true, raw: parsed };
    },

    snapshot(): ClaudeStreamParserSnapshot {
      return {
        ...(providerSessionId === undefined ? {} : { providerSessionId }),
        text: textParts.join(""),
        warnings: [...warnings],
        recentActivities: [...recentActivities],
        currentActivity
      };
    }
  };
}
