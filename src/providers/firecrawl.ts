import FirecrawlClient, {
  type Document,
  type SearchData,
} from "@mendable/firecrawl-js";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  Firecrawl,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SearchResult,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

type FirecrawlAdapter = ProviderAdapter<Firecrawl> & {
  search(
    query: string,
    maxResults: number,
    config: Firecrawl,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Firecrawl,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
};

export const firecrawlAdapter: FirecrawlAdapter = {
  id: "firecrawl",
  label: "Firecrawl",
  docsUrl: "https://docs.firecrawl.dev/sdks/node",
  tools: ["search", "contents"] as const,

  createTemplate(): Firecrawl {
    return {
      apiKey: "FIRECRAWL_API_KEY",
      options: {
        scrape: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      },
    };
  },

  getCapabilityStatus(config: Firecrawl | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Firecrawl) {
    return buildProviderPlan({
      request,
      config,
      providerId: firecrawlAdapter.id,
      providerLabel: firecrawlAdapter.label,
      handlers: {
        search: {
          execute: (
            searchRequest,
            providerConfig: Firecrawl,
            context: ProviderContext,
          ) =>
            firecrawlAdapter.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        },
        contents: {
          execute: (
            contentsRequest,
            providerConfig: Firecrawl,
            context: ProviderContext,
          ) =>
            firecrawlAdapter.contents(
              contentsRequest.urls,
              providerConfig,
              context,
              contentsRequest.options,
            ),
        },
      },
    });
  },

  async search(
    query: string,
    maxResults: number,
    config: Firecrawl,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const defaults =
      stripLocalExecutionOptions(asJsonObject(config.options?.search)) ?? {};
    const response = await client.search(query, {
      ...defaults,
      ...(options ?? {}),
      limit: maxResults,
    });

    return {
      provider: firecrawlAdapter.id,
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
    const defaults =
      stripLocalExecutionOptions(asJsonObject(config.options?.scrape)) ?? {};
    const scrapeOptions = {
      formats: ["markdown"],
      onlyMainContent: true,
      ...defaults,
      ...(options ?? {}),
    };

    return {
      provider: firecrawlAdapter.id,
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
};

function createClient(config: Firecrawl): FirecrawlClient {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new FirecrawlClient({
    apiKey,
    apiUrl: resolveConfigValue(config.baseUrl),
  });
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
