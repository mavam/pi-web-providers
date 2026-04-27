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
  claude: wrapAdapter(claudeAdapter, {
    fields: ["pathToClaudeCodeExecutable", "options", "settings"],
  }),
  codex: wrapAdapter(codexAdapter, {
    fields: [
      "codexPath",
      "baseUrl",
      "apiKey",
      "env",
      "config",
      "options",
      "settings",
    ],
  }),
  cloudflare: wrapAdapter(cloudflareAdapter, {
    fields: ["apiToken", "accountId", "options", "settings"],
  }),
  custom: wrapAdapter(customAdapter, {
    fields: ["customOptions", "settings"],
  }),
  exa: wrapAdapter(exaAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
    optionCapabilities: ["search"],
  }),
  firecrawl: wrapAdapter(firecrawlAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
  }),
  gemini: wrapAdapter(geminiAdapter, {
    fields: ["apiKey", "options", "settings"],
  }),
  linkup: wrapAdapter(linkupAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
  }),
  ollama: wrapAdapter(ollamaAdapter, {
    fields: ["apiKey", "baseUrl", "settings"],
  }),
  openai: wrapAdapter(openaiAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
    optionCapabilities: ["search", "answer", "research"],
  }),
  parallel: wrapAdapter(parallelAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
  }),
  perplexity: wrapAdapter(perplexityAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
  }),
  serper: wrapAdapter(serperAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
    optionCapabilities: ["search"],
  }),
  tavily: wrapAdapter(tavilyAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
  }),
  valyu: wrapAdapter(valyuAdapter, {
    fields: ["apiKey", "baseUrl", "options", "settings"],
    optionCapabilities: ["search", "answer", "research"],
  }),
});

export const ADAPTERS_BY_ID = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, provider]) => [id, provider.adapter]),
) as ProviderAdaptersById;

export const ADAPTERS = Object.values(ADAPTERS_BY_ID);
