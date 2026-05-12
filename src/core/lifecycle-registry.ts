import { resolve } from "node:path";
import { AgentLifecycleManager } from "./lifecycle.js";
import type { AgentTeamConfig } from "./types.js";

export type CreateLifecycle<TLifecycle> = (config: AgentTeamConfig) => TLifecycle;

export interface LifecycleRegistryDependencies<TLifecycle> {
  readonly createLifecycle?: CreateLifecycle<TLifecycle>;
}

function configIdentity(config: AgentTeamConfig): string {
  return JSON.stringify({
    auth: {
      allowApiKeyFallback: config.auth.allowApiKeyFallback
    },
    routing: config.routing,
    policy: config.policy,
    writeMode: {
      enabled: config.writeMode.enabled,
      requireIsolatedWorktree: config.writeMode.requireIsolatedWorktree
    },
    providers: {
      openaiCompatible: config.providers.openaiCompatible,
      ollamaCloud: config.providers.ollamaCloud,
      grok: config.providers.grok,
      gemini: config.providers.gemini
    }
  });
}

function registryKey(workspaceRoot: string, config: AgentTeamConfig): string {
  return `${resolve(workspaceRoot)}\n${configIdentity(config)}`;
}

export class LifecycleRegistry<TLifecycle = AgentLifecycleManager> {
  private readonly createLifecycle: CreateLifecycle<TLifecycle>;
  private readonly lifecycles = new Map<string, TLifecycle>();

  constructor(deps: LifecycleRegistryDependencies<TLifecycle> = {}) {
    this.createLifecycle =
      deps.createLifecycle ??
      ((config) => new AgentLifecycleManager({ config }) as TLifecycle);
  }

  get(workspaceRoot: string, config: AgentTeamConfig): TLifecycle {
    const key = registryKey(workspaceRoot, config);
    const existing = this.lifecycles.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const lifecycle = this.createLifecycle(config);
    this.lifecycles.set(key, lifecycle);
    return lifecycle;
  }
}

export function createDefaultLifecycleRegistry(): LifecycleRegistry<AgentLifecycleManager> {
  return new LifecycleRegistry<AgentLifecycleManager>({
    createLifecycle: (config) => new AgentLifecycleManager({ config })
  });
}
