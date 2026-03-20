import ParallelClient from "parallel-web";
import { resolveConfigValue } from "../config.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import { createSilentForegroundPlan } from "../provider-plans.js";
import type { ContentsEntry } from "../contents.js";
import type {
  Parallel,
  ProviderContext,
  ProviderOperationRequest,
  ProviderStatus,
  ToolOutput,
  SearchResponse,
  ProviderAdapter,
} from "../types.js";
import {
  asJsonObject,
  normalizeContentText,
  pushIndentedBlock,
  trimSnippet,
} from "./shared.js";

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

  buildPlan(request: ProviderOperationRequest, config: Parallel) {
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
    config: Parallel,
    context: ProviderContext,
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
    options: Record<string, unknown> | undefined,
    config: Parallel,
    context: ProviderContext,
  ): Promise<ToolOutput> {
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

    const lines: string[] = [];
    const contentsEntries: ContentsEntry[] = response.results.map(
      (result, index) => {
        const title = result.title ?? result.url;
        const entryLines = [`${index + 1}. ${title}`, `   ${result.url}`];

        const text = result.full_content ?? result.excerpts?.join("\n\n") ?? "";
        const body = normalizeContentText(text);
        pushIndentedBlock(entryLines, body);

        lines.push(...entryLines, "");
        return {
          url: result.url,
          title,
          body,
          status: "ready",
        };
      },
    );

    for (const error of response.errors) {
      const detailLines = [error.error_type];
      if (error.content) {
        detailLines.push(trimSnippet(error.content));
      }

      lines.push(`Error: ${error.url}`);
      for (const line of detailLines) {
        lines.push(`   ${line}`);
      }
      lines.push("");
      contentsEntries.push({
        url: error.url,
        title: error.url,
        body: detailLines.join("\n"),
        status: "failed",
      });
    }

    const itemCount = response.results.length;
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents found.",
      itemCount,
      metadata: {
        contentsEntries: contentsEntries as unknown,
      },
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
