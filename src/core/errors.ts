import type { ProviderCapability, RoleId } from "./types.js";

export class AgentTeamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnknownRoleError extends AgentTeamError {
  constructor(roleId: string) {
    super(`Unknown agent role: ${roleId}`);
  }
}

export class ProviderCapabilityError extends AgentTeamError {
  readonly roleId: RoleId;
  readonly providerId: string | undefined;
  readonly missingCapabilities: readonly ProviderCapability[];

  constructor(input: {
    roleId: RoleId;
    providerId?: string;
    missingCapabilities: readonly ProviderCapability[];
  }) {
    const providerPart =
      input.providerId === undefined ? "No provider" : `Provider ${input.providerId}`;
    super(
      `${providerPart} satisfies role ${input.roleId}; missing capabilities: ${input.missingCapabilities.join(", ")}`
    );
    this.roleId = input.roleId;
    this.providerId = input.providerId;
    this.missingCapabilities = input.missingCapabilities;
  }
}

export class ProviderNotFoundError extends AgentTeamError {
  constructor(providerId: string) {
    super(`Requested provider not found: ${providerId}`);
  }
}

export class StateCorruptionError extends AgentTeamError {
  constructor(message: string) {
    super(message);
  }
}
