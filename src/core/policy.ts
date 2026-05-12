import { isAbsolute, relative, resolve } from "node:path";
import type {
  AgentExecutionPolicy,
  AgentProviderDescriptor,
  AgentTeamConfig,
  RoleId
} from "./types.js";
import { parseProviderSelector } from "./router.js";

export interface AgentTeamPolicyDecision {
  readonly status: "allowed" | "blocked";
  readonly reason: string;
  readonly details: Record<string, unknown>;
}

function providerFamily(providerId: string): string {
  return providerId.includes(":") ? providerId.split(":")[0]! : providerId;
}

function providerMatchesSelector(
  provider: AgentProviderDescriptor,
  selectorValue: string
): boolean {
  const selector = parseProviderSelector(selectorValue, "request");
  if (selector.kind === "id") {
    return provider.id === selector.target;
  }
  if (selector.kind === "family") {
    return providerFamily(provider.id) === selector.target;
  }
  if (selector.kind === "model") {
    return provider.model === selector.target;
  }
  return provider.capabilities.includes(selector.target as never);
}

function isWithinAllowedRoot(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function allowed(): AgentTeamPolicyDecision {
  return {
    status: "allowed",
    reason: "policy_allowed",
    details: {}
  };
}

function blocked(reason: string, details: Record<string, unknown>): AgentTeamPolicyDecision {
  return {
    status: "blocked",
    reason,
    details
  };
}

export function evaluateStartPolicy(input: {
  readonly config: AgentTeamConfig;
  readonly roleId: RoleId;
  readonly provider: AgentProviderDescriptor;
  readonly requestedProvider?: string;
  readonly executionPolicy: AgentExecutionPolicy;
  readonly plannedWorktreeRoot?: string;
}): AgentTeamPolicyDecision {
  const policy = input.config.policy;
  if (
    policy.allowedRoles.length > 0 &&
    !policy.allowedRoles.includes(input.roleId)
  ) {
    return blocked("role_not_allowed", {
      role: input.roleId,
      allowedRoles: policy.allowedRoles
    });
  }

  if (
    policy.allowedProviderSelectors.length > 0 &&
    !policy.allowedProviderSelectors.some((selector) =>
      providerMatchesSelector(input.provider, selector)
    )
  ) {
    return blocked("provider_not_allowed", {
      provider: input.provider.id,
      allowedProviderSelectors: policy.allowedProviderSelectors,
      ...(input.requestedProvider === undefined ? {} : { requestedProvider: input.requestedProvider })
    });
  }

  if (input.executionPolicy === "isolated-edit" && !policy.allowWriteMode) {
    return blocked("write_mode_not_allowed", {
      role: input.roleId,
      provider: input.provider.id,
      executionPolicy: input.executionPolicy
    });
  }

  if (
    input.executionPolicy === "isolated-edit" &&
    input.plannedWorktreeRoot !== undefined &&
    policy.allowedWorktreeRoots.length > 0 &&
    !policy.allowedWorktreeRoots.some((root) =>
      isWithinAllowedRoot(input.plannedWorktreeRoot!, root)
    )
  ) {
    return blocked("worktree_root_not_allowed", {
      plannedWorktreeRoot: input.plannedWorktreeRoot,
      allowedWorktreeRoots: policy.allowedWorktreeRoots
    });
  }

  return {
    ...allowed(),
    details: {
      role: input.roleId,
      provider: input.provider.id,
      executionPolicy: input.executionPolicy,
      ...(input.requestedProvider === undefined ? {} : { requestedProvider: input.requestedProvider }),
      ...(input.plannedWorktreeRoot === undefined
        ? {}
        : { plannedWorktreeRoot: input.plannedWorktreeRoot })
    }
  };
}
