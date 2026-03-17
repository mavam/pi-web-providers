import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  CustomCliProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  ParallelProviderConfig,
  PerplexityProviderConfig,
  ProviderCapability,
  ProviderId,
  ValyuProviderConfig,
  WebProvidersConfig,
} from "./types.js";

export const PROVIDER_TOOL_IDS = [
  "search",
  "contents",
  "answer",
  "research",
] as const;

export type ProviderToolId = (typeof PROVIDER_TOOL_IDS)[number];

export const PROVIDER_TOOLS: Record<ProviderId, readonly ProviderToolId[]> = {
  claude: ["search", "answer"],
  codex: ["search"],
  "custom-cli": ["search", "contents", "answer", "research"],
  exa: ["search", "contents", "answer", "research"],
  gemini: ["search", "answer", "research"],
  perplexity: ["search", "answer", "research"],
  parallel: ["search", "contents"],
  valyu: ["search", "contents", "answer", "research"],
};

export const PROVIDER_TOOL_META: Record<
  ProviderToolId,
  { label: string; help: string }
> = {
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

export type ProviderConfigUnion =
  | ClaudeProviderConfig
  | CodexProviderConfig
  | CustomCliProviderConfig
  | ExaProviderConfig
  | GeminiProviderConfig
  | PerplexityProviderConfig
  | ParallelProviderConfig
  | ValyuProviderConfig;

export function supportsProviderTool(
  providerId: ProviderId,
  toolId: ProviderToolId,
): boolean {
  return PROVIDER_TOOLS[providerId].includes(toolId);
}

export function getCompatibleProvidersForTool(
  toolId: ProviderToolId,
): ProviderId[] {
  return (Object.keys(PROVIDER_TOOLS) as ProviderId[]).filter((providerId) =>
    supportsProviderTool(providerId, toolId),
  );
}

export function getMappedProviderForCapability(
  config: WebProvidersConfig,
  capability: ProviderCapability,
): ProviderId | null | undefined {
  return config.tools?.[capability];
}
