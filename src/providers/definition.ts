import type { Capability, ProviderId } from "../domain.js";
import type {
  CredentialSource,
  ProviderConfiguration,
} from "../configuration/types.js";
import type {
  ProviderConfigMap,
  ProviderContext,
  ProviderRequest,
  ProviderResult,
} from "./contract.js";

import type { ProviderCredentialMetadata } from "./metadata.js";
export interface CapabilityDefinition {
  options?: Record<string, unknown>;
  limits?: { maxResults?: number };
  promptGuidelines?: readonly string[];
  /** Whether the entire operation may be repeated after a transient failure. */
  retrySafe: boolean;
}
export type ProviderAdapter<I extends ProviderId> = {
  [C in Capability]?: (
    request: ProviderRequest<C>,
    config: ProviderConfigMap[I],
    context: ProviderContext,
  ) => Promise<ProviderResult<C>>;
};
export interface ProviderDefinitionFor<I extends ProviderId> {
  id: I;
  label: string;
  docsUrl: string;
  local: boolean;
  credentials: readonly ProviderCredentialMetadata[];
  fields: readonly (keyof ProviderConfiguration)[];
  credentialDefaults: Record<string, CredentialSource>;
  defaults: Partial<Record<Capability, Record<string, unknown>>>;
  capabilities: Partial<Record<Capability, CapabilityDefinition>>;
  load(): Promise<ProviderAdapter<I>>;
}
export type ProviderDefinition = {
  [I in ProviderId]: ProviderDefinitionFor<I>;
}[ProviderId];
export function defineProvider<I extends ProviderId>(
  definition: ProviderDefinitionFor<I>,
): ProviderDefinitionFor<I> {
  return freeze(definition);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
