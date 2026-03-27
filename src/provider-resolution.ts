import { createDefaultExecutionSettings } from "./execution-policy-defaults.js";
import { getMappedProviderForTool } from "./provider-tools.js";
import { ADAPTERS_BY_ID } from "./providers/index.js";
import type {
  AnyProvider,
  ExecutionSettings,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderId,
  ProviderSetupState,
  Tool,
  WebProviders,
} from "./types.js";

export function supportsTool(
  provider: ProviderAdapter<unknown>,
  tool: Tool,
): boolean {
  return provider.tools.includes(tool);
}

export function resolveSearchProvider(
  config: WebProviders,
  cwd: string,
  explicit?: ProviderId,
) {
  return resolveProviderForTool(config, cwd, "search", explicit);
}

export function getEffectiveSharedSettings(
  config: WebProviders,
): ExecutionSettings {
  return {
    ...createDefaultExecutionSettings(),
    ...(config.settings ?? {}),
  };
}

export function getEffectiveProviderConfig(
  config: WebProviders,
  providerId: ProviderId,
): AnyProvider {
  const defaults = ADAPTERS_BY_ID[providerId].createTemplate() as AnyProvider;
  const overrides = (config.providers?.[providerId] ?? {}) as AnyProvider;
  const providerSettings = mergeExecutionSettings(
    defaults.settings,
    overrides.settings,
  );

  const resolved = {
    ...defaults,
    ...overrides,
    options: mergeNestedObjects(defaults.options, overrides.options),
  } as AnyProvider;

  const effectiveSettings = mergeExecutionSettings(
    config.settings,
    providerSettings,
  );
  if (effectiveSettings) {
    resolved.settings = effectiveSettings;
  } else {
    delete resolved.settings;
  }

  return resolved;
}

function mergeExecutionSettings(
  base: ExecutionSettings | undefined,
  overrides: ExecutionSettings | undefined,
): ExecutionSettings | undefined {
  const merged: ExecutionSettings = {
    requestTimeoutMs: overrides?.requestTimeoutMs ?? base?.requestTimeoutMs,
    retryCount: overrides?.retryCount ?? base?.retryCount,
    retryDelayMs: overrides?.retryDelayMs ?? base?.retryDelayMs,
    researchPollIntervalMs:
      overrides?.researchPollIntervalMs ?? base?.researchPollIntervalMs,
    researchTimeoutMs: overrides?.researchTimeoutMs ?? base?.researchTimeoutMs,
    researchMaxConsecutivePollErrors:
      overrides?.researchMaxConsecutivePollErrors ??
      base?.researchMaxConsecutivePollErrors,
  };

  return Object.values(merged).some((value) => value !== undefined)
    ? merged
    : undefined;
}

function mergeNestedObjects<T>(
  base: T | undefined,
  overrides: T | undefined,
): T | undefined {
  if (base === undefined) {
    return overrides;
  }
  if (overrides === undefined) {
    return base;
  }
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    return overrides;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const baseValue = result[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? mergeNestedObjects(baseValue, value)
        : value;
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getMappedProviderIdForTool(
  config: WebProviders,
  tool: Tool,
): ProviderId | undefined {
  return getMappedProviderForTool(config, tool);
}

export function getProviderCapabilityStatus(
  config: WebProviders,
  cwd: string,
  providerId: ProviderId,
  tool?: Tool,
): ProviderCapabilityStatus {
  const provider = ADAPTERS_BY_ID[providerId];
  return provider.getCapabilityStatus(
    getEffectiveProviderConfig(config, providerId) as never,
    cwd,
    tool,
  );
}

export function isProviderCapabilityReady(
  status: ProviderCapabilityStatus,
): boolean {
  return status.state === "ready";
}

export function getProviderSetupState(
  config: WebProviders,
  providerId: ProviderId,
): ProviderSetupState {
  if (providerId === "claude" || providerId === "codex") {
    return "builtin";
  }

  const providerConfig = config.providers?.[providerId] as
    | Record<string, unknown>
    | undefined;
  if (!providerConfig) {
    return "none";
  }

  if (providerId === "custom") {
    return Object.keys(providerConfig).length > 0 ? "configured" : "none";
  }

  return providerConfig.apiKey !== undefined ? "configured" : "none";
}

export function formatProviderCapabilityStatus(
  status: ProviderCapabilityStatus,
  providerId: ProviderId,
  tool?: Tool,
): string {
  switch (status.state) {
    case "ready":
      return "Ready";
    case "missing_api_key":
      return "Missing API key";
    case "missing_auth":
      return providerId === "claude"
        ? "Missing Claude auth"
        : providerId === "codex"
          ? "Missing Codex auth"
          : "Missing auth";
    case "missing_executable":
      return providerId === "claude"
        ? "Missing Claude Code executable"
        : "Missing executable";
    case "missing_command":
      return tool
        ? `No command configured for ${tool}`
        : "No commands configured";
    case "invalid_config":
      return status.detail;
  }
}

export function resolveProviderForTool(
  config: WebProviders,
  cwd: string,
  tool: Tool,
  explicit?: ProviderId,
) {
  const providerId = explicit ?? getMappedProviderIdForTool(config, tool);
  if (!providerId) {
    throw new Error(
      `No provider is configured for '${tool}'. Run /web-providers to configure tool mappings.`,
    );
  }

  const provider = ADAPTERS_BY_ID[providerId];
  if (!supportsTool(provider, tool)) {
    throw new Error(`Provider '${providerId}' does not support '${tool}'.`);
  }

  const status = getProviderCapabilityStatus(config, cwd, providerId, tool);
  if (!isProviderCapabilityReady(status)) {
    const detail = formatProviderCapabilityStatus(status, providerId, tool);
    const errorDetail =
      detail.length > 0
        ? `${detail.charAt(0).toLowerCase()}${detail.slice(1)}`
        : detail;
    throw new Error(
      `Provider '${providerId}' is not available: ${errorDetail}.`,
    );
  }

  return provider;
}
