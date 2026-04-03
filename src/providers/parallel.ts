import { type TObject, Type } from "@sinclair/typebox";
import ParallelClient from "parallel-web";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  Parallel,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  Tool,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { literalUnion } from "./schema.js";
import {
  asJsonObject,
  formatJson,
  getApiKeyStatus,
  trimSnippet,
} from "./shared.js";

type ParallelAdapter = ProviderAdapter<Parallel> & {
  search(
    query: string,
    maxResults: number,
    config: Parallel,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Parallel,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
};

const parallelSearchOptionsSchema = Type.Object(
  {
    mode: Type.Optional(
      literalUnion(["agentic", "one-shot"], {
        description: "Parallel search mode.",
      }),
    ),
  },
  { description: "Parallel search options." },
);

const parallelExtractOptionsSchema = Type.Object(
  {
    excerpts: Type.Optional(
      Type.Boolean({ description: "Include excerpts in extraction results." }),
    ),
    full_content: Type.Optional(
      Type.Boolean({
        description: "Include full page content in extraction results.",
      }),
    ),
  },
  { description: "Parallel extract options." },
);

export const parallelAdapter: ParallelAdapter = {
  id: "parallel",
  label: "Parallel",
  docsUrl: "https://github.com/parallel-web/parallel-sdk-typescript",
  tools: ["search", "contents"] as const,

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return parallelSearchOptionsSchema;
      case "contents":
        return parallelExtractOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Parallel {
    return {
      apiKey: "PARALLEL_API_KEY",
      options: {
        search: {
          mode: "agentic",
        },
        extract: {
          excerpts: false,
          full_content: true,
        },
      },
    };
  },

  getConfigForCapability(capability: Tool, config: Parallel): unknown {
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

  getCapabilityStatus(config: Parallel | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Parallel) {
    return buildProviderPlan({
      request,
      config,
      providerId: parallelAdapter.id,
      providerLabel: parallelAdapter.label,
      handlers: {
        search: {
          execute: (
            searchRequest,
            providerConfig: Parallel,
            context: ProviderContext,
          ) =>
            parallelAdapter.search(
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
            providerConfig: Parallel,
            context: ProviderContext,
          ) =>
            parallelAdapter.contents(
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
    config: Parallel,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const defaults =
      stripLocalExecutionOptions(asJsonObject(config.options?.search)) ?? {};

    const response = await client.beta.search(
      {
        ...defaults,
        ...(options ?? {}),
        objective: query,
        max_results: maxResults,
      },
      buildRequestOptions(context),
    );

    return {
      provider: parallelAdapter.id,
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
    const defaults =
      stripLocalExecutionOptions(asJsonObject(config.options?.extract)) ?? {};

    const response = await client.beta.extract(
      {
        ...defaults,
        ...(options ?? {}),
        urls,
      },
      buildRequestOptions(context),
    );

    const resultsByUrl = new Map(
      response.results.map((result) => [result.url, result] as const),
    );
    const errorsByUrl = new Map(
      response.errors.map((error) => [error.url, error] as const),
    );

    return {
      provider: parallelAdapter.id,
      answers: urls.map((url) => {
        const result = resultsByUrl.get(url);
        if (result) {
          return {
            url,
            content:
              result.full_content ?? result.excerpts?.join("\n\n") ?? undefined,
            metadata: result as unknown as Record<string, unknown>,
          };
        }

        const error = errorsByUrl.get(url);
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

function createClient(config: Parallel): ParallelClient {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new ParallelClient({
    apiKey,
    baseURL: resolveConfigValue(config.baseUrl),
  });
}

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}
