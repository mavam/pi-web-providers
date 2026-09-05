import type {
  Capability as Tool,
  ProviderId,
  SearchResult,
} from "../domain.js";
import type { IndexedContentsResponse } from "../contents.js";
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

export interface ProviderContext {
  cwd: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  idempotencyKey?: string;
  retryPolicy?: { retries: number; delayMs: number };
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
  contents: IndexedContentsResponse;
  answer: ToolOutput;
  research: ToolOutput;
}

export type ProviderResult<TTool extends Tool = Tool> =
  ProviderResultMap[TTool];
export interface Provider {
  credentials?: Record<string, string>;
}

export type {
  Capability as Tool,
  ProviderId,
  SearchResult,
} from "../domain.js";

export interface ProviderConfigMap {
  brave: import("./brave/types.js").Brave;
  claude: import("./claude/types.js").Claude;
  cloudflare: import("./cloudflare/types.js").Cloudflare;
  codex: import("./codex/types.js").Codex;
  custom: import("./custom/types.js").Custom;
  exa: import("./exa/types.js").Exa;
  firecrawl: import("./firecrawl/types.js").Firecrawl;
  gemini: import("./gemini/types.js").Gemini;
  linkup: import("./linkup/types.js").Linkup;
  ollama: import("./ollama/types.js").Ollama;
  openai: import("./openai/types.js").OpenAI;
  parallel: import("./parallel/types.js").Parallel;
  perplexity: import("./perplexity/types.js").Perplexity;
  serper: import("./serper/types.js").Serper;
  tavily: import("./tavily/types.js").Tavily;
  valyu: import("./valyu/types.js").Valyu;
}
export type ProviderConfig<T extends ProviderId = ProviderId> =
  ProviderConfigMap[T];
