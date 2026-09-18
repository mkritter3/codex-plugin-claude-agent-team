import {
  ProviderAmbiguousSelectorError,
  ProviderCapabilityError,
  ProviderNotFoundError
} from "./errors.js";
import { getRole } from "./roles.js";
import type {
  AgentProviderDescriptor,
  ProviderHealthRecord,
  ProviderCapability,
  ProviderRoutingPolicyConfig,
  ProviderSelectionCandidate,
  ProviderSelectionExplanation,
  ProviderSelectionRequest,
  ProviderSelectionSelector,
  ProviderSelectorKind,
  ProviderSelectorSource
} from "./types.js";
import { isProviderDegraded } from "./provider-health.js";

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

export function parseProviderSelector(
  value: string,
  source: ProviderSelectorSource = "request"
): ProviderSelectionSelector {
  const [prefix, ...rest] = value.split(":");
  const target = rest.join(":");
  if (
    (prefix === "family" || prefix === "model" || prefix === "capability") &&
    target.trim().length > 0
  ) {
    return {
      source,
      value,
      kind: prefix as ProviderSelectorKind,
      target
    };
  }
  return {
    source,
    value,
    kind: "id",
    target: value
  };
}

function providerFamily(providerId: string): string {
  return providerId.includes(":") ? providerId.split(":")[0]! : providerId;
}

function matchesSelector(
  provider: AgentProviderDescriptor,
  selector: ProviderSelectionSelector | undefined
): boolean {
  if (selector === undefined) {
    return true;
  }
  if (selector.kind === "id") {
    return provider.id === selector.target;
  }
  if (selector.kind === "family") {
    return providerFamily(provider.id) === selector.target;
  }
  if (selector.kind === "model") {
    return provider.model === selector.target;
  }
  return provider.capabilities.includes(selector.target as ProviderCapability);
}

function selectorForRequest(
  request: ProviderSelectionRequest
): ProviderSelectionSelector | undefined {
  if (request.requestedProviderId !== undefined) {
    return parseProviderSelector(request.requestedProviderId, "request");
  }
  const rolePin = request.routingPolicy?.rolePins[request.roleId];
  if (rolePin !== undefined) {
    return parseProviderSelector(rolePin, "role-pin");
  }
  return undefined;
}

function orderedProviders(input: {
  readonly providers: readonly AgentProviderDescriptor[];
  readonly routingPolicy?: ProviderRoutingPolicyConfig | undefined;
}): {
  readonly providers: readonly AgentProviderDescriptor[];
  readonly selector?: ProviderSelectionSelector;
} {
  const providerOrder = input.routingPolicy?.providerOrder ?? [];
  for (const selectorValue of providerOrder) {
    const selector = parseProviderSelector(selectorValue, "provider-order");
    const matched = input.providers.filter((provider) => matchesSelector(provider, selector));
    if (matched.length > 0) {
      const unmatched = input.providers.filter((provider) => !matchesSelector(provider, selector));
      return {
        providers: [...matched, ...unmatched],
        selector
      };
    }
  }
  return { providers: input.providers };
}

function candidateFor(input: {
  readonly provider: AgentProviderDescriptor;
  readonly required: readonly ProviderCapability[];
  readonly selector?: ProviderSelectionSelector | undefined;
  readonly health?: ProviderHealthRecord;
  readonly now?: Date;
}): ProviderSelectionCandidate {
  const matchedSelector = matchesSelector(input.provider, input.selector);
  const selectorAllowsFallback = input.selector?.source === "provider-order";
  const selectorEligible = selectorAllowsFallback || matchedSelector;
  const missing = missingCapabilities(input.provider, input.required);
  const explicitProviderProbe =
    input.selector?.source === "request" &&
    input.selector.kind === "id" &&
    input.selector.target === input.provider.id;
  const degraded = isProviderDegraded(input.health, input.now);
  const eligible =
    input.provider.available &&
    selectorEligible &&
    missing.length === 0 &&
    (!degraded || explicitProviderProbe);
  const rejectionReason = !input.provider.available
    ? "unavailable"
    : !selectorEligible
      ? "selector_mismatch"
      : degraded && !explicitProviderProbe
        ? "degraded"
        : missing.length > 0
          ? "missing_capabilities"
          : undefined;

  return {
    providerId: input.provider.id,
    available: input.provider.available,
    matchedSelector,
    eligible,
    missingCapabilities: missing,
    ...(degraded
      ? {
          degraded: true,
          ...(input.health?.reason === undefined
            ? {}
            : { degradationReason: input.health.reason }),
          ...(input.health?.degradedUntil === undefined
            ? {}
            : { degradedUntil: input.health.degradedUntil })
        }
      : {}),
    ...(rejectionReason === undefined ? {} : { rejectionReason })
  };
}

