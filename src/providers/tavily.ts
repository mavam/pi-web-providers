import {
  type TavilyClient,
  type TavilyExtractResponse,
  type TavilySearchResponse,
  tavily,
} from "@tavily/core";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import type {
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  Tavily,
  Tool,
} from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { literalUnion } from "./schema.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

const tavilySearchOptionsSchema = Type.Object(
  {
    topic: Type.Optional(
      literalUnion(["general", "news", "finance"], {
        description:
          "Category of the search query. Use 'news' for recent journalism or current events, 'finance' for markets or company financial data, and 'general' for broad web search.",
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

const tavilySearchPromptGuidelines = [
  "Use Tavily topic='news' for recent journalism or current events and topic='finance' for market or company-finance research; otherwise leave topic as general.",
  "Use searchDepth='advanced' for broader or higher-recall source discovery, and 'basic' for quick direct lookups.",
  "Set timeRange, days, or country when the user asks for freshness, recency, or geography-specific results.",
  "Set includeRawContent or includeAnswer only when the search response itself should carry more context; prefer web_contents for selected source inspection.",
] as const;

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

const tavilyImplementation = {
  id: "tavily" as const,
  label: "Tavily",
  docsUrl: "https://docs.tavily.com/sdk/javascript/reference",

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
      credentials: { api: "TAVILY_API_KEY" },
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

  getCapabilityStatus(config: Tavily | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.credentials?.api);
  },

  async search(
    query: string,
    maxResults: number,
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.search) ?? {};

    const response = await client.search(query, {
      ...defaults,
      ...(options ?? {}),
      maxResults,
    });

    return {
      provider: tavilyImplementation.id,
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
    const defaults = asJsonObject(config.options?.extract) ?? {};

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
      provider: tavilyImplementation.id,
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
  const apiKey = resolveConfigValue(config.credentials?.api);
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

export const tavilyProvider = defineProvider({
  id: "tavily" as const,
  label: tavilyImplementation.label,
  docsUrl: tavilyImplementation.docsUrl,
  config: {
    createTemplate: () => tavilyImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
  },
  getCapabilityStatus: (config, cwd, tool) =>
    (tavilyImplementation.getCapabilityStatus as any)(
      config as Tavily | undefined,
      cwd,
      tool,
    ),
  capabilities: {
    search: defineCapability({
      options: tavilyImplementation.getToolOptionsSchema?.("search"),
      promptGuidelines: tavilySearchPromptGuidelines,
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await tavilyImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    contents: defineCapability({
      options: tavilyImplementation.getToolOptionsSchema?.("contents"),
      async execute(input: any, ctx) {
        return await tavilyImplementation.contents!(
          input.urls,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
