import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  CustomCliProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  PerplexityProviderConfig,
  ParallelProviderConfig,
  ProviderId,
  ValyuProviderConfig,
  WebProvider,
} from "../types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { CustomCliProvider } from "./custom-cli.js";
import { ExaProvider } from "./exa.js";
import { GeminiProvider } from "./gemini.js";
import { PerplexityProvider } from "./perplexity.js";
import { ParallelProvider } from "./parallel.js";
import { ValyuProvider } from "./valyu.js";

export const PROVIDERS: ReadonlyArray<
  WebProvider<
    | ClaudeProviderConfig
    | CodexProviderConfig
    | CustomCliProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | PerplexityProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = [
  new ClaudeProvider(),
  new CodexProvider(),
  new CustomCliProvider(),
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
    | CustomCliProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | PerplexityProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = {
  claude: PROVIDERS[0],
  codex: PROVIDERS[1],
  "custom-cli": PROVIDERS[2],
  exa: PROVIDERS[3],
  gemini: PROVIDERS[4],
  perplexity: PROVIDERS[5],
  parallel: PROVIDERS[6],
  valyu: PROVIDERS[7],
};
