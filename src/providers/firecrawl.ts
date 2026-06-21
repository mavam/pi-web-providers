import FirecrawlClient, {
  type Document,
  type SearchData,
} from "@mendable/firecrawl-js";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import type {
  Firecrawl,
  ProviderCapabilityStatus,
  ProviderCapabilityStatusOptions,
  ProviderContext,
  SearchResponse,
  SearchResult,
  ToolOutput,
  Tool,
} from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { literalUnion } from "./schema.js";
import {
  asJsonObject,
  formatJson,
  getApiKeyStatus,
  trimSnippet,
} from "./shared.js";

const FIRECRAWL_CLOUD_HOST = "api.firecrawl.dev";
const FIRECRAWL_DEFAULT_API_URL = "https://api.firecrawl.dev";
const FIRECRAWL_QUESTION_LIMIT = 10_000;

const firecrawlSearchOptionsSchema = Type.Object(
  {
    lang: Type.Optional(
      Type.String({
        description: "Language code for search results (for example 'en').",
      }),
    ),
    country: Type.Optional(
      Type.String({
        description: "Country code for search results (for example 'us').",
      }),
    ),
    sources: Type.Optional(
      Type.Array(Type.String(), {
        description: "Search source groups to include.",
      }),
    ),
    categories: Type.Optional(
      Type.Array(Type.String(), {
        description: "Search categories to include.",
      }),
    ),
    includeDomains: Type.Optional(
      Type.Array(Type.String(), {
        description: "Restrict results to these domains.",
      }),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String(), {
        description: "Exclude these domains.",
      }),
    ),
    tbs: Type.Optional(
      Type.String({
        description: "Google-style time-based search filter.",
      }),
    ),
    ignoreInvalidURLs: Type.Optional(
      Type.Boolean({
        description: "Ignore invalid result URLs returned by search.",
      }),
    ),
    location: Type.Optional(
      Type.Object(
        {
          country: Type.Optional(Type.String({ description: "Country hint." })),
          region: Type.Optional(Type.String({ description: "Region hint." })),
          city: Type.Optional(Type.String({ description: "City hint." })),
        },
        { description: "Location hint for search." },
      ),
    ),
    timeout: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Request timeout in milliseconds.",
      }),
    ),
    scrapeOptions: Type.Optional(
      Type.Object(
        {
          formats: Type.Optional(
            Type.Array(
              literalUnion([
                "markdown",
                "html",
                "rawHtml",
                "links",
                "images",
                "screenshot",
                "summary",
                "json",
                "attributes",
              ]),
              {
                description: "Output formats.",
              },
            ),
          ),
          onlyMainContent: Type.Optional(
            Type.Boolean({ description: "Extract only the main content." }),
          ),
        },
        {
          description: "Options for scraping each search result.",
        },
      ),
    ),
  },
  { description: "Firecrawl search options." },
);

const firecrawlSearchPromptGuidelines = [
  "Use Firecrawl search when the task benefits from searchable results that can also include scraped page content through scrapeOptions.",
  "Set scrapeOptions.formats=['markdown'] and onlyMainContent=true when source snippets are not enough and the user needs extracted page context in the search results.",
  "Use includeDomains/excludeDomains when search should stay within or avoid specific sites.",
  "Use lang, country, or location when the user asks for language-specific, country-specific, or local results.",
  "Prefer web_contents with Firecrawl scrape options after search when only a small set of known URLs needs full extraction.",
] as const;

