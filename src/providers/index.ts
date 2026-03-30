import type { AnyProvider, ProviderAdapter, ProviderId } from "../types.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { customAdapter } from "./custom.js";
import { exaAdapter } from "./exa.js";
import { GeminiAdapter } from "./gemini.js";
import { parallelAdapter } from "./parallel.js";
import { PerplexityAdapter } from "./perplexity.js";
import { valyuAdapter } from "./valyu.js";

const claudeProvider = new ClaudeAdapter();
const codexProvider = new CodexAdapter();
const exaProvider = exaAdapter;
const geminiProvider = new GeminiAdapter();
const perplexityProvider = new PerplexityAdapter();
const parallelProvider = parallelAdapter;
const valyuProvider = valyuAdapter;
const customProvider = customAdapter;

export const ADAPTERS: ReadonlyArray<ProviderAdapter<AnyProvider>> = [
  claudeProvider,
  codexProvider,
  exaProvider,
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
  gemini: geminiProvider,
  perplexity: perplexityProvider,
  parallel: parallelProvider,
  valyu: valyuProvider,
};
