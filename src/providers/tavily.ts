import { type TObject, Type } from "@sinclair/typebox";
import {
  type TavilyClient,
  type TavilyExtractResponse,
  type TavilySearchResponse,
  tavily,
} from "@tavily/core";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  Tavily,
  Tool,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { literalUnion } from "./schema.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

type TavilyAdapter = ProviderAdapter<Tavily> & {
  search(
    query: string,
    maxResults: number,
    config: Tavily,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Tavily,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
};

const tavilySearchOptionsSchema = Type.Object(
  {
    topic: Type.Optional(
      literalUnion(["general", "news", "finance"], {
        description: "Category of the search query.",
      }),
    ),
    searchDepth: Type.Optional(
      literalUnion(["basic", "advanced"], {
        description:
          "Depth of the search. 'advanced' is slower but more thorough.",
      }),
    ),
    timeRange: Type.Optional(
      Type.String({ description: "Named time range filter." }),
    ),
    country: Type.Optional(
      Type.String({ description: "Country hint for search results." }),
    ),
    exactMatch: Type.Optional(
      Type.Boolean({ description: "Prefer exact matches." }),
    ),
    includeAnswer: Type.Optional(
      Type.Boolean({ description: "Include a short AI-generated answer." }),
    ),
    includeRawContent: Type.Optional(
      Type.Boolean({ description: "Include raw page content in results." }),
    ),
    includeImages: Type.Optional(
      Type.Boolean({ description: "Include related images." }),
    ),
    includeFavicon: Type.Optional(
      Type.Boolean({ description: "Include favicon URLs." }),
    ),
    includeDomains: Type.Optional(
      Type.Array(Type.String(), {
        description: "Restrict results to these domains.",
      }),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String(), {
        description: "Exclude these domains from results.",
      }),
    ),
    days: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Limit results to the last N days.",
      }),
    ),
  },
  { description: "Tavily search options." },
);

const tavilyExtractOptionsSchema = Type.Object(
  {
    extractDepth: Type.Optional(
      Type.String({ description: "Depth setting for extraction." }),
    ),
    format: Type.Optional(
      literalUnion(["markdown", "text"], {
        description: "Output format for extracted content.",
      }),
    ),
    includeImages: Type.Optional(
      Type.Boolean({ description: "Include extracted images." }),
    ),
    query: Type.Optional(
      Type.String({ description: "Optional query to focus extraction." }),
    ),
    chunksPerSource: Type.Optional(
      Type.Integer({ minimum: 1, description: "Maximum chunks per source." }),
    ),
    includeFavicon: Type.Optional(
      Type.Boolean({ description: "Include favicon URLs." }),
    ),
  },
  { description: "Tavily extract options." },
);

export const tavilyAdapter: TavilyAdapter = {
  id: "tavily",
  label: "Tavily",
  docsUrl: "https://docs.tavily.com/sdk/javascript/reference",
  tools: ["search", "contents"] as const,

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return tavilySearchOptionsSchema;
      case "contents":
        return tavilyExtractOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Tavily {
    return {
      apiKey: "TAVILY_API_KEY",
      options: {
        search: {
          includeFavicon: true,
        },
        extract: {
          format: "markdown",
          includeFavicon: true,
        },
      },
    };
  },

  getConfigForCapability(capability: Tool, config: Tavily): unknown {
    switch (capability) {
      case "search":
        return {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          options: config.options?.search,
          settings: config.settings,
        };
      case "contents":
        return {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          options: config.options?.extract,
          settings: config.settings,
        };
      default:
        return config;
    }
  },

  getCapabilityStatus(config: Tavily | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Tavily) {
    return buildProviderPlan({
      request,
      config,
      providerId: tavilyAdapter.id,
      providerLabel: tavilyAdapter.label,
      handlers: {
        search: {
          execute: (
            searchRequest,
            providerConfig: Tavily,
            context: ProviderContext,
          ) =>
            tavilyAdapter.search(
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
            providerConfig: Tavily,
            context: ProviderContext,
          ) =>
            tavilyAdapter.contents(
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
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const defaults =
      stripLocalExecutionOptions(asJsonObject(config.options?.search)) ?? {};

    const response = await client.search(query, {
      ...defaults,
      ...(options ?? {}),
      maxResults,
    });

    return {
      provider: tavilyAdapter.id,
      results: response.results.slice(0, maxResults).map((result) => ({
        title: result.title || result.url || "Untitled",
        url: result.url || "",
        snippet: trimSnippet(result.content ?? result.rawContent),
        score: typeof result.score === "number" ? result.score : undefined,
        metadata: buildSearchMetadata(response, result),
      })),
    };
  },

  async contents(
    urls: string[],
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const defaults =
      stripLocalExecutionOptions(asJsonObject(config.options?.extract)) ?? {};

    const response = await client.extract(urls, {
      ...defaults,
      ...(options ?? {}),
    });

    const resultsByUrl = new Map(
      response.results.map((result) => [result.url, result] as const),
    );
    const failedResultsByUrl = new Map(
      response.failedResults.map((result) => [result.url, result] as const),
    );

    return {
      provider: tavilyAdapter.id,
      answers: urls.map((url) => {
        const result = resultsByUrl.get(url);
        if (result) {
          return {
            url,
            ...(typeof result.rawContent === "string"
              ? { content: result.rawContent }
              : {}),
            metadata: buildExtractMetadata(response, result),
          };
        }

        const failedResult = failedResultsByUrl.get(url);
        if (failedResult) {
          return {
            url,
            error: failedResult.error || "Content extraction failed.",
          };
        }

        return {
          url,
          error: "No content returned for this URL.",
        };
      }),
    };
  },
};

function createClient(config: Tavily): TavilyClient {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return tavily({
    apiKey,
    apiBaseURL: resolveConfigValue(config.baseUrl),
  });
}

function buildSearchMetadata(
  response: TavilySearchResponse,
  result: TavilySearchResponse["results"][number],
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {
    ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
    ...(result.favicon ? { favicon: result.favicon } : {}),
    ...(result.rawContent ? { rawContent: result.rawContent } : {}),
    ...(response.requestId ? { requestId: response.requestId } : {}),
    ...(typeof response.responseTime === "number"
      ? { responseTime: response.responseTime }
      : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildExtractMetadata(
  response: TavilyExtractResponse,
  result: TavilyExtractResponse["results"][number],
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {
    ...(result.title ? { title: result.title } : {}),
    ...(Array.isArray(result.images) ? { images: result.images } : {}),
    ...(result.favicon ? { favicon: result.favicon } : {}),
    ...(response.requestId ? { requestId: response.requestId } : {}),
    ...(typeof response.responseTime === "number"
      ? { responseTime: response.responseTime }
      : {}),
  };

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
