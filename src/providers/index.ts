import type { AnyProvider, ProviderId, ProviderAdapter } from "../types.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { CustomAdapter } from "./custom.js";
import { ExaAdapter } from "./exa.js";
import { GeminiAdapter } from "./gemini.js";
import { ParallelAdapter } from "./parallel.js";
import { PerplexityAdapter } from "./perplexity.js";
import { TavilyAdapter } from "./tavily.js";
import { ValyuAdapter } from "./valyu.js";

const claudeProvider = new ClaudeAdapter();
const codexProvider = new CodexAdapter();
const exaProvider = new ExaAdapter();
const geminiProvider = new GeminiAdapter();
const perplexityProvider = new PerplexityAdapter();
const parallelProvider = new ParallelAdapter();
const tavilyProvider = new TavilyAdapter();
const valyuProvider = new ValyuAdapter();
const customProvider = new CustomAdapter();

export const ADAPTERS: ReadonlyArray<ProviderAdapter<AnyProvider>> = [
  claudeProvider,
  codexProvider,
  exaProvider,
  geminiProvider,
  perplexityProvider,
  parallelProvider,
  tavilyProvider,
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
  gemini: geminiProvider,
  perplexity: perplexityProvider,
  parallel: parallelProvider,
  tavily: tavilyProvider,
  valyu: valyuProvider,
};
