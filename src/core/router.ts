import { ProviderCapabilityError, ProviderNotFoundError } from "./errors.js";
import { getRole } from "./roles.js";
import type {
  AgentProviderDescriptor,
  ProviderCapability,
  ProviderSelectionRequest
} from "./types.js";

function uniqueCapabilities(
  capabilities: readonly ProviderCapability[]
): readonly ProviderCapability[] {
  return [...new Set(capabilities)];
}

function missingCapabilities(
  provider: AgentProviderDescriptor,
  required: readonly ProviderCapability[]
): readonly ProviderCapability[] {
  const providerCapabilities = new Set(provider.capabilities);
  return required.filter((capability) => !providerCapabilities.has(capability));
}

export function selectProvider(
  request: ProviderSelectionRequest
): AgentProviderDescriptor {
  const role = getRole(request.roleId);
  const required = uniqueCapabilities([
    ...role.requiredCapabilities,
    ...(request.extraCapabilities ?? [])
  ]);
  const availableProviders = request.providers.filter((provider) => provider.available);

  if (request.requestedProviderId !== undefined) {
    const requested = availableProviders.find(
      (provider) => provider.id === request.requestedProviderId
    );
    if (requested === undefined) {
      throw new ProviderNotFoundError(request.requestedProviderId);
    }
    const missing = missingCapabilities(requested, required);
    if (missing.length > 0) {
      throw new ProviderCapabilityError({
        roleId: request.roleId,
        providerId: requested.id,
        missingCapabilities: missing
      });
    }
    return requested;
  }

  for (const provider of availableProviders) {
    if (missingCapabilities(provider, required).length === 0) {
      return provider;
    }
  }

  throw new ProviderCapabilityError({
    roleId: request.roleId,
    missingCapabilities: required
  });
}
