import {
  getMappedProviderForCapability,
  type ProviderConfigUnion,
} from "./provider-tools.js";
import { PROVIDER_MAP } from "./providers/index.js";
import type {
  ExecutionPolicyDefaults,
  ProviderCapability,
  ProviderId,
  WebProvider,
  WebProvidersConfig,
} from "./types.js";

export function supportsProviderCapability(
  provider: WebProvider<unknown>,
  capability: ProviderCapability,
): boolean {
  return provider.capabilities.includes(capability);
}

export function resolveProviderChoice(
  config: WebProvidersConfig,
  cwd: string,
  explicit?: ProviderId,
) {
  return resolveProviderForCapability(config, cwd, "search", explicit);
}

export function getEffectiveProviderConfig(
  config: WebProvidersConfig,
  providerId: ProviderId,
): ProviderConfigUnion | undefined {
  const providerConfig = config.providers?.[providerId] as
    | ProviderConfigUnion
    | undefined;
  if (!providerConfig) {
    return undefined;
  }

  const mergedPolicy = mergeExecutionPolicyDefaults(
    config.genericSettings,
    providerConfig.policy,
  );
  if (!mergedPolicy) {
    return providerConfig;
  }

  return {
    ...providerConfig,
    policy: mergedPolicy,
  } as ProviderConfigUnion;
}

function mergeExecutionPolicyDefaults(
  shared: WebProvidersConfig["genericSettings"],
  provider: ExecutionPolicyDefaults | undefined,
): ExecutionPolicyDefaults | undefined {
  const merged: ExecutionPolicyDefaults = {
    requestTimeoutMs: provider?.requestTimeoutMs ?? shared?.requestTimeoutMs,
    retryCount: provider?.retryCount ?? shared?.retryCount,
    retryDelayMs: provider?.retryDelayMs ?? shared?.retryDelayMs,
    researchPollIntervalMs:
      provider?.researchPollIntervalMs ?? shared?.researchPollIntervalMs,
    researchTimeoutMs: provider?.researchTimeoutMs ?? shared?.researchTimeoutMs,
    researchMaxConsecutivePollErrors:
      provider?.researchMaxConsecutivePollErrors ??
      shared?.researchMaxConsecutivePollErrors,
  };

  return Object.values(merged).some((value) => value !== undefined)
    ? merged
    : undefined;
}

export function getMappedProviderIdForCapability(
  config: WebProvidersConfig,
  capability: ProviderCapability,
): ProviderId | undefined {
  const providerId = getMappedProviderForCapability(config, capability);
  return providerId === null ? undefined : providerId;
}

export function resolveProviderForCapability(
  config: WebProvidersConfig,
  cwd: string,
  capability: ProviderCapability,
  explicit?: ProviderId,
) {
  const providerId =
    explicit ?? getMappedProviderIdForCapability(config, capability);
  if (!providerId) {
    throw new Error(
      `No provider is configured for '${capability}'. Run /web-providers to configure tool mappings.`,
    );
  }

  const provider = PROVIDER_MAP[providerId];
  if (!supportsProviderCapability(provider, capability)) {
    throw new Error(
      `Provider '${providerId}' does not support '${capability}'.`,
    );
  }

  const providerConfig = getEffectiveProviderConfig(config, providerId);
  const status = provider.getStatus(providerConfig as never, cwd, capability);
  if (!status.available) {
    throw new Error(
      `Provider '${providerId}' is not available: ${status.summary}.`,
    );
  }

  return provider;
}
