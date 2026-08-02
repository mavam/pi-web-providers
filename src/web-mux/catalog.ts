import type { ProviderMetadata } from "./public-types.js";

export const PROVIDER_CATALOG = deepFreeze([
  provider(
    "brave",
    "Brave",
    "https://api-dashboard.search.brave.com/app/documentation",
    ["search", "answer", "research"],
    [
      ["search", "BRAVE_SEARCH_API_KEY", ["search"]],
      ["answers", "BRAVE_ANSWERS_API_KEY", ["answer", "research"]],
    ],
  ),
  provider(
    "claude",
    "Claude",
    "https://github.com/anthropics/claude-agent-sdk-typescript",
    ["search", "answer"],
    [],
    true,
  ),
  provider(
    "cloudflare",
    "Cloudflare",
    "https://developers.cloudflare.com/browser-rendering/",
    ["contents"],
    [["api", "CLOUDFLARE_API_TOKEN"]],
  ),
  provider(
    "codex",
    "Codex",
    "https://github.com/openai/codex/tree/main/sdk/typescript",
    ["search"],
    [],
    true,
  ),
  provider(
    "custom",
    "Custom",
    "https://github.com/mavam/web-mux#custom-providers",
    ["search", "contents", "answer", "research"],
    [],
    true,
  ),
  provider(
    "exa",
    "Exa",
    "https://exa.ai/docs/sdks/typescript-sdk-specification",
    ["search", "contents", "answer", "research"],
    [["api", "EXA_API_KEY"]],
  ),
  provider(
    "firecrawl",
    "Firecrawl",
    "https://docs.firecrawl.dev/sdks/node",
    ["search", "contents", "answer"],
    [["api", "FIRECRAWL_API_KEY"]],
  ),
  provider(
    "gemini",
    "Gemini",
    "https://github.com/googleapis/js-genai",
    ["search", "answer", "research"],
    [["api", "GOOGLE_API_KEY"]],
  ),
  provider(
    "linkup",
    "Linkup",
    "https://docs.linkup.so/pages/sdk/js/js",
    ["search", "contents", "research"],
    [["api", "LINKUP_API_KEY"]],
  ),
  provider(
    "ollama",
    "Ollama",
    "https://docs.ollama.com/capabilities/web-search",
    ["search", "contents"],
    [["api", "OLLAMA_API_KEY"]],
    true,
  ),
  provider(
    "openai",
    "OpenAI",
    "https://platform.openai.com/docs/guides/deep-research",
    ["search", "answer", "research"],
    [["api", "OPENAI_API_KEY"]],
  ),
  provider(
    "parallel",
    "Parallel",
    "https://github.com/parallel-web/parallel-sdk-typescript",
    ["search", "contents"],
    [["api", "PARALLEL_API_KEY"]],
  ),
  provider(
    "perplexity",
    "Perplexity",
    "https://docs.perplexity.ai/docs/sdk/overview",
    ["search", "answer", "research"],
    [["api", "PERPLEXITY_API_KEY"]],
  ),
  provider(
    "serper",
    "Serper",
    "https://serper.dev/",
    ["search"],
    [["api", "SERPER_API_KEY"]],
  ),
  provider(
    "tavily",
    "Tavily",
    "https://docs.tavily.com/sdk/javascript/reference",
    ["search", "contents"],
    [["api", "TAVILY_API_KEY"]],
  ),
  provider(
    "valyu",
    "Valyu",
    "https://docs.valyu.ai/sdk/typescript-sdk",
    ["search", "contents", "answer", "research"],
    [["api", "VALYU_API_KEY"]],
  ),
] satisfies ProviderMetadata[]);

export const PROVIDERS_BY_ID = Object.fromEntries(
  PROVIDER_CATALOG.map((entry) => [entry.id, entry]),
) as Record<ProviderMetadata["id"], ProviderMetadata>;

function provider(
  id: ProviderMetadata["id"],
  label: string,
  docsUrl: string,
  capabilities: ProviderMetadata["capabilities"],
  credentials: Array<[string, string, ProviderMetadata["capabilities"]?]>,
  local = false,
): ProviderMetadata {
  return {
    id,
    label,
    docsUrl,
    capabilities,
    credentials: credentials.map(
      ([name, environmentVariable, scopedCapabilities]) => ({
        name,
        environmentVariable,
        ...(scopedCapabilities ? { capabilities: scopedCapabilities } : {}),
      }),
    ),
    local,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
