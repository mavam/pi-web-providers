import { type TObject, Type } from "typebox";
import ParallelClient from "parallel-web";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import type {
  Parallel,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  Tool,
} from "../types.js";
import { literalUnion } from "./schema.js";
import {
  asJsonObject,
  formatJson,
  getApiKeyStatus,
  trimSnippet,
} from "./shared.js";

type ParallelAdapter = ProviderAdapter<"parallel"> & {
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

  getCapabilityStatus(config: Parallel | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  async search(
    query: string,
    maxResults: number,
    config: Parallel,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.search) ?? {};

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
    const defaults = asJsonObject(config.options?.extract) ?? {};

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
