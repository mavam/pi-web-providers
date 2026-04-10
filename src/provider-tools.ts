import {
  type ProviderId,
  TOOLS,
  type Tool,
  type WebProviders,
} from "./types.js";

export const PROVIDER_TOOLS_BY_ID: Record<ProviderId, readonly Tool[]> = {
  claude: ["search", "answer"],
  cloudflare: ["contents"],
  codex: ["search"],
  custom: ["search", "contents", "answer", "research"],
  exa: ["search", "contents", "answer", "research"],
  firecrawl: ["search", "contents"],
  gemini: ["search", "answer", "research"],
  linkup: ["search", "contents"],
  perplexity: ["search", "answer", "research"],
  parallel: ["search", "contents"],
  serper: ["search"],
  tavily: ["search", "contents"],
  valyu: ["search", "contents", "answer", "research"],
};

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
  return PROVIDER_TOOLS_BY_ID[providerId].includes(toolId);
}

export function getCompatibleProviders(toolId: Tool): ProviderId[] {
  return (Object.keys(PROVIDER_TOOLS_BY_ID) as ProviderId[]).filter(
    (providerId) => supportsTool(providerId, toolId),
  );
}

export function getMappedProviderForTool(
  config: WebProviders,
  tool: Tool,
): ProviderId | undefined {
  return config.tools?.[tool];
}
