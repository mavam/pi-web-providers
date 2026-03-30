import type { AnyProvider, ProviderAdapter, ProviderId } from "../types.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { customAdapter } from "./custom.js";
import { exaAdapter } from "./exa.js";
import { geminiAdapter } from "./gemini.js";
import { parallelAdapter } from "./parallel.js";
import { perplexityAdapter } from "./perplexity.js";
import { valyuAdapter } from "./valyu.js";

export const ADAPTERS_BY_ID: Record<
  ProviderId,
  ProviderAdapter<AnyProvider>
> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  custom: customAdapter,
  exa: exaAdapter,
  gemini: geminiAdapter,
  perplexity: perplexityAdapter,
  parallel: parallelAdapter,
  valyu: valyuAdapter,
};

export const ADAPTERS = Object.values(ADAPTERS_BY_ID);
