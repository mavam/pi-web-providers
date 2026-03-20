import type {
  ClaudeProviderConfig,
  CloudflareProviderConfig,
  CodexProviderConfig,
  CustomCliProviderConfig,
  ExaProviderConfig,
  GeminiProviderConfig,
  ParallelProviderConfig,
  PerplexityProviderConfig,
  ProviderId,
  ValyuProviderConfig,
  WebProvider,
} from "../types.js";
import { ClaudeProvider } from "./claude.js";
import { CloudflareProvider } from "./cloudflare.js";
import { CodexProvider } from "./codex.js";
import { CustomCliProvider } from "./custom-cli.js";
import { ExaProvider } from "./exa.js";
import { GeminiProvider } from "./gemini.js";
import { ParallelProvider } from "./parallel.js";
import { PerplexityProvider } from "./perplexity.js";
import { ValyuProvider } from "./valyu.js";

export type AnyProviderConfig =
  | ClaudeProviderConfig
  | CloudflareProviderConfig
  | CodexProviderConfig
  | CustomCliProviderConfig
  | ExaProviderConfig
  | GeminiProviderConfig
  | PerplexityProviderConfig
  | ParallelProviderConfig
  | ValyuProviderConfig;

export const PROVIDERS: ReadonlyArray<WebProvider<AnyProviderConfig>> = [
  new ClaudeProvider(),
  new CloudflareProvider(),
  new CodexProvider(),
  new ExaProvider(),
  new GeminiProvider(),
  new PerplexityProvider(),
  new ParallelProvider(),
  new ValyuProvider(),
  new CustomCliProvider(),
];

export const PROVIDER_MAP: Record<ProviderId, WebProvider<AnyProviderConfig>> =
  Object.fromEntries(
    PROVIDERS.map((provider) => [provider.id, provider]),
  ) as Record<ProviderId, WebProvider<AnyProviderConfig>>;
