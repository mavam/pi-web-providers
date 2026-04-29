import ParallelClient from "parallel-web";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import type {
  Parallel,
  ProviderCapabilityStatus,
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
      literalUnion(["agentic", "one-shot"], {
        description:
          "Parallel search mode. Use 'agentic' for exploratory or multi-step source discovery and 'one-shot' for direct, simple searches.",
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
    return getApiKeyStatus(config?.credentials?.api);
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
  getCapabilityStatus: (config, cwd, tool) =>
    (parallelImplementation.getCapabilityStatus as any)(
      config as Parallel | undefined,
      cwd,
      tool,
    ),
  capabilities: {
    search: defineCapability({
      options: parallelImplementation.getToolOptionsSchema?.("search"),
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
