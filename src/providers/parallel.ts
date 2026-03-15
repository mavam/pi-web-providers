import Parallel from "parallel-web";
import { resolveConfigValue } from "../config.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import { createDefaultRequestPolicy } from "../execution-policy-defaults.js";
import { createSilentForegroundPlan } from "../provider-plans.js";
import type {
  ParallelProviderConfig,
  ProviderContext,
  ProviderOperationRequest,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";
import { asJsonObject, trimSnippet } from "./shared.js";

export class ParallelProvider implements WebProvider<ParallelProviderConfig> {
  readonly id: "parallel" = "parallel";
  readonly label = "Parallel";
  readonly docsUrl = "https://github.com/parallel-web/parallel-sdk-typescript";
  readonly capabilities = ["search", "contents"] as const;

  createTemplate(): ParallelProviderConfig {
    return {
      enabled: false,
      tools: {
        search: true,
        contents: true,
      },
      apiKey: "PARALLEL_API_KEY",
      native: {
        search: {
          mode: "agentic",
        },
        extract: {
          excerpts: true,
          full_content: false,
        },
      },
      policy: createDefaultRequestPolicy(),
    };
  }

  getStatus(config: ParallelProviderConfig | undefined): ProviderStatus {
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

  buildPlan(request: ProviderOperationRequest, config: ParallelProviderConfig) {
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
              request.options,
              config,
              context,
            ),
        });
      case "contents":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.contents(request.urls, request.options, config, context),
        });
      default:
        return null;
    }
  }

  async search(
    query: string,
    maxResults: number,
    options: Record<string, unknown> | undefined,
    config: ParallelProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const native = config.native ?? config.defaults;
    const defaults =
      stripLocalExecutionOptions(asJsonObject(native?.search)) ?? {};

    context.onProgress?.(`Searching Parallel for: ${query}`);
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
    options: Record<string, unknown> | undefined,
    config: ParallelProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const client = this.createClient(config);
    const native = config.native ?? config.defaults;
    const defaults =
      stripLocalExecutionOptions(asJsonObject(native?.extract)) ?? {};

    context.onProgress?.(
      `Fetching contents from Parallel for ${urls.length} URL(s)`,
    );
    const response = await client.beta.extract(
      {
        ...defaults,
        ...(options ?? {}),
        urls,
      },
      buildRequestOptions(context),
    );

    const lines: string[] = [];
    for (const [index, result] of response.results.entries()) {
      lines.push(`${index + 1}. ${result.title ?? result.url}`);
      lines.push(`   ${result.url}`);

      const text = result.excerpts?.join(" ") ?? result.full_content ?? "";
      const snippet = trimSnippet(text);
      if (snippet) {
        lines.push(`   ${snippet}`);
      }
      lines.push("");
    }

    for (const error of response.errors) {
      lines.push(`Error: ${error.url}`);
      lines.push(`   ${error.error_type}`);
      if (error.content) {
        lines.push(`   ${trimSnippet(error.content)}`);
      }
      lines.push("");
    }

    const itemCount = response.results.length;
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents found.",
      summary: `${itemCount} content result(s) via Parallel`,
      itemCount,
    };
  }

  private createClient(config: ParallelProviderConfig): Parallel {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Parallel is missing an API key.");
    }

    return new Parallel({
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
