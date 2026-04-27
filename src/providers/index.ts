import type { ProviderAdaptersById } from "../types.js";
import { claudeAdapter } from "./claude.js";
import { cloudflareAdapter } from "./cloudflare.js";
import { codexAdapter } from "./codex.js";
import { customAdapter } from "./custom.js";
import { defineProviders, wrapAdapter } from "./definition.js";
import { exaAdapter } from "./exa.js";
import { firecrawlAdapter } from "./firecrawl.js";
import { geminiAdapter } from "./gemini.js";
import { linkupAdapter } from "./linkup.js";
import { ollamaAdapter } from "./ollama.js";
import { openaiAdapter } from "./openai.js";
import { parallelAdapter } from "./parallel.js";
import { perplexityAdapter } from "./perplexity.js";
import { serperAdapter } from "./serper.js";
import { tavilyAdapter } from "./tavily.js";
import { valyuAdapter } from "./valyu.js";

export const PROVIDERS = defineProviders({
  claude: wrapAdapter(claudeAdapter),
  codex: wrapAdapter(codexAdapter),
  cloudflare: wrapAdapter(cloudflareAdapter),
  custom: wrapAdapter(customAdapter),
  exa: wrapAdapter(exaAdapter),
  firecrawl: wrapAdapter(firecrawlAdapter),
  gemini: wrapAdapter(geminiAdapter),
  linkup: wrapAdapter(linkupAdapter),
  ollama: wrapAdapter(ollamaAdapter),
  openai: wrapAdapter(openaiAdapter),
  parallel: wrapAdapter(parallelAdapter),
  perplexity: wrapAdapter(perplexityAdapter),
  serper: wrapAdapter(serperAdapter),
  tavily: wrapAdapter(tavilyAdapter),
  valyu: wrapAdapter(valyuAdapter),
});

export const ADAPTERS_BY_ID = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, provider]) => [id, provider.adapter]),
) as ProviderAdaptersById;

export const ADAPTERS = Object.values(ADAPTERS_BY_ID);
