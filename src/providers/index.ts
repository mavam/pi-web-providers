import type {
  ClaudeProviderConfig,
  CodexProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  ParallelProviderConfig,
  ProviderId,
  ValyuProviderConfig,
  WebProvider,
} from "../types.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { ExaProvider } from "./exa.js";
import { GeminiProvider } from "./gemini.js";
import { ParallelProvider } from "./parallel.js";
import { ValyuProvider } from "./valyu.js";

export const PROVIDERS: ReadonlyArray<
  WebProvider<
    | ClaudeProviderConfig
    | CodexProviderConfig
    | ExaProviderConfig
    | GeminiProviderConfig
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = [
  new ClaudeProvider(),
  new CodexProvider(),
  new ExaProvider(),
  new GeminiProvider(),
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
    | ParallelProviderConfig
    | ValyuProviderConfig
  >
> = {
  claude: PROVIDERS[0],
  codex: PROVIDERS[1],
  exa: PROVIDERS[2],
  gemini: PROVIDERS[3],
  parallel: PROVIDERS[4],
  valyu: PROVIDERS[5],
};