export function explainProviderSelection(
  request: ProviderSelectionRequest
): ProviderSelectionExplanation {
  const role = getRole(request.roleId);
  const required = uniqueCapabilities([
    ...role.requiredCapabilities,
    ...(request.extraCapabilities ?? [])
  ]);
  const requestSelector = selectorForRequest(request);
  const ordered =
    requestSelector === undefined
      ? orderedProviders({
          providers: request.providers,
          ...(request.routingPolicy === undefined
            ? {}
            : { routingPolicy: request.routingPolicy })
        })
      : { providers: request.providers, selector: requestSelector };
  const selector = requestSelector ?? ordered.selector;
  const healthByProvider = new Map(
    (request.providerHealth ?? []).map((record) => [record.providerId, record])
  );
  const ambiguousModelProviderIds =
    selector?.kind === "model" && selector.source !== "provider-order"
      ? ordered.providers
          .filter((provider) => provider.available && matchesSelector(provider, selector))
          .map((provider) => provider.id)
      : [];
  const ambiguousModelSelector = ambiguousModelProviderIds.length > 1;
  const candidates = ordered.providers.map((provider) => {
    const health = healthByProvider.get(provider.id);
    const candidate = candidateFor({
      provider,
      required,
      selector,
      ...(health === undefined ? {} : { health }),
      ...(request.now === undefined ? {} : { now: request.now })
    });
    if (
      ambiguousModelSelector &&
      candidate.available &&
      candidate.matchedSelector
    ) {
      return {
        ...candidate,
        eligible: false,
        rejectionReason: "ambiguous_model_selector" as const
      };
    }
    return candidate;
  });
  const selectedCandidate = candidates.find((candidate) => candidate.eligible);
  const selectedProvider =
    selectedCandidate === undefined
      ? undefined
      : request.providers.find((provider) => provider.id === selectedCandidate.providerId);

  return {
    ok: selectedProvider !== undefined,
    requiredCapabilities: required,
    ...(selector === undefined ? {} : { selector }),
    ...(selectedProvider === undefined
      ? {}
      : {
          selectedProvider,
          selectedProviderId: selectedProvider.id
        }),
    candidates
  };
}

export function selectProvider(
  request: ProviderSelectionRequest
): AgentProviderDescriptor {
  const explanation = explainProviderSelection(request);
  if (explanation.selectedProvider !== undefined) {
    return explanation.selectedProvider;
  }

  const selector = explanation.selector;
  const ambiguousProviderIds = explanation.candidates
    .filter((candidate) => candidate.rejectionReason === "ambiguous_model_selector")
    .map((candidate) => candidate.providerId);
  if (selector !== undefined && ambiguousProviderIds.length > 0) {
    throw new ProviderAmbiguousSelectorError({
      selector: selector.value,
      providerIds: ambiguousProviderIds
    });
  }
  if (selector !== undefined) {
    const selectorMatched = explanation.candidates.some(
      (candidate) => candidate.matchedSelector
    );
    if (!selectorMatched) {
      throw new ProviderNotFoundError(selector.value);
    }
    const selectorMatchedAvailable = explanation.candidates.some(
      (candidate) => candidate.matchedSelector && candidate.available
    );
    if (selector.kind === "id" && !selectorMatchedAvailable) {
      throw new ProviderNotFoundError(selector.value);
    }
  }

  const missing = explanation.candidates.find(
    (candidate) =>
      candidate.matchedSelector &&
      candidate.available &&
      candidate.missingCapabilities.length > 0
  )?.missingCapabilities;
  throw new ProviderCapabilityError({
    roleId: request.roleId,
    ...(selector?.kind === "id" ? { providerId: selector.value } : {}),
    missingCapabilities: missing ?? explanation.requiredCapabilities
  });
}
