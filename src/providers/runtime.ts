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

const DEFAULT_PROVIDER_RUNTIMES = [claudeCodeCliRuntime] as const;

export function listProviderRuntimes(
  options: ProviderRuntimeRegistryOptions = {}
): readonly AgentProviderRuntime[] {
  return options.runtimes ?? DEFAULT_PROVIDER_RUNTIMES;
}

export function getProviderRuntime(
  providerId: string,
  options: ProviderRuntimeRegistryOptions = {}
): AgentProviderRuntime | undefined {
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
