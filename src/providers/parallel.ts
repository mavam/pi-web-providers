import ParallelClient from "parallel-web";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import { createSilentForegroundPlan } from "../provider-plans.js";
import type {
  Parallel,
  ProviderAdapter,
  ProviderContext,
  ProviderRequest,
  ProviderStatus,
  SearchResponse,
} from "../types.js";
import { asJsonObject, formatJson, trimSnippet } from "./shared.js";

export class ParallelAdapter implements ProviderAdapter<Parallel> {
  readonly id: "parallel" = "parallel";
  readonly label = "Parallel";
  readonly docsUrl = "https://github.com/parallel-web/parallel-sdk-typescript";
  readonly tools = ["search", "contents"] as const;

  createTemplate(): Parallel {
    return {
      enabled: false,
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
  }

  getStatus(config: Parallel | undefined): ProviderStatus {
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

  buildPlan(request: ProviderRequest, config: Parallel) {
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
    config: Parallel,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const providerOptions = config.options;
    const defaults =
      stripLocalExecutionOptions(asJsonObject(providerOptions?.search)) ?? {};

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
      provider: this.id,
      results: response.results.slice(0, maxResults).map((result) => ({
        title: result.title ?? result.url,
        url: result.url,
        snippet: trimSnippet(result.excerpts?.join(" ") ?? ""),
      })),
    };
  }

  async contents(
    urls: string[],
    config: Parallel,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = this.createClient(config);
    const providerOptions = config.options;
    const defaults =
      stripLocalExecutionOptions(asJsonObject(providerOptions?.extract)) ?? {};

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
      provider: this.id,
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
  }

  private createClient(config: Parallel): ParallelClient {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Parallel is missing an API key.");
    }

    return new ParallelClient({
      apiKey,
      baseURL: resolveConfigValue(config.baseUrl),
    });
  }
}

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}