const firecrawlScrapeOptionsSchema = Type.Object(
  {
    formats: Type.Optional(
      Type.Array(
        literalUnion([
          "markdown",
          "html",
          "rawHtml",
          "links",
          "images",
          "screenshot",
          "summary",
          "json",
          "attributes",
          "changeTracking",
        ]),
        {
          description: "Output formats for scraping.",
        },
      ),
    ),
    onlyMainContent: Type.Optional(
      Type.Boolean({ description: "Extract only the main content." }),
    ),
    includeTags: Type.Optional(
      Type.Array(Type.String(), { description: "CSS selectors to include." }),
    ),
    excludeTags: Type.Optional(
      Type.Array(Type.String(), { description: "CSS selectors to exclude." }),
    ),
    waitFor: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Milliseconds to wait before scraping.",
      }),
    ),
    timeout: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Request timeout in milliseconds.",
      }),
    ),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Headers to send when scraping.",
      }),
    ),
    location: Type.Optional(
      Type.Object(
        {
          country: Type.Optional(Type.String({ description: "Country hint." })),
          region: Type.Optional(Type.String({ description: "Region hint." })),
          city: Type.Optional(Type.String({ description: "City hint." })),
        },
        { description: "Location hint for scraping." },
      ),
    ),
    mobile: Type.Optional(
      Type.Boolean({ description: "Use a mobile browser profile." }),
    ),
    proxy: Type.Optional(
      Type.String({
        description: "Proxy mode passed through to the Firecrawl SDK.",
      }),
    ),
    fastMode: Type.Optional(
      Type.Boolean({ description: "Use Firecrawl fast mode." }),
    ),
    blockAds: Type.Optional(
      Type.Boolean({ description: "Block ads while scraping." }),
    ),
    removeBase64Images: Type.Optional(
      Type.Boolean({
        description: "Remove base64 image data from scraped output.",
      }),
    ),
    redactPII: Type.Optional(
      Type.Union(
        [
          Type.Boolean(),
          Type.Object(
            {
              entities: Type.Optional(
                Type.Array(
                  literalUnion([
                    "PERSON",
                    "EMAIL",
                    "PHONE",
                    "LOCATION",
                    "FINANCIAL",
                    "SECRET",
                  ]),
                ),
              ),
            },
            { additionalProperties: false },
          ),
        ],
        { description: "Redact personal or sensitive data from output." },
      ),
    ),
    maxAge: Type.Optional(
      Type.Number({
        description: "Maximum age of cached scrape data in milliseconds.",
      }),
    ),
    minAge: Type.Optional(
      Type.Number({
        description: "Minimum age of cached scrape data in milliseconds.",
      }),
    ),
    storeInCache: Type.Optional(
      Type.Boolean({ description: "Store scrape result in Firecrawl cache." }),
    ),
    skipTlsVerification: Type.Optional(
      Type.Boolean({ description: "Skip TLS certificate verification." }),
    ),
  },
  { description: "Firecrawl scrape options." },
);

const firecrawlAnswerOptionsSchema = Type.Object(
  {
    url: Type.String({
      minLength: 1,
      description: "URL of the page to ask about.",
    }),
    onlyMainContent: Type.Optional(
      Type.Boolean({ description: "Extract only the main content." }),
    ),
    includeTags: Type.Optional(
      Type.Array(Type.String(), { description: "CSS selectors to include." }),
    ),
    excludeTags: Type.Optional(
      Type.Array(Type.String(), { description: "CSS selectors to exclude." }),
    ),
    waitFor: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Milliseconds to wait before scraping.",
      }),
    ),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Headers to send when scraping.",
      }),
    ),
    location: Type.Optional(
      Type.Object(
        {
          country: Type.Optional(Type.String({ description: "Country hint." })),
          region: Type.Optional(Type.String({ description: "Region hint." })),
          city: Type.Optional(Type.String({ description: "City hint." })),
        },
        { description: "Location hint for scraping." },
      ),
    ),
    mobile: Type.Optional(
      Type.Boolean({ description: "Use a mobile browser profile." }),
    ),
    proxy: Type.Optional(
      Type.String({
        description: "Proxy mode passed through to Firecrawl.",
      }),
    ),
    fastMode: Type.Optional(
      Type.Boolean({ description: "Use Firecrawl fast mode." }),
    ),
    blockAds: Type.Optional(
      Type.Boolean({ description: "Block ads while scraping." }),
    ),
    removeBase64Images: Type.Optional(
      Type.Boolean({
        description: "Remove base64 image data from scraped output.",
      }),
    ),
    redactPII: Type.Optional(
      Type.Union(
        [
          Type.Boolean(),
          Type.Object(
            {
              entities: Type.Optional(
                Type.Array(
                  literalUnion([
                    "PERSON",
                    "EMAIL",
                    "PHONE",
                    "LOCATION",
                    "FINANCIAL",
                    "SECRET",
                  ]),
                ),
              ),
            },
            { additionalProperties: false },
          ),
        ],
        { description: "Redact personal or sensitive data from output." },
      ),
    ),
    maxAge: Type.Optional(
      Type.Number({
        description: "Maximum age of cached scrape data in milliseconds.",
      }),
    ),
    minAge: Type.Optional(
      Type.Number({
        description: "Minimum age of cached scrape data in milliseconds.",
      }),
    ),
    storeInCache: Type.Optional(
      Type.Boolean({ description: "Store scrape result in Firecrawl cache." }),
    ),
    skipTlsVerification: Type.Optional(
      Type.Boolean({ description: "Skip TLS certificate verification." }),
    ),
  },
  {
    description:
      "Firecrawl page-question options. The URL is required; the question comes from the web_answer query.",
  },
);

