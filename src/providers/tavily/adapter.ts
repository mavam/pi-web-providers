import { orderedContents } from "../../contents.js";
import {
  type TavilyClient,
  type TavilyExtractResponse,
  type TavilySearchResponse,
  tavily,
} from "@tavily/core";

import type { ContentsResponse } from "../../contents.js";
import type { ProviderContext, SearchResponse } from "../contract.js";
import type { Tavily } from "./types.js";

import { trimSnippet } from "../shared.js";

const tavilyImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);

    const response = await client.search(query, {
      ...(options ?? {}),
      maxResults,
    });

    return {
      provider: "tavily",
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

    const response = await client.extract(urls, {
      ...(options ?? {}),
    });

    const resultsByUrl = new Map(
      response.results.map((result) => [result.url, result] as const),
    );
    const failedResultsByUrl = new Map(
      response.failedResults.map((result) => [result.url, result] as const),
    );

    return {
      provider: "tavily",
      answers: urls.map((url) => {
        const result =
          resultsByUrl.get(url) ??
          (urls.length === 1 && response.results.length === 1
            ? response.results[0]
            : undefined);
        if (result) {
          return {
            url: result.url,
            ...(typeof result.rawContent === "string"
              ? { content: result.rawContent }
              : {}),
            metadata: buildExtractMetadata(response, result),
          };
        }

        const failedResult =
          failedResultsByUrl.get(url) ??
          (urls.length === 1 && response.failedResults.length === 1
            ? response.failedResults[0]
            : undefined);
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
  const apiKey = config.credentials?.api;
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return tavily({
    apiKey,
    apiBaseURL: config.baseUrl,
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

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Tavily,
    context: ProviderContext,
  ) {
    return await tavilyImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Tavily,
    context: ProviderContext,
  ) {
    return orderedContents(
      await tavilyImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
};
