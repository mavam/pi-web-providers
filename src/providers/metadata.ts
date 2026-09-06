import type { Capability, ProviderId } from "../domain.js";

export interface ProviderCredentialMetadata {
  name: string;
  environmentVariable: string;
  capabilities?: readonly Capability[];
  optional?: boolean;
}
export interface ProviderMetadata {
  id: ProviderId;
  label: string;
  docsUrl: string;
  capabilities: readonly Capability[];
  credentials: readonly ProviderCredentialMetadata[];
  local: boolean;
}