const firecrawlImplementation = {
  id: "firecrawl" as const,
  label: "Firecrawl",
  docsUrl: "https://docs.firecrawl.dev/sdks/node",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return firecrawlSearchOptionsSchema;
      case "contents":
        return firecrawlScrapeOptionsSchema;
      case "answer":
        return firecrawlAnswerOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Firecrawl {
    return {
      credentials: { api: "FIRECRAWL_API_KEY" },
      options: {
        scrape: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      },
    };
  },

  getCapabilityStatus(
    config: Firecrawl | undefined,
    _cwd: string,
    _tool: Tool | undefined,
    options?: ProviderCapabilityStatusOptions,
  ): ProviderCapabilityStatus {
    return getFirecrawlCapabilityStatus(config, options);
  },

  async search(
    query: string,
    maxResults: number,
    config: Firecrawl,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.search) ?? {};
    const response = await client.search(query, {
      ...defaults,
      ...(options ?? {}),
      limit: maxResults,
    });

    return {
      provider: firecrawlImplementation.id,
      results: flattenSearchResults(response).slice(0, maxResults),
    };
  },

  async contents(
    urls: string[],
    config: Firecrawl,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.scrape) ?? {};
    const scrapeOptions = {
      formats: ["markdown"],
      onlyMainContent: true,
      ...defaults,
      ...(options ?? {}),
    };

    return {
      provider: firecrawlImplementation.id,
      answers: await Promise.all(
        urls.map(async (url) => {
          try {
            const document = await client.scrape(url, scrapeOptions as never);
            const content = getDocumentContent(document);
            return content
              ? {
                  url,
                  content,
                  ...(document.metadata
                    ? {
                        metadata: document.metadata as Record<string, unknown>,
                      }
                    : {}),
                }
              : {
                  url,
                  error: "No content returned for this URL.",
                };
          } catch (error) {
            return {
              url,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      ),
    };
  },

  async answer(
    query: string,
    config: Firecrawl,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const question = validateQuestion(query);
    const defaults = asJsonObject(config.options?.scrape);
    const answerDefaults = asJsonObject(config.options?.answer);
    const mergedOptions: Record<string, unknown> = {
      onlyMainContent: true,
      ...defaults,
      ...answerDefaults,
      ...(options ?? {}),
    };
    const url = validateUrl(mergedOptions.url);
    const scrapeOptions = stripAnswerOnlyOptions(mergedOptions);
    const response = await scrapeQuestion(config, url, question, scrapeOptions);
    const document = getFirecrawlDocument(response);
    const answer = readString(document.answer);

    if (!answer?.trim()) {
      throw new Error("No answer returned for this URL.");
    }

    return {
      provider: firecrawlImplementation.id,
      text: answer.trim(),
      itemCount: 1,
      metadata: {
        url,
        ...(asRecord(document.metadata)
          ? { metadata: document.metadata as Record<string, unknown> }
          : {}),
      },
    };
  },
};

function createClient(config: Firecrawl): FirecrawlClient {
  const apiUrl = resolveConfigValue(config.baseUrl);
  const apiKey = resolveConfigValue(config.credentials?.api);
  if (isFirecrawlCloudApiUrl(apiUrl) && !apiKey) {
    throw new Error("is missing an API key");
  }

  return new FirecrawlClient({
    apiKey,
    apiUrl,
  });
}

function getFirecrawlCapabilityStatus(
  config: Firecrawl | undefined,
  options?: ProviderCapabilityStatusOptions,
): ProviderCapabilityStatus {
  if (!config?.baseUrl || isFirecrawlCloudApiUrl(config.baseUrl)) {
    return getApiKeyStatus(config?.credentials?.api, options);
  }

  const apiKeyStatus = getApiKeyStatus(config.credentials?.api, options);
  return apiKeyStatus.state === "missing_api_key"
    ? { state: "ready" }
    : apiKeyStatus;
}

function isFirecrawlCloudApiUrl(apiUrl: string | undefined): boolean {
  return !apiUrl || apiUrl.includes(FIRECRAWL_CLOUD_HOST);
}

function validateQuestion(query: string): string {
  const question = query.trim();
  if (!question) {
    throw new Error("question must be a non-empty string.");
  }
  if (question.length > FIRECRAWL_QUESTION_LIMIT) {
    throw new Error(
      `Firecrawl question must be at most ${FIRECRAWL_QUESTION_LIMIT} characters.`,
    );
  }
  return question;
}

function validateUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Firecrawl answer requires options.url.");
  }
  return value.trim();
}

function stripAnswerOnlyOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const { url: _url, formats: _formats, ...scrapeOptions } = options;
  return scrapeOptions;
}

