import ParallelClient from "parallel-web";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import type {
  Parallel,
  ProviderCapabilityStatus,
  ProviderCapabilityStatusOptions,
  ProviderContext,
  SearchResponse,
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

const parallelSearchOptionsSchema = Type.Object(
  {
    mode: Type.Optional(
      literalUnion(["advanced", "basic", "turbo"], {
        description:
          "Parallel search mode. Use 'advanced' for higher quality, 'basic' for lower latency, or 'turbo' for the fastest responses.",
      }),
    ),
  },
  { description: "Parallel search options." },
);

const parallelSearchPromptGuidelines = [
  "Use Parallel mode='advanced' for exploratory, ambiguous, or multi-hop source discovery where the provider should plan the search.",
  "Use Parallel mode='basic' for direct factual lookups and simple source finding where low latency is preferred.",
  "Use Parallel mode='turbo' only when fastest responses matter more than recall or depth.",
  "Prefer web_contents with Parallel extraction when a URL set is already known and the task needs full page content rather than more source discovery.",
] as const;

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

const parallelImplementation = {
  id: "parallel" as const,
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
      credentials: { api: "PARALLEL_API_KEY" },
      options: {
        search: {
          mode: "advanced",
        },
        extract: {
          excerpts: false,
          full_content: true,
        },
      },
    };
  },

  getCapabilityStatus(
    config: Parallel | undefined,
    _cwd: string,
    _tool: Tool | undefined,
    options?: ProviderCapabilityStatusOptions,
  ): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.credentials?.api, options);
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

    const response = (await client.search(
      buildParallelSearchParams(query, maxResults, {
        ...defaults,
        ...(options ?? {}),
      }) as never,
      buildRequestOptions(context),
    )) as ParallelSearchResponse;

    return {
      provider: parallelImplementation.id,
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

    const response = (await client.extract(
      buildParallelExtractParams(urls, {
        ...defaults,
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
      provider: parallelImplementation.id,
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
  const apiKey = resolveConfigValue(config.credentials?.api);
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

export const parallelProvider = defineProvider({
  id: "parallel" as const,
  label: parallelImplementation.label,
  docsUrl: parallelImplementation.docsUrl,
  config: {
    createTemplate: () => parallelImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
  },
  getCapabilityStatus: (config, cwd, tool, options) =>
    (parallelImplementation.getCapabilityStatus as any)(
      config as Parallel | undefined,
      cwd,
      tool,
      options,
    ),
  capabilities: {
    search: defineCapability({
      options: parallelImplementation.getToolOptionsSchema?.("search"),
      promptGuidelines: parallelSearchPromptGuidelines,
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await parallelImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    contents: defineCapability({
      options: parallelImplementation.getToolOptionsSchema?.("contents"),
      async execute(input: any, ctx) {
        return await parallelImplementation.contents!(
          input.urls,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
