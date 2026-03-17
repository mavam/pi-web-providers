import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  ParallelProviderConfig,
  PerplexityProviderConfig,
  ProviderId,
  ValyuProviderConfig,
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

export function isProviderToolEnabled(
  providerId: ProviderId,
  config: ProviderConfigUnion | undefined,
  toolId: ProviderToolId,
): boolean {
  if (!supportsProviderTool(providerId, toolId)) {
    return false;
  }
  const tools = config?.tools as
    | Partial<Record<ProviderToolId, boolean>>
    | undefined;
  return tools?.[toolId] ?? true;
}
