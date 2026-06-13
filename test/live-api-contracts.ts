import { TOOLS, type ProviderId, type Tool } from "../src/types.js";

export const API_PROVIDER_IDS = [
  "brave",
  "cloudflare",
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
] as const satisfies readonly ProviderId[];

export type ApiProviderId = (typeof API_PROVIDER_IDS)[number];

export interface LiveApiContract {
  provider: ApiProviderId;
  capability: Tool;
  secretEnvVars: readonly string[];
  query?: string;
  input?: string;
  urls?: readonly string[];
  maxResults?: number;
  options?: Record<string, unknown>;
  timeoutMs: number;
}

export const DEFAULT_LIVE_API_CAPABILITIES = [
  "search",
  "contents",
  "answer",
] as const satisfies readonly Tool[];

const SEARCH_QUERY = "IANA Example Domain example.com";
const ANSWER_QUERY =
  "What is the purpose of example.com according to IANA? Answer in one sentence.";
const RESEARCH_INPUT =
  "In two concise sentences, explain what example.com is used for and cite the source.";
const CONTENT_URLS = ["https://example.com/"] as const;

export const LIVE_API_CONTRACTS = [
  {
    provider: "brave",
    capability: "search",
    secretEnvVars: ["BRAVE_SEARCH_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    timeoutMs: 60_000,
  },
  {
    provider: "brave",
    capability: "answer",
    secretEnvVars: ["BRAVE_ANSWERS_API_KEY"],
    query: ANSWER_QUERY,
    timeoutMs: 120_000,
  },
  {
    provider: "brave",
    capability: "research",
    secretEnvVars: ["BRAVE_ANSWERS_API_KEY"],
    input: RESEARCH_INPUT,
    timeoutMs: 240_000,
  },
  {
    provider: "cloudflare",
    capability: "contents",
    secretEnvVars: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    urls: CONTENT_URLS,
    timeoutMs: 120_000,
  },
  {
    provider: "exa",
    capability: "search",
    secretEnvVars: ["EXA_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    options: { contents: { text: false } },
    timeoutMs: 60_000,
  },
  {
    provider: "exa",
    capability: "contents",
    secretEnvVars: ["EXA_API_KEY"],
    urls: CONTENT_URLS,
    timeoutMs: 90_000,
  },
  {
    provider: "exa",
    capability: "answer",
    secretEnvVars: ["EXA_API_KEY"],
    query: ANSWER_QUERY,
    timeoutMs: 120_000,
  },
  {
    provider: "exa",
    capability: "research",
    secretEnvVars: ["EXA_API_KEY"],
    input: RESEARCH_INPUT,
    timeoutMs: 240_000,
  },
  {
    provider: "firecrawl",
    capability: "search",
    secretEnvVars: ["FIRECRAWL_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    timeoutMs: 90_000,
  },
  {
    provider: "firecrawl",
    capability: "contents",
    secretEnvVars: ["FIRECRAWL_API_KEY"],
    urls: CONTENT_URLS,
    timeoutMs: 90_000,
  },
  {
    provider: "firecrawl",
    capability: "answer",
    secretEnvVars: ["FIRECRAWL_API_KEY"],
    query: ANSWER_QUERY,
    options: { url: CONTENT_URLS[0], onlyMainContent: true },
    timeoutMs: 120_000,
  },
  {
    provider: "gemini",
    capability: "search",
    secretEnvVars: ["GOOGLE_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    timeoutMs: 90_000,
  },
  {
    provider: "gemini",
    capability: "answer",
    secretEnvVars: ["GOOGLE_API_KEY"],
    query: ANSWER_QUERY,
    options: { config: { maxOutputTokens: 256 } },
    timeoutMs: 120_000,
  },
  {
    provider: "gemini",
    capability: "research",
    secretEnvVars: ["GOOGLE_API_KEY"],
    input: RESEARCH_INPUT,
    timeoutMs: 360_000,
  },
  {
    provider: "linkup",
    capability: "search",
    secretEnvVars: ["LINKUP_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    options: { depth: "standard" },
    timeoutMs: 90_000,
  },
  {
    provider: "linkup",
    capability: "contents",
    secretEnvVars: ["LINKUP_API_KEY"],
    urls: CONTENT_URLS,
    timeoutMs: 90_000,
  },
  {
    provider: "linkup",
    capability: "research",
    secretEnvVars: ["LINKUP_API_KEY"],
    input: RESEARCH_INPUT,
    options: { mode: "answer", reasoningDepth: "S" },
    timeoutMs: 240_000,
  },
  {
    provider: "ollama",
    capability: "search",
    secretEnvVars: ["OLLAMA_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    timeoutMs: 90_000,
  },
  {
    provider: "ollama",
    capability: "contents",
    secretEnvVars: ["OLLAMA_API_KEY"],
    urls: CONTENT_URLS,
    timeoutMs: 90_000,
  },
  {
    provider: "openai",
    capability: "search",
    secretEnvVars: ["OPENAI_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    options: {
      instructions: "Return concise source records for a test assertion.",
    },
    timeoutMs: 120_000,
  },
  {
    provider: "openai",
    capability: "answer",
    secretEnvVars: ["OPENAI_API_KEY"],
    query: ANSWER_QUERY,
    options: { instructions: "Keep the answer concise." },
    timeoutMs: 120_000,
  },
  {
    provider: "openai",
    capability: "research",
    secretEnvVars: ["OPENAI_API_KEY"],
    input: RESEARCH_INPUT,
    options: {
      instructions: "Keep the report to two sentences.",
      max_tool_calls: 2,
    },
    timeoutMs: 360_000,
  },
  {
    provider: "parallel",
    capability: "search",
    secretEnvVars: ["PARALLEL_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    options: { mode: "basic" },
    timeoutMs: 90_000,
  },
  {
    provider: "parallel",
    capability: "contents",
    secretEnvVars: ["PARALLEL_API_KEY"],
    urls: CONTENT_URLS,
    options: { full_content: true, excerpts: false },
    timeoutMs: 90_000,
  },
  {
    provider: "perplexity",
    capability: "search",
    secretEnvVars: ["PERPLEXITY_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    timeoutMs: 90_000,
  },
  {
    provider: "perplexity",
    capability: "answer",
    secretEnvVars: ["PERPLEXITY_API_KEY"],
    query: ANSWER_QUERY,
    options: { model: "sonar" },
    timeoutMs: 120_000,
  },
  {
    provider: "perplexity",
    capability: "research",
    secretEnvVars: ["PERPLEXITY_API_KEY"],
    input: RESEARCH_INPUT,
    options: { model: "sonar-deep-research" },
    timeoutMs: 360_000,
  },
  {
    provider: "serper",
    capability: "search",
    secretEnvVars: ["SERPER_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    options: { mode: "search", gl: "us", hl: "en" },
    timeoutMs: 60_000,
  },
  {
    provider: "tavily",
    capability: "search",
    secretEnvVars: ["TAVILY_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    options: { includeAnswer: false, includeRawContent: false },
    timeoutMs: 60_000,
  },
  {
    provider: "tavily",
    capability: "contents",
    secretEnvVars: ["TAVILY_API_KEY"],
    urls: CONTENT_URLS,
    timeoutMs: 90_000,
  },
  {
    provider: "valyu",
    capability: "search",
    secretEnvVars: ["VALYU_API_KEY"],
    query: SEARCH_QUERY,
    maxResults: 2,
    options: { searchType: "web", responseLength: "short" },
    timeoutMs: 90_000,
  },
  {
    provider: "valyu",
    capability: "contents",
    secretEnvVars: ["VALYU_API_KEY"],
    urls: CONTENT_URLS,
    timeoutMs: 90_000,
  },
  {
    provider: "valyu",
    capability: "answer",
    secretEnvVars: ["VALYU_API_KEY"],
    query: ANSWER_QUERY,
    options: { responseLength: "short" },
    timeoutMs: 120_000,
  },
  {
    provider: "valyu",
    capability: "research",
    secretEnvVars: ["VALYU_API_KEY"],
    input: RESEARCH_INPUT,
    options: { responseLength: "short" },
    timeoutMs: 240_000,
  },
] as const satisfies readonly LiveApiContract[];

export function selectLiveApiContracts(
  env: NodeJS.ProcessEnv = process.env,
): LiveApiContract[] {
  const providers = parseProviderFilter(env);
  const capabilities = parseCapabilityFilter(env);

  return LIVE_API_CONTRACTS.filter(
    (contract) =>
      providers.includes(contract.provider) &&
      capabilities.includes(contract.capability),
  );
}

export function getMissingLiveApiSecrets(
  contracts: readonly LiveApiContract[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const secretNames = new Set(
    contracts.flatMap((contract) => contract.secretEnvVars),
  );
  return [...secretNames].filter((name) => !env[name]?.trim()).sort();
}

function parseProviderFilter(env: NodeJS.ProcessEnv): ApiProviderId[] {
  const raw = parseCsv(env.LIVE_API_PROVIDERS);
  if (raw.length === 0) {
    return [...API_PROVIDER_IDS];
  }

  const unknown = raw.filter((value) => !isApiProviderId(value));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown LIVE_API_PROVIDERS value(s): ${unknown.join(", ")}.`,
    );
  }

  return raw as ApiProviderId[];
}

function parseCapabilityFilter(env: NodeJS.ProcessEnv): Tool[] {
  const raw = parseCsv(env.LIVE_API_CAPABILITIES);
  if (raw.length === 0) {
    return env.LIVE_API_INCLUDE_RESEARCH === "1"
      ? [...TOOLS]
      : [...DEFAULT_LIVE_API_CAPABILITIES];
  }

  const unknown = raw.filter((value) => !isTool(value));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown LIVE_API_CAPABILITIES value(s): ${unknown.join(", ")}.`,
    );
  }

  return raw as Tool[];
}

function parseCsv(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0) ?? []
  );
}

function isApiProviderId(value: string): value is ApiProviderId {
  return (API_PROVIDER_IDS as readonly string[]).includes(value);
}

function isTool(value: string): value is Tool {
  return (TOOLS as readonly string[]).includes(value);
}
