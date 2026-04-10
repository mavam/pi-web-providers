import type { AnyProvider, ProviderAdapter, ProviderId } from "../types.js";
import { claudeAdapter } from "./claude.js";
import { cloudflareAdapter } from "./cloudflare.js";
import { codexAdapter } from "./codex.js";
import { customAdapter } from "./custom.js";
import { exaAdapter } from "./exa.js";
import { firecrawlAdapter } from "./firecrawl.js";
import { geminiAdapter } from "./gemini.js";
import { linkupAdapter } from "./linkup.js";
import { parallelAdapter } from "./parallel.js";
import { perplexityAdapter } from "./perplexity.js";
import { serperAdapter } from "./serper.js";
import { tavilyAdapter } from "./tavily.js";
import { valyuAdapter } from "./valyu.js";

export const ADAPTERS_BY_ID: Record<
  ProviderId,
  ProviderAdapter<AnyProvider>
> = {
  claude: claudeAdapter,
  cloudflare: cloudflareAdapter,
  codex: codexAdapter,
  custom: customAdapter,
  exa: exaAdapter,
  firecrawl: firecrawlAdapter,
  gemini: geminiAdapter,
  linkup: linkupAdapter,
  perplexity: perplexityAdapter,
  parallel: parallelAdapter,
  serper: serperAdapter,
  tavily: tavilyAdapter,
  valyu: valyuAdapter,
};

export const ADAPTERS = Object.values(ADAPTERS_BY_ID);
