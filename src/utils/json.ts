export interface JsonToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, any>;
}

export function jsonToolResult(structuredContent: Record<string, any>): JsonToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}
