import {
  isProviderToolEnabled,
  type ProviderConfigUnion,
  type ProviderToolId,
} from "./provider-tools.js";
import { PROVIDER_MAP, PROVIDERS } from "./providers/index.js";
import type { ProviderId, WebProvidersConfig } from "./types.js";

const IMPLICIT_PROVIDER_FALLBACKS: readonly ProviderId[] = [
  "codex",
  "claude",
] as const;

export function resolveProviderChoice(
  config: WebProvidersConfig,
  explicit: ProviderId | undefined,
  cwd: string,
) {
  return resolveProviderForCapability(config, explicit, cwd, "search");
}

export function getEffectiveProviderConfig(
  config: WebProvidersConfig,
  providerId: ProviderId,
): ProviderConfigUnion | undefined {
  const configured = config.providers?.[providerId] as
    | ProviderConfigUnion
    | undefined;
  if (configured) {
    return configured;
  }
  if (IMPLICIT_PROVIDER_FALLBACKS.includes(providerId)) {
    return {
      ...PROVIDER_MAP[providerId].createTemplate(),
      enabled: true,
    } as ProviderConfigUnion;
  }
  return undefined;
}

export function resolveProviderForCapability(
  config: WebProvidersConfig,
  explicit: ProviderId | undefined,
  cwd: string,
  capability: ProviderToolId,
) {
  if (explicit) {
    const provider = PROVIDER_MAP[explicit];
    const providerConfig = getEffectiveProviderConfig(config, explicit);
    if (typeof provider[capability] !== "function") {
      throw new Error(
        `Provider '${explicit}' does not support '${capability}'.`,
      );
    }
    if (!isProviderToolEnabled(explicit, providerConfig, capability)) {
      throw new Error(
        `Provider '${explicit}' has '${capability}' disabled in config.`,
      );
    }
    const status = provider.getStatus(providerConfig as never, cwd);
    if (!status.available) {
      throw new Error(
        `Provider '${explicit}' is not available: ${status.summary}.`,
      );
    }
    return provider;
  }

  for (const provider of PROVIDERS) {
    if (typeof provider[capability] !== "function") continue;
    const providerConfig = config.providers?.[provider.id];
    if (providerConfig?.enabled !== true) continue;
    if (
      !isProviderToolEnabled(
        provider.id,
        providerConfig as ProviderConfigUnion | undefined,
        capability,
      )
    ) {
      continue;
    }
    const status = provider.getStatus(providerConfig as never, cwd);
    if (status.available) return provider;
  }

  for (const providerId of IMPLICIT_PROVIDER_FALLBACKS) {
    const provider = PROVIDER_MAP[providerId];
    if (typeof provider[capability] !== "function") continue;
    const providerConfig = getEffectiveProviderConfig(config, provider.id);
    if (!isProviderToolEnabled(provider.id, providerConfig, capability)) {
      continue;
    }
    const status = provider.getStatus(providerConfig as never, cwd);
    if (status.available) return provider;
  }

  throw new Error(
    `No provider is configured for '${capability}'. Run /web-providers to create ~/.pi/agent/web-providers.json.`,
  );
}
