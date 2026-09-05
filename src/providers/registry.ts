import { braveProvider } from "./brave/definition.js";
import { claudeProvider } from "./claude/definition.js";
import { cloudflareProvider } from "./cloudflare/definition.js";
import { codexProvider } from "./codex/definition.js";
import { customProvider } from "./custom/definition.js";
import { exaProvider } from "./exa/definition.js";
import { firecrawlProvider } from "./firecrawl/definition.js";
import { geminiProvider } from "./gemini/definition.js";
import { linkupProvider } from "./linkup/definition.js";
import { ollamaProvider } from "./ollama/definition.js";
import { openaiProvider } from "./openai/definition.js";
import { parallelProvider } from "./parallel/definition.js";
import { perplexityProvider } from "./perplexity/definition.js";
import { serperProvider } from "./serper/definition.js";
import { tavilyProvider } from "./tavily/definition.js";
import { valyuProvider } from "./valyu/definition.js";

export const providers = {
  brave: braveProvider,
  claude: claudeProvider,
  cloudflare: cloudflareProvider,
  codex: codexProvider,
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
} as const;
