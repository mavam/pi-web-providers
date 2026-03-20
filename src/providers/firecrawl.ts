import FirecrawlClient from "@mendable/firecrawl-js";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import { createSilentForegroundPlan } from "../provider-plans.js";
import type {
  Firecrawl as FirecrawlProviderConfig,
  ProviderAdapter,
  ProviderContext,
  ProviderRequest,
  ProviderStatus,
  SearchResponse,
} from "../types.js";
import { asJsonObject, formatJson, trimSnippet } from "./shared.js";

type FirecrawlDocument = {
  markdown?: string;
  html?: string;
  summary?: string;
  metadata?: {
    title?: string;
    description?: string;
    url?: string;
    sourceURL?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type FirecrawlSearchResult = {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  imageUrl?: string;
  date?: string;
  position?: number;
  category?: string;
  [key: string]: unknown;
};

type FirecrawlSearchData = {
  web?: Array<FirecrawlSearchResult | FirecrawlDocument>;
  news?: Array<FirecrawlSearchResult | FirecrawlDocument>;
  images?: Array<FirecrawlSearchResult | FirecrawlDocument>;
};

type FirecrawlBatchJob = {
  id?: string;
  status?: string;
  data?: FirecrawlDocument[];
};

type FirecrawlBatchErrors = {
  errors?: Array<{
    url?: string;
    error?: string;
    [key: string]: unknown;
  }>;
};

export class FirecrawlAdapter
  implements ProviderAdapter<FirecrawlProviderConfig>
{
  readonly id: "firecrawl" = "firecrawl";
  readonly label = "Firecrawl";
  readonly docsUrl = "https://docs.firecrawl.dev/sdks/node";
  readonly tools = ["search", "contents"] as const;

  createTemplate(): FirecrawlProviderConfig {
    return {
      enabled: false,
      apiKey: "FIRECRAWL_API_KEY",
      options: {
        search: {
          sources: ["web"],
        },
        scrape: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      },
    };
  }

  getStatus(config: FirecrawlProviderConfig | undefined): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }

  buildPlan(request: ProviderRequest, config: FirecrawlProviderConfig) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.search(
              request.query,
              request.maxResults,
              config,
              context,
              request.options,
            ),
        });
      case "contents":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.contents(request.urls, config, context, request.options),
        });
      default:
        return null;
    }
  }

  async search(
    query: string,
    maxResults: number,
    config: FirecrawlProviderConfig,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const defaults =
      stripLocalExecutionOptions(asJsonObject(config.options?.search)) ?? {};
    const response = (await client.search(query, {
      ...defaults,
      ...(options ?? {}),
      limit: maxResults,
    })) as FirecrawlSearchData;

    return {
      provider: this.id,
      results: flattenSearchResults(response)
        .slice(0, maxResults)
        .map((result) => normalizeSearchResult(result)),
    };
  }

  async contents(
    urls: string[],
    config: FirecrawlProviderConfig,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = this.createClient(config);
    const scrapeOptions = {
      ...(stripLocalExecutionOptions(asJsonObject(config.options?.scrape)) ??
        {}),
      ...(options ?? {}),
    };

    if (urls.length === 1) {
      const document = (await client.scrape(
        urls[0] as string,
        scrapeOptions,
      )) as FirecrawlDocument;

      return {
        provider: this.id,
        answers: [
          {
            url: urls[0] as string,
            ...normalizeContentsDocument(document),
          },
        ],
      };
    }

    const batch = (await client.batchScrape(urls, {
      options: scrapeOptions,
    })) as unknown as FirecrawlBatchJob;
    const documentsByUrl = new Map<string, FirecrawlDocument>();

    for (const document of batch.data ?? []) {
      const documentUrl = getDocumentUrl(document);
      if (documentUrl && !documentsByUrl.has(documentUrl)) {
        documentsByUrl.set(documentUrl, document);
      }
    }

    const errorsByUrl = await this.getBatchErrorsByUrl(client, batch.id);

    return {
      provider: this.id,
      answers: urls.map((url) => {
        const document = documentsByUrl.get(url);
        if (document) {
          return {
            url,
            ...normalizeContentsDocument(document),
          };
        }

        const error = errorsByUrl.get(url);
        return error
          ? {
              url,
              error,
            }
          : {
              url,
              error: "No content returned for this URL.",
            };
      }),
    };
  }

  private async getBatchErrorsByUrl(
    client: FirecrawlClient,
    jobId: string | undefined,
  ): Promise<Map<string, string>> {
    if (!jobId) {
      return new Map();
    }

    try {
      const response = (await client.getBatchScrapeErrors(
        jobId,
      )) as FirecrawlBatchErrors;
      return new Map(
        (response.errors ?? [])
          .filter(
            (error): error is { url: string; error?: string } =>
              typeof error.url === "string",
          )
          .map(
            (error) => [error.url, error.error ?? formatJson(error)] as const,
          ),
      );
    } catch {
      return new Map();
    }
  }

  private createClient(config: FirecrawlProviderConfig): FirecrawlClient {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Firecrawl is missing an API key.");
    }

    return new FirecrawlClient({
      apiKey,
      apiUrl: resolveConfigValue(config.baseUrl),
    });
  }
}

