import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  ParallelProviderConfig,
  PerplexityProviderConfig,
  ProviderId,
  ValyuProviderConfig,
  WebProvider,
} from "../types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { ExaProvider } from "./exa.js";
import { GeminiProvider } from "./gemini.js";
import { ParallelProvider } from "./parallel.js";
import { PerplexityProvider } from "./perplexity.js";
import { ValyuProvider } from "./valyu.js";

export const PROVIDERS: ReadonlyArray<
  WebProvider<
    | ClaudeProviderConfig
    | CodexProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | PerplexityProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = [
  new ClaudeProvider(),
  new CodexProvider(),
  new ExaProvider(),
  new GeminiProvider(),
  new PerplexityProvider(),
  new ParallelProvider(),
  new ValyuProvider(),
];

export const PROVIDER_MAP: Record<
  ProviderId,
  WebProvider<
    | ClaudeProviderConfig
    | CodexProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | PerplexityProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = {
  claude: PROVIDERS[0],
  codex: PROVIDERS[1],
  exa: PROVIDERS[2],
  gemini: PROVIDERS[3],
  perplexity: PROVIDERS[4],
  parallel: PROVIDERS[5],
  valyu: PROVIDERS[6],
};
