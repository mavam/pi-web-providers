import PerplexityClient from "@perplexity-ai/perplexity_ai";
import { resolveConfigValue } from "../config.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import {
  createSilentForegroundPlan,
  createStreamingForegroundPlan,
} from "../provider-plans.js";
import type {
  Perplexity,
  ProviderContext,
  ProviderOperationRequest,
  ProviderStatus,
  ToolOutput,
  SearchResponse,
  ProviderAdapter,
} from "../types.js";
import { asJsonObject, trimSnippet } from "./shared.js";

const DEFAULT_ANSWER_MODEL = "sonar";
const DEFAULT_RESEARCH_MODEL = "sonar-deep-research";

type PerplexityForegroundChunk = {
  choices: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
  }>;
  search_results?: Array<{
    title?: string | null;
    url?: string | null;
  }> | null;
  citations?: Array<string | null> | null;
};

export class PerplexityAdapter implements ProviderAdapter<Perplexity> {
  readonly id: "perplexity" = "perplexity";
  readonly label = "Perplexity";
  readonly docsUrl = "https://docs.perplexity.ai/docs/sdk/overview.md";
  readonly tools = ["search", "answer", "research"] as const;

  createTemplate(): Perplexity {
    return {
      enabled: false,
      apiKey: "PERPLEXITY_API_KEY",
      options: {
        answer: {
          model: DEFAULT_ANSWER_MODEL,
        },
        research: {
          model: DEFAULT_RESEARCH_MODEL,
        },
      },
    };
  }

  getStatus(config: Perplexity | undefined): ProviderStatus {
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

  buildPlan(request: ProviderOperationRequest, config: Perplexity) {
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
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.answer(request.query, request.options, config, context),
        });
      case "research":
        return createStreamingForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          traits: {
            executionSupport: {
              requestTimeoutMs: true,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: false,
              timeoutMs: false,
              maxConsecutivePollErrors: false,
              resumeId: false,
            },
          },
          execute: (context: ProviderContext) =>
            this.research(request.input, request.options, config, context),
        });
      default:
        return null;
    }
  }

  async search(
    query: string,
    maxResults: number,
    options: Record<string, unknown> | undefined,
    config: Perplexity,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const providerOptions = config.options;
    const request = {
      ...(stripLocalExecutionOptions(asJsonObject(providerOptions?.search)) ??
        {}),
      ...(options ?? {}),
      query,
      max_results: maxResults,
    };

    const response = await client.search.create(
      request as never,
      buildRequestOptions(context),
    );

    return {
      provider: this.id,
      results: response.results.slice(0, maxResults).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: trimSnippet(result.snippet),
        metadata:
          result.date || result.last_updated
            ? {
                ...(result.date ? { date: result.date } : {}),
                ...(result.last_updated
                  ? { last_updated: result.last_updated }
                  : {}),
              }
            : undefined,
      })),
    };
  }

  async answer(
    query: string,
    options: Record<string, unknown> | undefined,
    config: Perplexity,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    return this.runSilentForegroundChatTool(
      query,
      options,
      config,
      context,
      DEFAULT_ANSWER_MODEL,
      "Answer",
    );
  }

  async research(
    input: string,
    options: Record<string, unknown> | undefined,
    config: Perplexity,
    context: ProviderContext,
  ): Promise<ToolOutput> {
    return this.runStreamingForegroundChatTool(
      input,
      options,
      config,
      context,
      DEFAULT_RESEARCH_MODEL,
      "Research",
    );
  }

  private async runSilentForegroundChatTool(
    input: string,
    options: Record<string, unknown> | undefined,
    config: Perplexity,
    context: ProviderContext,
    fallbackModel: string,
    label: "Answer" | "Research",
    isResearch = false,
  ): Promise<ToolOutput> {
    const client = this.createClient(config);
    const providerOptions = config.options;
    const defaults =
      stripLocalExecutionOptions(
        isResearch
          ? asJsonObject(providerOptions?.research)
          : asJsonObject(providerOptions?.answer),
      ) ?? {};
    const request = {
      ...defaults,
      ...(options ?? {}),
      messages: [{ role: "user", content: input }],
      model:
        resolveModel((options ?? {}).model, defaults.model, fallbackModel) ??
        fallbackModel,
      stream: false,
    };

    const response = await client.chat.completions.create(
      request as never,
      buildRequestOptions(context),
    );
    const content = extractMessageText(response.choices[0]?.message?.content);
    const sources = dedupeSources(extractSources(response));

    const lines: string[] = [];
    lines.push(content || `No ${label.toLowerCase()} returned.`);

    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      itemCount: sources.length,
    };
  }

  // Perplexity deep research currently fits streaming foreground mode: pi can
  // surface incremental text while the request is active, but there is no
  // durable job id to resume later.
  private async runStreamingForegroundChatTool(
    input: string,
    options: Record<string, unknown> | undefined,
    config: Perplexity,
    context: ProviderContext,
    fallbackModel: string,
    label: "Answer" | "Research",
  ): Promise<ToolOutput> {
    const client = this.createClient(config);
    const providerOptions = config.options;
    const defaults =
      stripLocalExecutionOptions(asJsonObject(providerOptions?.research)) ?? {};
    const request = {
      ...defaults,
      ...(options ?? {}),
      messages: [{ role: "user", content: input }],
      model:
        resolveModel((options ?? {}).model, defaults.model, fallbackModel) ??
        fallbackModel,
      stream: true as const,
    };

    const stream = (await client.chat.completions.create(
      request as never,
      buildRequestOptions(context),
    )) as unknown as AsyncIterable<PerplexityForegroundChunk>;

    let partialText = "";
    let lastChunk: PerplexityForegroundChunk | undefined;
    const sources: Array<{ title: string; url: string }> = [];

    for await (const chunk of stream) {
      lastChunk = chunk;
      const deltaText = extractDeltaText(chunk.choices[0]?.delta?.content);
      if (deltaText) {
        partialText = `${partialText}${deltaText}`;
      }
      sources.push(...extractSources(chunk));
    }

    const finalText =
      partialText.trim() ||
      extractMessageText(lastChunk?.choices?.[0]?.message?.content) ||
      `No ${label.toLowerCase()} returned.`;
    const dedupedSources = dedupeSources(sources);
    const lines: string[] = [finalText];

    if (dedupedSources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of dedupedSources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      itemCount: dedupedSources.length,
    };
  }

  private createClient(config: Perplexity): PerplexityClient {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Perplexity is missing an API key.");
    }

    return new PerplexityClient({
      apiKey,
      baseURL: resolveConfigValue(config.baseUrl),
    });
  }
}

