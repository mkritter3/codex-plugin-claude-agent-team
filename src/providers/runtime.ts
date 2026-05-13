import type { AgentProviderDescriptor, AgentTeamConfig } from "../core/types.js";
import type {
  ProviderEnvironmentInspection,
  ProviderEnvironmentInspectionInput,
  ProviderHealthCheck,
  ProviderHealthCheckInput,
  ProviderPrintInput,
  ProviderPrintResult,
  ProviderSessionHandle,
  ProviderStartSessionInput
} from "./types.js";
import { claudeCodeCliRuntime } from "./claude-code-cli/runtime.js";
import { isClaudeCodeCliProfileProviderId } from "./claude-code-cli/config.js";
import { openAICompatibleRuntime } from "./openai-compatible/runtime.js";
import { isOllamaCloudProviderId } from "./ollama-cloud/config.js";
import { isOllamaClaudeCodeProviderId } from "./ollama-claude-code/config.js";
import { ollamaClaudeCodeRuntime } from "./ollama-claude-code/runtime.js";
import { isGrokProviderId } from "./grok/config.js";
import { geminiRuntime } from "./gemini/runtime.js";
import { geminiCliRuntime } from "./gemini-cli/runtime.js";
import { codexCliRuntime } from "./codex-cli/runtime.js";

export interface AgentProviderRuntime {
  readonly id: string;
  descriptor(config?: AgentTeamConfig): AgentProviderDescriptor;
  inspectEnvironment(
    input: ProviderEnvironmentInspectionInput
  ): ProviderEnvironmentInspection;
  runPrint(input: ProviderPrintInput): Promise<ProviderPrintResult>;
  startSession(input: ProviderStartSessionInput): ProviderSessionHandle;
  healthCheck(input: ProviderHealthCheckInput): Promise<readonly ProviderHealthCheck[]>;
}

export interface ProviderRuntimeRegistryOptions {
  readonly runtimes?: readonly AgentProviderRuntime[];
}

const DEFAULT_PROVIDER_RUNTIMES = [
  claudeCodeCliRuntime,
  openAICompatibleRuntime,
  ollamaClaudeCodeRuntime,
  geminiRuntime,
  geminiCliRuntime,
  codexCliRuntime
] as const;

export function listProviderRuntimes(
  options: ProviderRuntimeRegistryOptions = {}
): readonly AgentProviderRuntime[] {
  return options.runtimes ?? DEFAULT_PROVIDER_RUNTIMES;
}

export function getProviderRuntime(
  providerId: string,
  options: ProviderRuntimeRegistryOptions = {}
): AgentProviderRuntime | undefined {
  if (isClaudeCodeCliProfileProviderId(providerId)) {
    return getProviderRuntime("claude-code-cli", options);
  }
  if (isOllamaCloudProviderId(providerId) || isGrokProviderId(providerId)) {
    return getProviderRuntime("openai-compatible", options);
  }
  if (isOllamaClaudeCodeProviderId(providerId)) {
    return getProviderRuntime("ollama-claude-code", options);
  }
  return listProviderRuntimes(options).find((runtime) => runtime.id === providerId);
}

export function requireProviderRuntime(
  providerId: string,
  options: ProviderRuntimeRegistryOptions = {}
): AgentProviderRuntime {
  const runtime = getProviderRuntime(providerId, options);
  if (runtime === undefined) {
    throw new Error(`No provider runtime registered for ${providerId}.`);
  }
  return runtime;
}
