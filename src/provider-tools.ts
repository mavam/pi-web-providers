import { ADAPTERS, ADAPTERS_BY_ID, PROVIDERS } from "./providers/index.js";
import {
  type ProviderId,
  TOOLS,
  type Tool,
  type WebProviders,
} from "./types.js";

export const TOOL_INFO: Record<Tool, { label: string; help: string }> = {
  search: {
    label: "Search",
    help: "Enable the provider's search tool.",
  },
  contents: {
    label: "Contents",
    help: "Enable the provider's content extraction tool.",
  },
  answer: {
    label: "Answer",
    help: "Enable the provider's answer generation tool.",
  },
  research: {
    label: "Research",
    help: "Enable the provider's long-form research tool.",
  },
};

export function supportsTool(providerId: ProviderId, toolId: Tool): boolean {
  const capabilities = PROVIDERS[providerId].capabilities as Partial<
    Record<Tool, unknown>
  >;
  return capabilities[toolId] !== undefined;
}

export function getProviderTools(providerId: ProviderId): Tool[] {
  return TOOLS.filter((tool) => supportsTool(providerId, tool));
}

export function getCompatibleProviders(toolId: Tool): ProviderId[] {
  return ADAPTERS.filter((provider) => supportsTool(provider.id, toolId)).map(
    (provider) => provider.id,
  );
}

export function getMappedProviderForTool(
  config: WebProviders,
  tool: Tool,
): ProviderId | undefined {
  return config.tools?.[tool];
}

export function getProviderAdapter(providerId: ProviderId) {
  return ADAPTERS_BY_ID[providerId];
}
