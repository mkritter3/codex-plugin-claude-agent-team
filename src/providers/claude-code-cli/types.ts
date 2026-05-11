import type { ProviderAuthMode } from "../../core/types.js";

export type ClaudeOutputFormat = "json" | "stream-json";
export type ClaudeInputFormat = "stream-json";
export type ClaudePermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";

export interface ClaudeCommandInput {
  readonly prompt: string;
  readonly cwd: string;
  readonly outputFormat: ClaudeOutputFormat;
  readonly inputFormat?: ClaudeInputFormat;
  readonly sessionId?: string;
  readonly allowedTools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly permissionMode?: ClaudePermissionMode;
  readonly verbose?: boolean;
  readonly bare?: boolean;
  readonly allowBareMode?: boolean;
  readonly excludeDynamicSystemPromptSections?: boolean;
}

export interface ClaudeCommand {
  readonly command: "claude";
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface ClaudeCompletedOutput {
  readonly sessionId?: string;
  readonly text: string;
  readonly raw: unknown;
}

export interface ClaudeEnvironmentInspectionInput {
  readonly authMode: ProviderAuthMode;
  readonly env: NodeJS.ProcessEnv;
}

export interface ClaudeEnvironmentInspection {
  readonly warnings: readonly string[];
}
