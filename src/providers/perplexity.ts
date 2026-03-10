import Perplexity from "@perplexity-ai/perplexity_ai";
import { resolveConfigValue } from "../config.js";
import type {
  PerplexityProviderConfig,
  ProviderContext,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";
import { asJsonObject, trimSnippet } from "./shared.js";

const DEFAULT_ANSWER_MODEL = "sonar";
const DEFAULT_RESEARCH_MODEL = "sonar-deep-research";

export class PerplexityProvider
  implements WebProvider<PerplexityProviderConfig>
{
  readonly id = "perplexity";
  readonly label = "Perplexity";
  readonly docsUrl = "https://docs.perplexity.ai/docs/sdk/overview.md";

  createTemplate(): PerplexityProviderConfig {
    return {
      enabled: false,
      tools: {
        search: true,
        answer: true,
        research: true,
      },
      apiKey: "PERPLEXITY_API_KEY",
      defaults: {
        answer: {
          model: DEFAULT_ANSWER_MODEL,
        },
        research: {
          model: DEFAULT_RESEARCH_MODEL,
        },
      },
    };
  }

  getStatus(config: PerplexityProviderConfig | undefined): ProviderStatus {
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

  async search(
    query: string,
    maxResults: number,
    options: Record<string, unknown> | undefined,
    config: PerplexityProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const request = {
      ...asJsonObject(config.defaults?.search),
      ...(options ?? {}),
      query,
      max_results: maxResults,
    };

    context.onProgress?.(`Searching Perplexity for: ${query}`);
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
    config: PerplexityProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    context.onProgress?.(`Getting Perplexity answer for: ${query}`);
    return this.runChatTool(
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
    config: PerplexityProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    context.onProgress?.("Starting Perplexity research");
    return this.runChatTool(
      input,
      options,
      config,
      context,
      DEFAULT_RESEARCH_MODEL,
      "Research",
      true,
    );
  }

  private async runChatTool(
    input: string,
    options: Record<string, unknown> | undefined,
    config: PerplexityProviderConfig,
    context: ProviderContext,
    fallbackModel: string,
    label: "Answer" | "Research",
    isResearch = false,
  ): Promise<ProviderToolOutput> {
    const client = this.createClient(config);
    const defaults = isResearch
      ? config.defaults?.research
      : config.defaults?.answer;
    const request = {
      ...asJsonObject(defaults),
      ...(options ?? {}),
      messages: [{ role: "user", content: input }],
      model:
        resolveModel(
          (options ?? {}).model,
          asJsonObject(defaults).model,
          fallbackModel,
        ) ?? fallbackModel,
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
      summary: `${label} via Perplexity with ${sources.length} source(s)`,
      itemCount: sources.length,
    };
  }

  private createClient(config: PerplexityProviderConfig): Perplexity {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Perplexity is missing an API key.");
    }

    return new Perplexity({
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

function extractSources(response: {
  search_results?: Array<{ title?: string | null; url?: string | null }> | null;
  citations?: Array<string | null> | null;
}): Array<{ title: string; url: string }> {
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
