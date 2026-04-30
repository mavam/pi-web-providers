import type { ModelReasoningEffort, WebSearchMode } from "@openai/codex-sdk";
import type { ContentsResponse } from "./contents.js";

export const PROVIDER_IDS = [
  "brave",
  "claude",
  "cloudflare",
  "codex",
  "custom",
  "exa",
  "firecrawl",
  "gemini",
  "linkup",
  "ollama",
  "openai",
  "parallel",
  "perplexity",
  "serper",
  "tavily",
  "valyu",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export const TOOLS = ["search", "contents", "answer", "research"] as const;
export type Tool = (typeof TOOLS)[number];
export type Tools = Partial<Record<Tool, ProviderId>>;

export interface SearchSettings {
  provider?: ProviderId;
  maxUrls?: number;
  ttlMs?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  provider: ProviderId;
  results: SearchResult[];
}

export interface ToolOutput {
  provider: ProviderId;
  text: string;
  itemCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ResearchJob {
  id: string;
}

export interface ResearchPollResult {
  status: "in_progress" | "completed" | "failed" | "cancelled";
  statusText?: string;
  output?: ToolOutput;
  error?: string;
}

export interface WebSearchDetails {
  tool: "web_search";
  queryCount: number;
  failedQueryCount: number;
  provider: ProviderId;
  resultCount: number;
}

export interface ToolDetails {
  tool: string;
  provider: ProviderId;
  itemCount?: number;
  queryCount?: number;
  failedQueryCount?: number;
}

export interface WebResearchRequest {
  tool: "web_research";
  id: string;
  provider: ProviderId;
  input: string;
  outputPath: string;
  startedAt: string;
  progress?: string;
}

export interface WebResearchResult extends WebResearchRequest {
  status: "completed" | "failed" | "cancelled";
  completedAt: string;
  elapsedMs: number;
  itemCount?: number;
  error?: string;
}

export interface ClaudeOptions {
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
  maxTurns?: number;
}

export interface CodexOptions {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  webSearchEnabled?: boolean;
  additionalDirectories?: string[];
}

export interface GeminiOptions {
  apiVersion?: string;
  searchModel?: string;
  answerModel?: string;
  researchAgent?: string;
}

export interface LinkupOptions {
  search?: Record<string, unknown>;
  fetch?: Record<string, unknown>;
}

export interface PerplexityOptions {
  search?: Record<string, unknown>;
  answer?: Record<string, unknown>;
  research?: Record<string, unknown>;
}

export interface ParallelOptions {
  search?: Record<string, unknown>;
  extract?: Record<string, unknown>;
}

export interface OpenAISearchOptions {
  model?: string;
  instructions?: string;
}

export interface OpenAIAnswerOptions {
  model?: string;
  instructions?: string;
}

export interface OpenAIResearchOptions {
  model?: string;
  instructions?: string;
  max_tool_calls?: number;
}

export interface OpenAIOptions {
  search?: OpenAISearchOptions;
  answer?: OpenAIAnswerOptions;
  research?: OpenAIResearchOptions;
}

export interface ExaOptions {
  search?: Record<string, unknown>;
}

export interface FirecrawlOptions {
  search?: Record<string, unknown>;
  scrape?: Record<string, unknown>;
}

export interface TavilyOptions {
  search?: Record<string, unknown>;
  extract?: Record<string, unknown>;
}

export const SERPER_SEARCH_MODE_VALUES = {
  search: "search",
  images: "images",
  videos: "videos",
  places: "places",
  maps: "maps",
  reviews: "reviews",
  news: "news",
  shopping: "shopping",
  productReviews: "product-reviews",
  lens: "lens",
  scholar: "scholar",
  patents: "patents",
  autocomplete: "autocomplete",
  webpage: "webpage",
} as const;

export type SerperSearchMode =
  (typeof SERPER_SEARCH_MODE_VALUES)[keyof typeof SERPER_SEARCH_MODE_VALUES];

export interface SerperSearchOptions {
  mode?: SerperSearchMode;
  gl?: string;
  hl?: string;
  location?: string;
  page?: number;
  tbs?: string;
  autocorrect?: boolean;
  url?: string;
  ll?: string;
  placeId?: string;
  cid?: string;
  fid?: string;
  sortBy?: string;
  topicId?: string;
  productId?: string;
  nextPageToken?: string;
  includeMarkdown?: boolean;
  includeImages?: boolean;
  includeLinks?: boolean;
  includeVideos?: boolean;
  [key: string]: unknown;
}

export interface SerperOptions {
  search?: SerperSearchOptions;
}

export interface ValyuOptions {
  search?: Record<string, unknown>;
  answer?: Record<string, unknown>;
  research?: Record<string, unknown>;
}

export interface CustomCommandConfig {
  argv?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface CustomOptions {
  search?: CustomCommandConfig;
  contents?: CustomCommandConfig;
  answer?: CustomCommandConfig;
  research?: CustomCommandConfig;
}

export type ProviderCredentials = Record<string, string>;

export interface Provider<TOptions = never> {
  credentials?: ProviderCredentials;
  options?: TOptions;
  settings?: ExecutionSettings;
}

export interface BraveSearchOptions {
  mode?: "web" | "llm_context" | "news" | "videos" | "images" | "places";
  common?: Record<string, unknown>;
  web?: Record<string, unknown>;
  llmContext?: Record<string, unknown>;
  news?: Record<string, unknown>;
  videos?: Record<string, unknown>;
  images?: Record<string, unknown>;
  places?: Record<string, unknown>;
}

export interface BraveAnswerOptions {
  country?: string;
  language?: string;
  enable_citations?: boolean;
  enable_entities?: boolean;
  max_completion_tokens?: number;
}

export interface BraveResearchOptions {
  country?: string;
  language?: string;
  enable_entities?: boolean;
  enable_citations?: boolean;
  max_completion_tokens?: number;
  research_allow_thinking?: boolean;
  research_maximum_number_of_tokens_per_query?: number;
  research_maximum_number_of_queries?: number;
  research_maximum_number_of_iterations?: number;
  research_maximum_number_of_seconds?: number;
  research_maximum_number_of_results_per_query?: number;
}

export interface BraveOptions {
  search?: BraveSearchOptions;
  answer?: BraveAnswerOptions;
  research?: BraveResearchOptions;
}

export interface Brave extends Provider<BraveOptions> {
  baseUrl?: string;
}

export interface Claude extends Provider<ClaudeOptions> {
  pathToClaudeCodeExecutable?: string;
}

export interface Codex extends Provider<CodexOptions> {
  codexPath?: string;
  baseUrl?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface Cloudflare extends Provider<Record<string, unknown>> {
  accountId?: string;
}

export interface Exa extends Provider<ExaOptions> {
  baseUrl?: string;
}

export interface Firecrawl extends Provider<FirecrawlOptions> {
  baseUrl?: string;
}

export interface Gemini extends Provider<GeminiOptions> {}

export interface Linkup extends Provider<LinkupOptions> {
  baseUrl?: string;
}

export interface Ollama extends Provider {
  baseUrl?: string;
}

export interface Perplexity extends Provider<PerplexityOptions> {
  baseUrl?: string;
}

export interface Parallel extends Provider<ParallelOptions> {
  baseUrl?: string;
}

export interface OpenAI extends Provider<OpenAIOptions> {
  baseUrl?: string;
}

export interface Custom extends Provider<CustomOptions> {}

export interface Tavily extends Provider<TavilyOptions> {
  baseUrl?: string;
}

export interface Serper extends Provider<SerperOptions> {
  baseUrl?: string;
}

export interface Valyu extends Provider<ValyuOptions> {
  baseUrl?: string;
}

export interface Settings extends ExecutionSettings {
  search?: SearchSettings;
}

export interface ProviderConfigMap {
  brave: Brave;
  claude: Claude;
  cloudflare: Cloudflare;
  codex: Codex;
  custom: Custom;
  exa: Exa;
  firecrawl: Firecrawl;
  gemini: Gemini;
  linkup: Linkup;
  ollama: Ollama;
  openai: OpenAI;
  parallel: Parallel;
  perplexity: Perplexity;
  serper: Serper;
  tavily: Tavily;
  valyu: Valyu;
}

export type ProviderConfig<TProviderId extends ProviderId = ProviderId> =
  ProviderConfigMap[TProviderId];

export type Providers = Partial<ProviderConfigMap>;

export interface WebProviders {
  tools?: Tools;
  settings?: Settings;
  providers?: Providers;
}

export type ProviderSetupState = "builtin" | "configured" | "none";

export type ProviderCapabilityStatus =
  | { state: "ready" }
  | { state: "missing_api_key" }
  | { state: "missing_executable" }
  | { state: "missing_command" }
  | { state: "invalid_config"; detail: string };

export interface ProviderContext {
  cwd: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  idempotencyKey?: string;
}

export interface ExecutionSettings {
  requestTimeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  researchTimeoutMs?: number;
}

export interface SearchRequest {
  capability: "search";
  query: string;
  maxResults: number;
  options?: Record<string, unknown>;
}

export interface ContentsRequest {
  capability: "contents";
  urls: string[];
  options?: Record<string, unknown>;
}

export interface AnswerRequest {
  capability: "answer";
  query: string;
  options?: Record<string, unknown>;
}

export interface ResearchRequest {
  capability: "research";
  input: string;
  options?: Record<string, unknown>;
}

export interface ProviderRequestMap {
  search: SearchRequest;
  contents: ContentsRequest;
  answer: AnswerRequest;
  research: ResearchRequest;
}

export type ProviderRequest<TTool extends Tool = Tool> =
  ProviderRequestMap[TTool];

export interface ProviderResultMap {
  search: SearchResponse;
  contents: ContentsResponse;
  answer: ToolOutput;
  research: ToolOutput;
}

export type ProviderResult<TTool extends Tool = Tool> =
  ProviderResultMap[TTool];
