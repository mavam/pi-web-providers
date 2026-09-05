import { orderedContents } from "../../contents.js";
import ParallelClient from "parallel-web";

import type { ContentsResponse } from "../../contents.js";
import type { ProviderContext, SearchResponse } from "../contract.js";
import type { Parallel } from "./types.js";

import { formatJson, trimSnippet } from "../shared.js";

const parallelImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Parallel,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);

    const response = (await client.search(
      buildParallelSearchParams(query, maxResults, {
        ...(options ?? {}),
      }) as never,
      buildRequestOptions(context),
    )) as ParallelSearchResponse;

    return {
      provider: "parallel",
      results: response.results.slice(0, maxResults).map((result) => ({
        title: result.title ?? result.url,
        url: result.url,
        snippet: trimSnippet(result.excerpts?.join(" ") ?? ""),
      })),
    };
  },

  async contents(
    urls: string[],
    config: Parallel,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);

    const response = (await client.extract(
      buildParallelExtractParams(urls, {
        ...(options ?? {}),
      }) as never,
      buildRequestOptions(context),
    )) as unknown as ParallelExtractResponse;

    const resultsByUrl = new Map(
      response.results.map((result) => [result.url, result] as const),
    );
    const errorsByUrl = new Map(
      response.errors.map((error) => [error.url, error] as const),
    );

    return {
      provider: "parallel",
      answers: urls.map((url) => {
        const result =
          resultsByUrl.get(url) ??
          (urls.length === 1 && response.results.length === 1
            ? response.results[0]
            : undefined);
        if (result) {
          return {
            url: result.url,
            content:
              result.full_content ?? result.excerpts?.join("\n\n") ?? undefined,
            metadata: result as unknown as Record<string, unknown>,
          };
        }

        const error =
          errorsByUrl.get(url) ??
          (urls.length === 1 && response.errors.length === 1
            ? response.errors[0]
            : undefined);
        return error
          ? {
              url,
              error: formatJson(error),
            }
          : {
              url,
              error: "No content returned for this URL.",
            };
      }),
    };
  },
};

type ParallelSearchMode = "advanced" | "basic" | "turbo";

interface ParallelSearchResponse {
  results: Array<{
    title?: string | null;
    url: string;
    excerpts?: string[] | null;
  }>;
}

interface ParallelExtractResponse {
  results: Array<{
    url: string;
    excerpts?: string[] | null;
    full_content?: string | null;
  }>;
  errors: Array<{
    url: string;
  }>;
}

function buildParallelSearchParams(
  query: string,
  maxResults: number,
  options: Record<string, unknown>,
): Record<string, unknown> {
  const {
    advanced_settings: advancedSettingsValue,
    max_results: _legacyMaxResults,
    mode: modeValue,
    objective: objectiveValue,
    search_queries: _searchQueries,
    ...rest
  } = options;
  const advancedSettings = readObjectOption(advancedSettingsValue);
  const mode = normalizeParallelSearchMode(modeValue);
  const objective =
    typeof objectiveValue === "string" && objectiveValue.trim()
      ? objectiveValue.trim()
      : query;

  return {
    ...rest,
    search_queries: [query],
    objective,
    ...(mode ? { mode } : {}),
    advanced_settings: {
      ...advancedSettings,
      max_results: maxResults,
    },
  };
}

function buildParallelExtractParams(
  urls: string[],
  options: Record<string, unknown>,
): Record<string, unknown> {
  const {
    advanced_settings: advancedSettingsValue,
    excerpts: excerptsValue,
    full_content: fullContentValue,
    ...rest
  } = options;
  const advancedSettings = readObjectOption(advancedSettingsValue);

  if (typeof fullContentValue === "boolean") {
    advancedSettings.full_content = fullContentValue;
  }
  if (
    typeof excerptsValue === "boolean" &&
    advancedSettings.excerpt_settings === undefined
  ) {
    advancedSettings.excerpt_settings = excerptsValue
      ? {}
      : { max_chars_per_result: 0 };
  }

  return {
    ...rest,
    urls,
    advanced_settings: advancedSettings,
  };
}

function normalizeParallelSearchMode(
  value: unknown,
): ParallelSearchMode | undefined {
  switch (value) {
    case "advanced":
    case "basic":
    case "turbo":
      return value;
    default:
      return undefined;
  }
}

function readObjectOption(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function createClient(config: Parallel): ParallelClient {
  const apiKey = config.credentials?.api;
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new ParallelClient({
    maxRetries: 0,
    apiKey,
    baseURL: config.baseUrl,
  });
}

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Parallel,
    context: ProviderContext,
  ) {
    return await parallelImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Parallel,
    context: ProviderContext,
  ) {
    return orderedContents(
      await parallelImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
};
