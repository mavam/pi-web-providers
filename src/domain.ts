export const CAPABILITIES = [
  "search",
  "contents",
  "answer",
  "research",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
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

export const WEBFOX_ERROR_CODES = [
  "INVALID_CONFIG",
  "INVALID_INPUT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_FAILURE",
  "PARTIAL_BATCH",
  "TIMEOUT",
  "CANCELLED",
] as const;
export type WebfoxErrorCode = (typeof WEBFOX_ERROR_CODES)[number];
export interface SerializedError {
  code: WebfoxErrorCode;
  message: string;
  retryable?: boolean;
}
export type InputResult<T> =
  | { input: string; ok: true; value: T }
  | { input: string; ok: false; error: SerializedError };
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  metadata?: Record<string, unknown>;
}
export interface ContentsAnswer {
  /** Final fetched URL; association with the requested URL is in InputResult.input. */
  url: string;
  content?: string;
  summary?: unknown;
  metadata?: Record<string, unknown>;
}
export interface TextAnswer {
  text: string;
  itemCount?: number;
  metadata?: Record<string, unknown>;
}
export interface CapabilityValues {
  search: { results: SearchResult[] };
  contents: ContentsAnswer;
  answer: TextAnswer;
  research: TextAnswer;
}
export interface CapabilityDocument<T, C extends Capability = Capability> {
  schemaVersion: 1;
  capability: C;
  provider: ProviderId;
  status: "ok" | "partial";
  results: InputResult<T>[];
}
export type SearchDocument = CapabilityDocument<
  CapabilityValues["search"],
  "search"
>;
export type ContentsDocument = CapabilityDocument<ContentsAnswer, "contents">;
export type AnswerDocument = CapabilityDocument<TextAnswer, "answer">;
export type ResearchDocument = CapabilityDocument<TextAnswer, "research">;
export type WebDocument =
  | SearchDocument
  | ContentsDocument
  | AnswerDocument
  | ResearchDocument;

export interface ProgressEvent {
  capability: Capability;
  provider: ProviderId;
  message: string;
}
export interface RequestOptions {
  provider?: ProviderId;
  options?: Record<string, unknown>;
  /** Overall operation deadline, including preparation and retries. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}
export interface SearchOptions extends RequestOptions {
  queries: string[];
  maxResults?: number;
}
export interface ContentsOptions extends RequestOptions {
  urls: string[];
}
export interface AnswerOptions extends RequestOptions {
  queries: string[];
}
export interface ResearchOptions extends RequestOptions {
  input: string;
}
