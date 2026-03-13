import type { ModelReasoningEffort, WebSearchMode } from "@openai/codex-sdk";

export const PROVIDER_IDS = [
  "claude",
  "codex",
  "exa",
  "gemini",
  "perplexity",
  "parallel",
  "valyu",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  metadata?: JsonObject;
}

export interface SearchResponse {
  provider: ProviderId;
  results: SearchResult[];
}

export interface ProviderToolOutput {
  provider: ProviderId;
  text: string;
  summary?: string;
  itemCount?: number;
}

export interface ProviderResearchJob {
  id: string;
}

export interface ProviderResearchPollResult {
  status: "in_progress" | "completed" | "failed" | "cancelled";
  output?: ProviderToolOutput;
  error?: string;
}

export interface WebSearchDetails {
  tool: "web_search";
  query: string;
  provider: ProviderId;
  resultCount: number;
}

export interface ProviderToolDetails {
  tool: string;
  provider: ProviderId;
  summary?: string;
  itemCount?: number;
}

export interface ClaudeProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
    answer?: boolean;
  };
  pathToClaudeCodeExecutable?: string;
  defaults?: {
    model?: string;
    effort?: "low" | "medium" | "high" | "max";
    maxTurns?: number;
  };
}

export interface CodexProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
  };
  codexPath?: string;
  baseUrl?: string;
  apiKey?: string;
  env?: Record<string, string>;
  config?: JsonObject;
  defaults?: {
    model?: string;
    modelReasoningEffort?: ModelReasoningEffort;
    networkAccessEnabled?: boolean;
    webSearchMode?: WebSearchMode;
    webSearchEnabled?: boolean;
    additionalDirectories?: string[];
  };
}

export interface ExaProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
    contents?: boolean;
    answer?: boolean;
    research?: boolean;
  };
  apiKey?: string;
  baseUrl?: string;
  defaults?: JsonObject;
}

export interface GeminiProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
    contents?: boolean;
    answer?: boolean;
    research?: boolean;
  };
  apiKey?: string;
  defaults?: {
    apiVersion?: string;
    searchModel?: string;
    contentsModel?: string;
    answerModel?: string;
    researchAgent?: string;
    requestTimeoutMs?: number;
    retryCount?: number;
    retryDelayMs?: number;
    researchPollIntervalMs?: number;
    researchTimeoutMs?: number;
    researchMaxConsecutivePollErrors?: number;
  };
}

export interface PerplexityProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
    answer?: boolean;
    research?: boolean;
  };
  apiKey?: string;
  baseUrl?: string;
  defaults?: {
    search?: JsonObject;
    answer?: JsonObject;
    research?: JsonObject;
  };
}

export interface ParallelProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
    contents?: boolean;
  };
  apiKey?: string;
  baseUrl?: string;
  defaults?: {
    search?: JsonObject;
    extract?: JsonObject;
  };
}

export interface ValyuProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
    contents?: boolean;
    answer?: boolean;
    research?: boolean;
  };
  apiKey?: string;
  baseUrl?: string;
  defaults?: JsonObject;
}

export interface WebProvidersConfig {
  version: 1;
  providers?: {
    claude?: ClaudeProviderConfig;
    codex?: CodexProviderConfig;
    exa?: ExaProviderConfig;
    gemini?: GeminiProviderConfig;
    perplexity?: PerplexityProviderConfig;
    parallel?: ParallelProviderConfig;
    valyu?: ValyuProviderConfig;
  };
}

export interface ProviderStatus {
  available: boolean;
  summary: string;
}

export interface ProviderContext {
  cwd: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface WebProvider<TConfig> {
  readonly id: ProviderId;
  readonly label: string;
  readonly docsUrl: string;

  createTemplate(): TConfig;
  getStatus(config: TConfig | undefined, cwd: string): ProviderStatus;
  search?(
    query: string,
    maxResults: number,
    options: JsonObject | undefined,
    config: TConfig,
    context: ProviderContext,
  ): Promise<SearchResponse>;
  contents?(
    urls: string[],
    options: JsonObject | undefined,
    config: TConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput>;
  answer?(
    query: string,
    options: JsonObject | undefined,
    config: TConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput>;
  research?(
    input: string,
    options: JsonObject | undefined,
    config: TConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput>;
  startResearch?(
    input: string,
    options: JsonObject | undefined,
    config: TConfig,
    context: ProviderContext,
  ): Promise<ProviderResearchJob>;
  pollResearch?(
    id: string,
    options: JsonObject | undefined,
    config: TConfig,
    context: ProviderContext,
  ): Promise<ProviderResearchPollResult>;
}
