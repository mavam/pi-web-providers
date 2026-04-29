import { braveProvider } from "./brave.js";
import { claudeProvider } from "./claude.js";
import { cloudflareProvider } from "./cloudflare.js";
import { codexProvider } from "./codex.js";
import { customProvider } from "./custom.js";
import { defineProviders } from "./definition.js";
import { exaProvider } from "./exa.js";
import { firecrawlProvider } from "./firecrawl.js";
import { geminiProvider } from "./gemini.js";
import { linkupProvider } from "./linkup.js";
import { ollamaProvider } from "./ollama.js";
import { openaiProvider } from "./openai.js";
import { parallelProvider } from "./parallel.js";
import { perplexityProvider } from "./perplexity.js";
import { serperProvider } from "./serper.js";
import { tavilyProvider } from "./tavily.js";
import { valyuProvider } from "./valyu.js";

export const PROVIDERS = defineProviders({
  brave: braveProvider,
  claude: claudeProvider,
  codex: codexProvider,
  cloudflare: cloudflareProvider,
  custom: customProvider,
  exa: exaProvider,
  firecrawl: firecrawlProvider,
  gemini: geminiProvider,
  linkup: linkupProvider,
  ollama: ollamaProvider,
  openai: openaiProvider,
  parallel: parallelProvider,
  perplexity: perplexityProvider,
  serper: serperProvider,
  tavily: tavilyProvider,
  valyu: valyuProvider,
});

export const PROVIDERS_BY_ID = PROVIDERS;
export const PROVIDER_LIST = Object.values(PROVIDERS);
export const PROVIDER_IDS = Object.keys(PROVIDERS) as Array<
  keyof typeof PROVIDERS
>;
