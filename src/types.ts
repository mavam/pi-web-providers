import type { ModelReasoningEffort, WebSearchMode } from "@openai/codex-sdk";
import type { TObject } from "@sinclair/typebox";
import type { ContentsResponse } from "./contents.js";

export const PROVIDER_IDS = [
  "claude",
  "cloudflare",
  "codex",
  "custom",
  "exa",
  "firecrawl",
  "gemini",
  "linkup",
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

export interface SerperOptions {
  search?: Record<string, unknown>;
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

export interface Provider<TOptions> {
  options?: TOptions;
  settings?: ExecutionSettings;
}

export interface Claude extends Provider<ClaudeOptions> {
  pathToClaudeCodeExecutable?: string;
}

export interface Codex extends Provider<CodexOptions> {
  codexPath?: string;
  baseUrl?: string;
  apiKey?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface Cloudflare extends Provider<Record<string, unknown>> {
  apiToken?: string;
  accountId?: string;
}

export interface Exa extends Provider<ExaOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface Firecrawl extends Provider<FirecrawlOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface Gemini extends Provider<GeminiOptions> {
  apiKey?: string;
}

export interface Linkup extends Provider<LinkupOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface Perplexity extends Provider<PerplexityOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface Parallel extends Provider<ParallelOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface OpenAI extends Provider<OpenAIOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface Custom extends Provider<CustomOptions> {}

export interface Tavily extends Provider<TavilyOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface Serper extends Provider<SerperOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface Valyu extends Provider<ValyuOptions> {
  apiKey?: string;
  baseUrl?: string;
}

export interface Settings extends ExecutionSettings {
  search?: SearchSettings;
}

export interface Providers {
  claude?: Claude;
  cloudflare?: Cloudflare;
  codex?: Codex;
  custom?: Custom;
  exa?: Exa;
  firecrawl?: Firecrawl;
  gemini?: Gemini;
  linkup?: Linkup;
  perplexity?: Perplexity;
  parallel?: Parallel;
  openai?: OpenAI;
  serper?: Serper;
  tavily?: Tavily;
  valyu?: Valyu;
}

export type AnyProvider =
  | Claude
  | Cloudflare
  | Codex
  | Custom
  | Exa
  | Firecrawl
  | Gemini
  | Linkup
  | OpenAI
  | Perplexity
  | Parallel
  | Serper
  | Tavily
  | Valyu;

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

export type ProviderRequest =
  | SearchRequest
  | ContentsRequest
  | AnswerRequest
  | ResearchRequest;

export const EXECUTION_CONTROL_KEYS = [
  "requestTimeoutMs",
  "retryCount",
  "retryDelayMs",
  "researchTimeoutMs",
] as const;

export type ExecutionControlKey = (typeof EXECUTION_CONTROL_KEYS)[number];

export interface ProviderPlanTraits {
  settings?: ExecutionSettings;
}

export interface ProviderPlan<TResult> {
  capability: Tool;
  providerId: ProviderId;
  providerLabel: string;
  traits?: ProviderPlanTraits;
  execute: (context: ProviderContext) => Promise<TResult>;
}

export type ProviderResult = SearchResponse | ContentsResponse | ToolOutput;

export type ProviderOptionsSchema = TObject;

export interface ProviderAdapter<TConfig> {
  readonly id: ProviderId;
  readonly label: string;
  readonly docsUrl: string;
  readonly tools: readonly Tool[];

  createTemplate(): TConfig;
  getCapabilityStatus(
    config: TConfig | undefined,
    cwd: string,
    tool?: Tool,
  ): ProviderCapabilityStatus;
  buildPlan(
    request: ProviderRequest,
    config: TConfig,
  ): ProviderPlan<ProviderResult> | null;
  getToolOptionsSchema?(capability: Tool): ProviderOptionsSchema | undefined;
  getConfigForCapability?(capability: Tool, config: TConfig): unknown;
}
