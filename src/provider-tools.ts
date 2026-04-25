import { ADAPTERS, ADAPTERS_BY_ID } from "./providers/index.js";
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
  return typeof ADAPTERS_BY_ID[providerId][toolId] === "function";
}

export function getProviderTools(providerId: ProviderId): Tool[] {
  const provider = ADAPTERS_BY_ID[providerId];
  return TOOLS.filter((tool) => typeof provider[tool] === "function");
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
