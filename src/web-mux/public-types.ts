import type { ContentsAnswer } from "../contents.js";
import type { SearchResult } from "../types.js";

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
export const CAPABILITIES = [
  "search",
  "contents",
  "answer",
  "research",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type CredentialSource =
  | { env: string }
  | { command: [string, ...string[]] }
  | { value: string };

export interface ExecutionConfig {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  researchTimeoutMs?: number;
}

export interface CapabilityDefault {
  provider?: ProviderId;
  options?: Record<string, unknown>;
  maxResults?: number;
}

export interface CustomCommand {
  argv: [string, ...string[]];
  cwd?: string;
  env?: Record<string, CredentialSource>;
}

export interface ProviderConfiguration {
  credentials?: Record<string, CredentialSource>;
  baseUrl?: string;
  accountId?: CredentialSource;
  codexPath?: string;
  pathToClaudeCodeExecutable?: string;
  env?: Record<string, CredentialSource>;
  config?: Record<string, unknown>;
  options?: Partial<Record<Capability, Record<string, unknown>>>;
  commands?: Partial<Record<Capability, CustomCommand>>;
}

export interface WebMuxConfig {
  $schema?: string;
  defaults?: Partial<Record<Capability, CapabilityDefault>>;
  execution?: ExecutionConfig;
  providers?: Partial<Record<ProviderId, ProviderConfiguration>>;
}

export interface ProgressEvent {
  capability: Capability;
  provider: ProviderId;
  message: string;
}

export interface RequestOptions {
  provider?: ProviderId;
  options?: Record<string, unknown>;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  raw?: boolean;
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

export interface SerializedError {
  code: WebMuxErrorCode;
  message: string;
  retryable?: boolean;
}

export interface InputResult<T> {
  input: string;
  ok: boolean;
  value?: T;
  error?: SerializedError;
  raw?: {
    providerPayload: unknown;
  };
}

export interface CapabilityDocument<
  T,
  TCapability extends Capability = Capability,
> {
  schemaVersion: 1;
  capability: TCapability;
  provider: ProviderId;
  status: "ok" | "partial";
  results: Array<InputResult<T>>;
}

export type SearchDocument = CapabilityDocument<
  { results: SearchResult[] },
  "search"
>;
export type ContentsDocument = CapabilityDocument<ContentsAnswer, "contents">;
export type AnswerDocument = CapabilityDocument<
  { text: string; itemCount?: number; metadata?: Record<string, unknown> },
  "answer"
>;
export type ResearchDocument = CapabilityDocument<
  { text: string; itemCount?: number; metadata?: Record<string, unknown> },
  "research"
>;

export interface ProviderCredentialMetadata {
  name: string;
  environmentVariable: string;
  capabilities?: readonly Capability[];
}

export interface ProviderMetadata {
  id: ProviderId;
  label: string;
  docsUrl: string;
  capabilities: readonly Capability[];
  credentials: readonly ProviderCredentialMetadata[];
  local: boolean;
}

export const WEB_MUX_ERROR_CODES = [
  "INVALID_CONFIG",
  "INVALID_INPUT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_FAILURE",
  "PARTIAL_BATCH",
  "TIMEOUT",
  "CANCELLED",
] as const;

export type WebMuxErrorCode = (typeof WEB_MUX_ERROR_CODES)[number];

export interface CreateWebMuxOptions {
  config?: WebMuxConfig;
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface WebMuxClient {
  search(options: SearchOptions): Promise<SearchDocument>;
  contents(options: ContentsOptions): Promise<ContentsDocument>;
  answer(options: AnswerOptions): Promise<AnswerDocument>;
  research(options: ResearchOptions): Promise<ResearchDocument>;
  listProviders(): readonly ProviderMetadata[];
  getProvider(id: ProviderId): ProviderMetadata | undefined;
  getProviderOptionSchema(
    id: ProviderId,
    capability: Capability,
  ): Promise<Record<string, unknown> | undefined>;
}
