import type { AnyProvider, ProviderId, ProviderAdapter } from "../types.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { CustomAdapter } from "./custom.js";
import { ExaAdapter } from "./exa.js";
import { FirecrawlAdapter } from "./firecrawl.js";
import { GeminiAdapter } from "./gemini.js";
import { ParallelAdapter } from "./parallel.js";
import { PerplexityAdapter } from "./perplexity.js";
import { ValyuAdapter } from "./valyu.js";

const claudeProvider = new ClaudeAdapter();
const codexProvider = new CodexAdapter();
const exaProvider = new ExaAdapter();
const firecrawlProvider = new FirecrawlAdapter();
const geminiProvider = new GeminiAdapter();
const perplexityProvider = new PerplexityAdapter();
const parallelProvider = new ParallelAdapter();
const valyuProvider = new ValyuAdapter();
const customProvider = new CustomAdapter();

export const ADAPTERS: ReadonlyArray<ProviderAdapter<AnyProvider>> = [
  claudeProvider,
  codexProvider,
  exaProvider,
  firecrawlProvider,
  geminiProvider,
  perplexityProvider,
  parallelProvider,
  valyuProvider,
  customProvider,
];

export const ADAPTERS_BY_ID: Record<
  ProviderId,
  ProviderAdapter<AnyProvider>
> = {
  claude: claudeProvider,
  codex: codexProvider,
  custom: customProvider,
  exa: exaProvider,
  firecrawl: firecrawlProvider,
  gemini: geminiProvider,
  perplexity: perplexityProvider,
  parallel: parallelProvider,
  valyu: valyuProvider,
};
