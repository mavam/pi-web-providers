import type { ProviderDefinition } from "../providers/definition.js";
import type { ProviderConfig, Tool } from "../types.js";
import { WebMuxError } from "./errors.js";
import { PROVIDER_IDS } from "./public-types.js";
import type { ProviderId } from "./public-types.js";

type LoadedProvider = ProviderDefinition<
  ProviderId,
  ProviderConfig,
  Partial<Record<Tool, any>>
>;

const cache = new Map<ProviderId, Promise<LoadedProvider>>();

export function loadProvider(id: ProviderId): Promise<LoadedProvider> {
  if (!PROVIDER_IDS.includes(id)) {
    throw new WebMuxError("PROVIDER_UNAVAILABLE", `Unknown provider '${id}'`);
  }
  const cached = cache.get(id);
  if (cached) return cached;

  const loaded = load(id);
  cache.set(id, loaded);
  return loaded;
}

async function load(id: ProviderId): Promise<LoadedProvider> {
  switch (id) {
    case "brave":
      return (await import("../providers/brave.js"))
        .braveProvider as LoadedProvider;
    case "claude":
      return (await import("../providers/claude.js"))
        .claudeProvider as LoadedProvider;
    case "cloudflare":
      return (await import("../providers/cloudflare.js"))
        .cloudflareProvider as LoadedProvider;
    case "codex":
      return (await import("../providers/codex.js"))
        .codexProvider as LoadedProvider;
    case "custom":
      return (await import("../providers/custom.js"))
        .customProvider as LoadedProvider;
    case "exa":
      return (await import("../providers/exa.js"))
        .exaProvider as LoadedProvider;
    case "firecrawl":
      return (await import("../providers/firecrawl.js"))
        .firecrawlProvider as LoadedProvider;
    case "gemini":
      return (await import("../providers/gemini.js"))
        .geminiProvider as LoadedProvider;
    case "linkup":
      return (await import("../providers/linkup.js"))
        .linkupProvider as LoadedProvider;
    case "ollama":
      return (await import("../providers/ollama.js"))
        .ollamaProvider as LoadedProvider;
    case "openai":
      return (await import("../providers/openai.js"))
        .openaiProvider as LoadedProvider;
    case "parallel":
      return (await import("../providers/parallel.js"))
        .parallelProvider as LoadedProvider;
    case "perplexity":
      return (await import("../providers/perplexity.js"))
        .perplexityProvider as LoadedProvider;
    case "serper":
      return (await import("../providers/serper.js"))
        .serperProvider as LoadedProvider;
    case "tavily":
      return (await import("../providers/tavily.js"))
        .tavilyProvider as LoadedProvider;
    case "valyu":
      return (await import("../providers/valyu.js"))
        .valyuProvider as LoadedProvider;
    default:
      throw new WebMuxError("PROVIDER_UNAVAILABLE", `Unknown provider '${id}'`);
  }
}
