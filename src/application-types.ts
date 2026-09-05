import type {
  AnswerDocument,
  AnswerOptions,
  Capability,
  ContentsDocument,
  ContentsOptions,
  ProviderId,
  ResearchDocument,
  ResearchOptions,
  SearchDocument,
  SearchOptions,
} from "./domain.js";
import type { WebMuxConfig } from "./configuration/types.js";
import type { ProviderMetadata } from "./providers/metadata.js";
export type { ProviderMetadata } from "./providers/metadata.js";

export interface CreateWebMuxOptions {
  config?: WebMuxConfig;
  configPath?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
}
export interface ProviderInspection extends ProviderMetadata {
  configurationRequirements: Record<string, string>;
  configured: readonly Capability[];
  selectedDefaults: readonly Capability[];
}
export interface CapabilityInspection {
  capability: Capability;
  provider?: ProviderId;
  configured: boolean;
  optionSchema?: Record<string, unknown>;
  defaults: { maxResults?: number; options: Record<string, unknown> };
}
export interface WebMuxClient {
  search(options: SearchOptions): Promise<SearchDocument>;
  contents(options: ContentsOptions): Promise<ContentsDocument>;
  answer(options: AnswerOptions): Promise<AnswerDocument>;
  research(options: ResearchOptions): Promise<ResearchDocument>;
  listProviders(): readonly ProviderInspection[];
  getProvider(id: ProviderId): ProviderInspection | undefined;
  inspectCapability(
    capability: Capability,
    provider?: ProviderId,
  ): CapabilityInspection;
}