function flattenSearchResults(response: FirecrawlSearchData) {
  return [
    ...(response.web ?? []),
    ...(response.news ?? []),
    ...(response.images ?? []),
  ];
}

function normalizeSearchResult(
  result: FirecrawlSearchResult | FirecrawlDocument,
): SearchResponse["results"][number] {
  if (isDocument(result)) {
    return {
      title: result.metadata?.title ?? getDocumentUrl(result) ?? "Untitled",
      url: getDocumentUrl(result) ?? "",
      snippet: trimSnippet(
        result.metadata?.description ??
          result.summary ??
          result.markdown ??
          result.html,
      ),
      metadata: result as Record<string, unknown>,
    };
  }

  return {
    title: result.title ?? result.url ?? result.imageUrl ?? "Untitled",
    url: result.url ?? result.imageUrl ?? "",
    snippet: trimSnippet(result.description ?? result.snippet ?? ""),
    metadata: buildSearchMetadata(result),
  };
}

function buildSearchMetadata(
  result: FirecrawlSearchResult,
): Record<string, unknown> | undefined {
  const metadata = Object.fromEntries(
    Object.entries({
      ...(result.date !== undefined ? { date: result.date } : {}),
      ...(result.position !== undefined ? { position: result.position } : {}),
      ...(result.category !== undefined ? { category: result.category } : {}),
      ...(result.imageUrl !== undefined ? { imageUrl: result.imageUrl } : {}),
    }).filter(([, value]) => value !== undefined),
  );
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function normalizeContentsDocument(document: FirecrawlDocument) {
  return {
    ...(resolveDocumentContent(document)
      ? { content: resolveDocumentContent(document) }
      : {}),
    ...(document.summary !== undefined ? { summary: document.summary } : {}),
    metadata: document as Record<string, unknown>,
  };
}

function resolveDocumentContent(
  document: FirecrawlDocument,
): string | undefined {
  const content =
    typeof document.markdown === "string"
      ? document.markdown
      : typeof document.summary === "string"
        ? document.summary
        : typeof document.html === "string"
          ? document.html
          : undefined;
  return content?.trim() ? content : undefined;
}

function getDocumentUrl(document: FirecrawlDocument): string | undefined {
  return document.metadata?.sourceURL ?? document.metadata?.url;
}

function isDocument(
  value: FirecrawlSearchResult | FirecrawlDocument,
): value is FirecrawlDocument {
  return (
    "metadata" in value ||
    "markdown" in value ||
    "html" in value ||
    "summary" in value
  );
}