function resolveModel(
  optionModel: unknown,
  defaultModel: unknown,
  fallbackModel: string,
): string {
  if (typeof optionModel === "string" && optionModel.trim().length > 0) {
    return optionModel;
  }
  if (typeof defaultModel === "string" && defaultModel.trim().length > 0) {
    return defaultModel;
  }
  return fallbackModel;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((chunk) => {
      if (
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "text" &&
        "text" in chunk &&
        typeof chunk.text === "string"
      ) {
        return [chunk.text.trim()];
      }
      return [];
    })
    .filter((text) => text.length > 0)
    .join("\n\n")
    .trim();
}

function extractDeltaText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((chunk) => {
      if (
        typeof chunk === "object" &&
        chunk !== null &&
        "type" in chunk &&
        chunk.type === "text" &&
        "text" in chunk &&
        typeof chunk.text === "string"
      ) {
        return [chunk.text];
      }
      return [];
    })
    .join("");
}

function dedupeSources(
  sources: Array<{ title: string; url: string }>,
): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const unique: Array<{ title: string; url: string }> = [];

  for (const source of sources) {
    const title = source.title.trim() || source.url.trim() || "Untitled";
    const url = source.url.trim();
    if (!url) continue;

    const key = `${title.toLowerCase()}::${url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ title, url });
  }

  return unique;
}

function extractSources(
  response: Pick<PerplexityForegroundChunk, "search_results" | "citations">,
): Array<{ title: string; url: string }> {
  const searchResults =
    response.search_results?.flatMap((result) => {
      const url = result.url?.trim() ?? "";
      if (!url) {
        return [];
      }
      return [{ title: result.title?.trim() ?? url, url }];
    }) ?? [];

  if (searchResults.length > 0) {
    return searchResults;
  }

  return (
    response.citations?.flatMap((citation) => {
      const url = citation?.trim() ?? "";
      return url ? [{ title: url, url }] : [];
    }) ?? []
  );
}

function buildRequestOptions(
  context: ProviderContext,
): { signal: AbortSignal } | undefined {
  return context.signal ? { signal: context.signal } : undefined;
}
