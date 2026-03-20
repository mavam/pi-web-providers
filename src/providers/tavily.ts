import { tavily } from "@tavily/core";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import {
  createBackgroundResearchPlan,
  createSilentForegroundPlan,
} from "../provider-plans.js";
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderRequest,
  ProviderStatus,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  Tavily,
} from "../types.js";
import { formatJson, trimSnippet } from "./shared.js";

type TavilyClient = ReturnType<typeof tavily>;

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  publishedDate?: string;
  favicon?: string;
};

type TavilyExtractResult = {
  url?: string;
  title?: string | null;
  rawContent?: string;
  images?: string[];
  favicon?: string;
};

type TavilyExtractFailedResult = {
  url?: string;
  error?: string;
};

type TavilyResearchResponse = {
  requestId?: string;
};

type TavilyResearchStatusResponse = {
  status?: string;
  content?: string | Record<string, unknown>;
  sources?: Array<{
    title?: string;
    url?: string;
  }>;
};

export class TavilyAdapter implements ProviderAdapter<Tavily> {
  readonly id: "tavily" = "tavily";
  readonly label = "Tavily";
  readonly docsUrl = "https://docs.tavily.com/sdk/reference/javascript";
  readonly tools = ["search", "contents", "research"] as const;

  createTemplate(): Tavily {
    return {
      enabled: false,
      apiKey: "TAVILY_API_KEY",
    };
  }

  getStatus(config: Tavily | undefined): ProviderStatus {
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

  buildPlan(request: ProviderRequest, config: Tavily) {
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
      case "research":
        return createBackgroundResearchPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          traits: {
            executionSupport: {
              requestTimeoutMs: false,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: true,
              timeoutMs: true,
              maxConsecutivePollErrors: true,
              resumeId: true,
            },
            researchLifecycle: {
              supportsStartRetries: false,
              supportsRequestTimeouts: false,
            },
          },
          start: (context: ProviderContext) =>
            this.startResearch(request.input, config, context, request.options),
          poll: (id: string, context: ProviderContext) =>
            this.pollResearch(id, config, context, request.options),
        });
      default:
        return null;
    }
  }

  async search(
    query: string,
    maxResults: number,
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const response = await client.search(query, {
      ...(stripLocalExecutionOptions(config.options?.search) ?? {}),
      ...(options ?? {}),
      maxResults,
    });

    return {
      provider: this.id,
      results: (response.results ?? [])
        .slice(0, maxResults)
        .map((result: TavilySearchResult) => ({
          title: String(result.title ?? result.url ?? "Untitled"),
          url: String(result.url ?? ""),
          snippet: trimSnippet(result.content),
          score: typeof result.score === "number" ? result.score : undefined,
          metadata:
            result.publishedDate || result.favicon
              ? {
                  ...(result.publishedDate
                    ? { publishedDate: result.publishedDate }
                    : {}),
                  ...(result.favicon ? { favicon: result.favicon } : {}),
                }
              : undefined,
        })),
    };
  }

  async contents(
    urls: string[],
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = this.createClient(config);
    const response = await client.extract(urls, {
      ...(stripLocalExecutionOptions(config.options?.extract) ?? {}),
      ...(options ?? {}),
    });

    const resultsByUrl = new Map(
      (response.results ?? []).map(
        (result: TavilyExtractResult) =>
          [String(result.url ?? ""), result] as const,
      ),
    );
    const failedResultsByUrl = new Map(
      (response.failedResults ?? []).map(
        (result: TavilyExtractFailedResult) =>
          [String(result.url ?? ""), result] as const,
      ),
    );

    return {
      provider: this.id,
      answers: urls.map((url) => {
        const result = resultsByUrl.get(url);
        if (result) {
          return {
            url,
            ...(typeof result.rawContent === "string"
              ? { content: result.rawContent }
              : {}),
            metadata: result as Record<string, unknown>,
          };
        }

        const failedResult = failedResultsByUrl.get(url);
        if (failedResult) {
          return {
            url,
            error: failedResult.error ?? "Content extraction failed.",
          };
        }

        return {
          url,
          error: "No content returned for this URL.",
        };
      }),
    };
  }

  async startResearch(
    input: string,
    config: Tavily,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = this.createClient(config);
    const response = (await client.research(input, {
      ...(stripLocalExecutionOptions(config.options?.research) ?? {}),
      ...(options ?? {}),
    })) as TavilyResearchResponse;

    if (!response.requestId) {
      throw new Error("Tavily research did not return a request id.");
    }

    return { id: response.requestId };
  }

  async pollResearch(
    id: string,
    config: Tavily,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = this.createClient(config);
    const response = (await client.getResearch(
      id,
    )) as TavilyResearchStatusResponse;
    const status = String(response.status ?? "").toLowerCase();

    if (status === "completed") {
      const lines = [
        typeof response.content === "string"
          ? response.content
          : response.content !== undefined
            ? formatJson(response.content)
            : "No research content returned.",
      ];
      const sources = response.sources ?? [];

      if (sources.length > 0) {
        lines.push("", "Sources:");
        for (const [index, source] of sources.entries()) {
          lines.push(
            `${index + 1}. ${String(source.title ?? source.url ?? "Untitled")}`,
          );
          lines.push(`   ${String(source.url ?? "")}`);
        }
      }

      return {
        status: "completed",
        output: {
          provider: this.id,
          text: lines.join("\n").trimEnd(),
          itemCount: sources.length,
        },
      };
    }

    if (status === "failed" || status === "cancelled") {
      return {
        status: status as "failed" | "cancelled",
        error:
          typeof response.content === "string" && response.content.trim()
            ? response.content
            : `Tavily research ${status}.`,
      };
    }

    return {
      status: "in_progress",
    };
  }

  private createClient(config: Tavily): TavilyClient {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Tavily is missing an API key.");
    }

    return tavily({
      apiKey,
      apiBaseURL: resolveConfigValue(config.baseUrl),
    });
  }
}
