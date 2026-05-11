import type { ParsedVerdict, VerdictStatus } from "./types.js";

const VERDICT_START = "<<<VERDICT>>>";
const VERDICT_END = "<<<END_VERDICT>>>";
const SUPPORTED_STATUSES = new Set<VerdictStatus>([
  "SHIP",
  "REVISE",
  "BLOCKED",
  "INCONCLUSIVE"
]);

type SectionName = "required_changes" | "evidence" | "risks";

function inconclusive(raw: string, warnings: readonly string[]): ParsedVerdict {
  return {
    status: "INCONCLUSIVE",
    summary: "",
    requiredChanges: [],
    evidence: [],
    risks: [],
    warnings,
    raw
  };
}

function parseList(lines: readonly string[], section: SectionName): readonly string[] {
  const start = lines.findIndex((line) => line.trim() === `${section}:`);
  if (start === -1) {
    return [];
  }

  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (
      trimmed === "required_changes:" ||
      trimmed === "evidence:" ||
      trimmed === "risks:" ||
      trimmed.startsWith("summary:") ||
      trimmed.startsWith("status:")
    ) {
      break;
    }
    if (trimmed.startsWith("- ")) {
      items.push(trimmed.slice(2).trim());
    }
  }
  return items;
}

export function parseVerdict(raw: string): ParsedVerdict {
  const start = raw.indexOf(VERDICT_START);
  const end = raw.indexOf(VERDICT_END);
  if (start === -1 || end === -1 || end <= start) {
    return inconclusive(raw, ["Missing verdict block"]);
  }

  const duplicateStart = raw.indexOf(VERDICT_START, start + VERDICT_START.length);
  if (duplicateStart !== -1 && duplicateStart < end) {
    return inconclusive(raw, ["Multiple verdict blocks are not supported"]);
  }

  const block = raw
    .slice(start + VERDICT_START.length, end)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const statusLine = block.find((line) => line.trim().startsWith("status:"));
  const status = statusLine?.slice("status:".length).trim();
  if (status === undefined || !SUPPORTED_STATUSES.has(status as VerdictStatus)) {
    return inconclusive(raw, [`Unsupported verdict status: ${status ?? "<missing>"}`]);
  }

  const summaryLine = block.find((line) => line.trim().startsWith("summary:"));
  const summary = summaryLine?.slice("summary:".length).trim() ?? "";

  return {
    status: status as VerdictStatus,
    summary,
    requiredChanges: parseList(block, "required_changes"),
    evidence: parseList(block, "evidence"),
    risks: parseList(block, "risks"),
    warnings: [],
    raw
  };
}

export function formatVerdict(verdict: ParsedVerdict): string {
  const list = (items: readonly string[]): string =>
    items.length === 0 ? "- none" : items.map((item) => `- ${item}`).join("\n");

  return [
    VERDICT_START,
    `status: ${verdict.status}`,
    `summary: ${verdict.summary}`,
    "required_changes:",
    list(verdict.requiredChanges),
    "evidence:",
    list(verdict.evidence),
    "risks:",
    list(verdict.risks),
    VERDICT_END
  ].join("\n");
}
