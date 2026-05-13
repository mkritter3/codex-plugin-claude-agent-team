import type { ProviderHealthRecord } from "./types.js";

export type ProviderFailureReason =
  | "rate_limited"
  | "timeout"
  | "provider_unavailable"
  | "non_transient";

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

export function classifyProviderFailure(input: {
  readonly stderr?: string;
  readonly stdout?: string;
  readonly exitCode?: number | null;
}): { readonly transient: boolean; readonly reason: ProviderFailureReason } {
  const text = `${input.stderr ?? ""}\n${input.stdout ?? ""}`.toLowerCase();
  if (
    text.includes("rate_limit") ||
    text.includes("rate limit") ||
    text.includes("429")
  ) {
    return { transient: true, reason: "rate_limited" };
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return { transient: true, reason: "timeout" };
  }
  if (
    text.includes("503") ||
    text.includes("temporarily unavailable") ||
    text.includes("provider unavailable") ||
    text.includes("service unavailable")
  ) {
    return { transient: true, reason: "provider_unavailable" };
  }
  return { transient: false, reason: "non_transient" };
}

export function recordProviderFailure(input: {
  readonly providerId: string;
  readonly failure: { readonly stderr?: string; readonly stdout?: string; readonly exitCode?: number | null };
  readonly now: Date;
  readonly previous?: ProviderHealthRecord;
  readonly evidencePath?: string;
  readonly cooldownMs?: number;
}): ProviderHealthRecord {
  const classification = classifyProviderFailure(input.failure);
  const previousEvidence = input.previous?.evidencePaths ?? [];
  const evidencePaths =
    input.evidencePath === undefined
      ? previousEvidence
      : [...previousEvidence, input.evidencePath];
  if (!classification.transient) {
    return {
      providerId: input.providerId,
      status: "healthy",
      reason: classification.reason,
      failureCount: 0,
      updatedAt: input.now.toISOString(),
      evidencePaths
    };
  }
  return {
    providerId: input.providerId,
    status: "degraded",
    reason: classification.reason,
    failureCount: (input.previous?.failureCount ?? 0) + 1,
    updatedAt: input.now.toISOString(),
    degradedUntil: new Date(
      input.now.getTime() + (input.cooldownMs ?? DEFAULT_COOLDOWN_MS)
    ).toISOString(),
    evidencePaths
  };
}

export function isProviderDegraded(
  record: ProviderHealthRecord | undefined,
  now: Date = new Date()
): boolean {
  if (record === undefined || record.status !== "degraded") {
    return false;
  }
  if (record.degradedUntil === undefined) {
    return true;
  }
  return Date.parse(record.degradedUntil) > now.getTime();
}
