import { getMappedProviderForCapability, type ProviderConfigUnion } from "./provider-tools.js";
import { PROVIDER_MAP } from "./providers/index.js";
import type {
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
  explicitOrCwd: ProviderId | string,
  cwd?: string,
) {
  if (cwd === undefined) {
    return resolveProviderForCapability(config, explicitOrCwd, "search");
  }
  return resolveProviderForCapability(
    config,
    explicitOrCwd as ProviderId | undefined,
    cwd,
    "search",
  );
}

export function getEffectiveProviderConfig(
  config: WebProvidersConfig,
  providerId: ProviderId,
): ProviderConfigUnion | undefined {
  return config.providers?.[providerId] as ProviderConfigUnion | undefined;
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
  explicitOrCwd: ProviderId | string | undefined,
  cwdOrCapability: string | ProviderCapability,
  maybeCapability?: ProviderCapability,
) {
  const explicitProvider =
    maybeCapability === undefined
      ? undefined
      : (explicitOrCwd as ProviderId | undefined);
  const cwd =
    maybeCapability === undefined
      ? (explicitOrCwd as string)
      : (cwdOrCapability as string);
  const capability =
    maybeCapability === undefined
      ? (cwdOrCapability as ProviderCapability)
      : maybeCapability;

  const providerId =
    explicitProvider ?? getMappedProviderIdForCapability(config, capability);
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
  const status = provider.getStatus(providerConfig as never, cwd);
  if (!status.available) {
    throw new Error(
      `Provider '${providerId}' is not available: ${status.summary}.`,
    );
  }

  return provider;
}
