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
export type ProviderCapability = "search" | "contents" | "answer" | "research";

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

export interface ProviderContentsMetadataEntry {
  url: string;
  title?: string;
  body: string;
  summary?: string;
  status?: "ready" | "failed";
}

export interface ProviderToolOutput {
  provider: ProviderId;
  text: string;
  summary?: string;
  itemCount?: number;
  metadata?: JsonObject;
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
  queryCount: number;
  failedQueryCount: number;
  provider: ProviderId;
  resultCount: number;
}

export interface ProviderToolDetails {
  tool: string;
  provider: ProviderId;
  summary?: string;
  itemCount?: number;
  queryCount?: number;
  failedQueryCount?: number;
}

export interface ClaudeProviderNativeConfig {
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
  maxTurns?: number;
}

export interface CodexProviderNativeConfig {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  webSearchEnabled?: boolean;
  additionalDirectories?: string[];
}

export interface GeminiProviderNativeConfig {
  apiVersion?: string;
  searchModel?: string;
  contentsModel?: string;
  answerModel?: string;
  researchAgent?: string;
}

export interface PerplexityProviderNativeConfig {
  search?: JsonObject;
  answer?: JsonObject;
  research?: JsonObject;
}

export interface ParallelProviderNativeConfig {
  search?: JsonObject;
  extract?: JsonObject;
}

export interface ClaudeProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
    answer?: boolean;
  };
  pathToClaudeCodeExecutable?: string;
  native?: ClaudeProviderNativeConfig;
  policy?: ExecutionPolicyDefaults;
  defaults?: ClaudeProviderNativeConfig;
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
  native?: CodexProviderNativeConfig;
  policy?: ExecutionPolicyDefaults;
  defaults?: CodexProviderNativeConfig;
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
  native?: JsonObject;
  policy?: ExecutionPolicyDefaults;
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
  native?: GeminiProviderNativeConfig;
  policy?: ExecutionPolicyDefaults;
  defaults?: GeminiProviderNativeConfig & ExecutionPolicyDefaults;
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
  native?: PerplexityProviderNativeConfig;
  policy?: ExecutionPolicyDefaults;
  defaults?: PerplexityProviderNativeConfig;
}

export interface ParallelProviderConfig {
  enabled?: boolean;
  tools?: {
    search?: boolean;
    contents?: boolean;
  };
  apiKey?: string;
  baseUrl?: string;
  native?: ParallelProviderNativeConfig;
  policy?: ExecutionPolicyDefaults;
  defaults?: ParallelProviderNativeConfig;
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
  native?: JsonObject;
  policy?: ExecutionPolicyDefaults;
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
  idempotencyKey?: string;
}

export interface ExecutionPolicyDefaults {
  requestTimeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  researchPollIntervalMs?: number;
  researchTimeoutMs?: number;
  researchMaxConsecutivePollErrors?: number;
}

export interface SearchOperationRequest {
  capability: "search";
  query: string;
  maxResults: number;
  options?: JsonObject;
}

export interface ContentsOperationRequest {
  capability: "contents";
  urls: string[];
  options?: JsonObject;
}

export interface AnswerOperationRequest {
  capability: "answer";
  query: string;
  options?: JsonObject;
}

export interface ResearchOperationRequest {
  capability: "research";
  input: string;
  options?: JsonObject;
}

export type ProviderOperationRequest =
  | SearchOperationRequest
  | ContentsOperationRequest
  | AnswerOperationRequest
  | ResearchOperationRequest;

export interface ProviderResearchLifecycleTraits {
  supportsStartRetries?: boolean;
  supportsRequestTimeouts?: boolean;
}

export const EXECUTION_CONTROL_KEYS = [
  "requestTimeoutMs",
  "retryCount",
  "retryDelayMs",
  "pollIntervalMs",
  "timeoutMs",
  "maxConsecutivePollErrors",
  "resumeId",
] as const;

export type ExecutionControlKey = (typeof EXECUTION_CONTROL_KEYS)[number];

export interface ExecutionSupport {
  requestTimeoutMs?: boolean;
  retryCount?: boolean;
  retryDelayMs?: boolean;
  pollIntervalMs?: boolean;
  timeoutMs?: boolean;
  maxConsecutivePollErrors?: boolean;
  resumeId?: boolean;
}

export interface ProviderPlanTraits {
  policyDefaults?: ExecutionPolicyDefaults;
  executionSupport?: ExecutionSupport;
  researchLifecycle?: ProviderResearchLifecycleTraits;
}

// How a provider delivers a tool result back to pi.
export type ProviderDeliveryMode =
  | "silent-foreground"
  | "streaming-foreground"
  | "background-research";

export interface SingleProviderOperationPlan<TResult> {
  capability: ProviderCapability;
  providerId: ProviderId;
  providerLabel: string;
  deliveryMode: "silent-foreground" | "streaming-foreground";
  traits?: ProviderPlanTraits;
  execute: (context: ProviderContext) => Promise<TResult>;
}

export interface BackgroundResearchOperationPlan {
  capability: "research";
  providerId: ProviderId;
  providerLabel: string;
  deliveryMode: "background-research";
  traits?: ProviderPlanTraits;
  start: (context: ProviderContext) => Promise<ProviderResearchJob>;
  poll: (
    id: string,
    context: ProviderContext,
  ) => Promise<ProviderResearchPollResult>;
}

export type ProviderOperationPlan<
  TResult = SearchResponse | ProviderToolOutput,
> = SingleProviderOperationPlan<TResult> | BackgroundResearchOperationPlan;

export interface WebProvider<TConfig> {
  readonly id: ProviderId;
  readonly label: string;
  readonly docsUrl: string;
  readonly capabilities: readonly ProviderCapability[];

  createTemplate(): TConfig;
  getStatus(config: TConfig | undefined, cwd: string): ProviderStatus;
  buildPlan(
    request: ProviderOperationRequest,
    config: TConfig,
  ): ProviderOperationPlan | null;
}
