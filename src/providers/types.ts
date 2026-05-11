export interface ProviderSessionActivity {
  readonly type: "tool_start" | "text" | "result" | "error";
  readonly summary: string;
  readonly timestamp: number;
}

export type ProviderSessionDoneStatus = "completed" | "failed" | "interrupted";

export interface ProviderSessionHandle {
  readonly providerSessionId?: string;
  readonly done: Promise<ProviderSessionDoneStatus>;
  readonly recentActivities: readonly ProviderSessionActivity[];
  readonly currentActivity: ProviderSessionActivity | null;
  readonly lastStderr: readonly string[];
  readonly transcriptPath?: string;
  readonly logPath?: string;
  kill(): void;
  forceKill(): void;
  writeStdin?(data: string): void;
}