async function scrapeQuestion(
  config: Firecrawl,
  url: string,
  question: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  const apiUrl =
    resolveConfigValue(config.baseUrl) ?? FIRECRAWL_DEFAULT_API_URL;
  const apiKey = resolveConfigValue(config.credentials?.api);
  if (isFirecrawlCloudApiUrl(apiUrl) && !apiKey) {
    throw new Error("is missing an API key");
  }

  const response = await fetch(joinUrl(apiUrl, "/v2/scrape"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      ...options,
      url,
      formats: [{ type: "question", question }],
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(readFirecrawlError(payload, response.statusText));
  }
  if (isFirecrawlFailure(payload)) {
    throw new Error(readFirecrawlError(payload, "Firecrawl scrape failed."));
  }
  return payload;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}/${path.replace(/^\/+/g, "")}`;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isFirecrawlFailure(value: unknown): boolean {
  const record = asRecord(value);
  return record?.success === false || record?.error !== undefined;
}

function readFirecrawlError(value: unknown, fallback: string): string {
  const record = asRecord(value);
  return (
    readString(record?.error) ??
    readString(record?.message) ??
    (typeof value === "string" ? value : undefined) ??
    fallback
  );
}

function getFirecrawlDocument(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const data = asRecord(record?.data);
  if (data) {
    return data;
  }
  if (record) {
    return record;
  }
  throw new Error(`Unexpected Firecrawl response: ${formatJson(value)}`);
}

function flattenSearchResults(response: SearchData): SearchResult[] {
  return (["web", "news", "images"] as const).flatMap((source) =>
    (response[source] ?? [])
      .map((entry) => toSearchResult(source, entry))
      .filter((entry): entry is SearchResult => entry !== null),
  );
}

function toSearchResult(
  source: "web" | "news" | "images",
  value: unknown,
): SearchResult | null {
  const entry = asRecord(value);
  if (!entry) {
    return null;
  }

  const metadata = asRecord(entry.metadata);
  const url =
    readString(entry.url) ??
    readString(metadata?.sourceURL) ??
    readString(entry.imageUrl) ??
    "";
  const title = readString(entry.title) ?? readString(metadata?.title) ?? url;
  const snippet = trimSnippet(
    readString(entry.description) ??
      readString(entry.snippet) ??
      readString(entry.markdown) ??
      readString(metadata?.description) ??
      "",
  );
  const resultMetadata = {
    source,
    ...(readString(entry.category) ? { category: entry.category } : {}),
    ...(readString(entry.date) ? { date: entry.date } : {}),
    ...(readString(entry.imageUrl) ? { imageUrl: entry.imageUrl } : {}),
    ...(typeof entry.position === "number" ? { position: entry.position } : {}),
    ...(metadata ?? {}),
  };

  return {
    title: title || "Untitled",
    url,
    snippet,
    metadata:
      Object.keys(resultMetadata).length > 1 ? resultMetadata : undefined,
  };
}

function getDocumentContent(document: Document): string | undefined {
  if (typeof document.markdown === "string" && document.markdown.trim()) {
    return document.markdown;
  }
  if (typeof document.html === "string" && document.html.trim()) {
    return document.html;
  }
  if (typeof document.rawHtml === "string" && document.rawHtml.trim()) {
    return document.rawHtml;
  }
  return document.json !== undefined
    ? JSON.stringify(document.json, null, 2)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const firecrawlProvider = defineProvider({
  id: "firecrawl" as const,
  label: firecrawlImplementation.label,
  docsUrl: firecrawlImplementation.docsUrl,
  config: {
    createTemplate: () => firecrawlImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
  },
  getCapabilityStatus: (config, cwd, tool, options) =>
    (firecrawlImplementation.getCapabilityStatus as any)(
      config as Firecrawl | undefined,
      cwd,
      tool,
      options,
    ),
  capabilities: {
    search: defineCapability({
      options: firecrawlImplementation.getToolOptionsSchema?.("search"),
      promptGuidelines: firecrawlSearchPromptGuidelines,
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await firecrawlImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    contents: defineCapability({
      options: firecrawlImplementation.getToolOptionsSchema?.("contents"),
      async execute(input: any, ctx) {
        return await firecrawlImplementation.contents!(
          input.urls,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    answer: defineCapability({
      options: firecrawlImplementation.getToolOptionsSchema?.("answer"),
      promptGuidelines: [
        "Firecrawl web_answer is page-scoped: set options.url to the specific page URL to ask about.",
        "Do not use Firecrawl web_answer for general multi-source answers; use web_search plus web_contents or web_research instead.",
      ],
      async execute(input: any, ctx) {
        return await firecrawlImplementation.answer!(
          input.query,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
