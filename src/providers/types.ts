export interface ProviderSessionActivity {
  readonly type: "tool_start" | "text" | "result" | "error";
  readonly summary: string;
  readonly timestamp: number;
}

export type ProviderSessionDoneStatus = "completed" | "failed" | "interrupted";

export interface ProviderSessionHandle {
  readonly providerSessionId: string | undefined;
  readonly done: Promise<ProviderSessionDoneStatus>;
  readonly recentActivities: readonly ProviderSessionActivity[];
  readonly currentActivity: ProviderSessionActivity | null;
  readonly lastStderr: readonly string[];
  readonly transcriptPath: string | undefined;
  readonly logPath: string | undefined;
  kill(): void;
  forceKill(): void;
  writeStdin?(data: string): void;
  snapshot(): ProviderSessionSnapshot;
}

export interface ProviderSessionSnapshot {
  readonly providerSessionId: string | undefined;
  readonly text: string;
  readonly warnings: readonly string[];
  readonly recentActivities: readonly ProviderSessionActivity[];
  readonly currentActivity: ProviderSessionActivity | null;
  readonly lastStderr: readonly string[];
  readonly transcriptPath: string | undefined;
  readonly logPath: string | undefined;
}
