import PerplexityClient from "@perplexity-ai/perplexity_ai";
import { type TObject, Type } from "@sinclair/typebox";
import { resolveConfigValue } from "../config.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  Perplexity,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { passthroughOptionsSchema } from "./schema.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

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

type PerplexityAdapter = ProviderAdapter<Perplexity> & {
  search(
    query: string,
    maxResults: number,
    config: Perplexity,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  answer(
    query: string,
    config: Perplexity,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
  research(
    input: string,
    config: Perplexity,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
};

const perplexitySearchOptionsSchema = passthroughOptionsSchema(
  "Perplexity search options passed through to the SDK.",
);

const perplexityAnswerOptionsSchema = Type.Object(
  {
    model: Type.Optional(
      Type.String({
        description: "Perplexity model to use (e.g., 'sonar', 'sonar-pro').",
      }),
    ),
  },
  { description: "Perplexity answer options." },
);

const perplexityResearchOptionsSchema = Type.Object(
  {
    model: Type.Optional(
      Type.String({
        description: "Perplexity model to use (e.g., 'sonar-deep-research').",
      }),
    ),
  },
  { description: "Perplexity research options." },
);

export const perplexityAdapter: PerplexityAdapter = {
  id: "perplexity",
  label: "Perplexity",
  docsUrl: "https://docs.perplexity.ai/docs/sdk/overview.md",
  tools: ["search", "answer", "research"] as const,

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return perplexitySearchOptionsSchema;
      case "answer":
        return perplexityAnswerOptionsSchema;
      case "research":
        return perplexityResearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Perplexity {
    return {
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
  },

  getCapabilityStatus(
    config: Perplexity | undefined,
  ): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Perplexity) {
    return buildProviderPlan({
      request,
      config,
      providerId: perplexityAdapter.id,
      providerLabel: perplexityAdapter.label,
      handlers: {
        search: {
          execute: (
            searchRequest,
            providerConfig: Perplexity,
            context: ProviderContext,
          ) =>
            perplexityAdapter.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        },
        answer: {
          execute: (
            answerRequest,
            providerConfig: Perplexity,
            context: ProviderContext,
          ) =>
            perplexityAdapter.answer(
              answerRequest.query,
              providerConfig,
              context,
              answerRequest.options,
            ),
        },
        research: {
          execute: (
            researchRequest,
            providerConfig: Perplexity,
            context: ProviderContext,
          ) =>
            perplexityAdapter.research(
              researchRequest.input,
              providerConfig,
              context,
              researchRequest.options,
            ),
        },
      },
    });
  },

  async search(
    query: string,
    maxResults: number,
    config: Perplexity,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const request = {
      ...(stripLocalExecutionOptions(asJsonObject(config.options?.search)) ??
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
      provider: perplexityAdapter.id,
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
  },

  async answer(
    query: string,
    config: Perplexity,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return runSilentForegroundChatTool(
      query,
      config,
      context,
      DEFAULT_ANSWER_MODEL,
      "Answer",
      options,
    );
  },

  async research(
    input: string,
    config: Perplexity,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return runStreamingForegroundChatTool(
      input,
      config,
      context,
      DEFAULT_RESEARCH_MODEL,
      "Research",
      options,
    );
  },
};

async function runSilentForegroundChatTool(
  input: string,
  config: Perplexity,
  context: ProviderContext,
  fallbackModel: string,
  label: "Answer" | "Research",
  options?: Record<string, unknown>,
  isResearch = false,
): Promise<ToolOutput> {
  const client = createClient(config);
  const defaults =
    stripLocalExecutionOptions(
      isResearch
        ? asJsonObject(config.options?.research)
        : asJsonObject(config.options?.answer),
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
    provider: perplexityAdapter.id,
    text: lines.join("\n").trimEnd(),
    itemCount: sources.length,
  };
}

async function runStreamingForegroundChatTool(
  input: string,
  config: Perplexity,
  context: ProviderContext,
  fallbackModel: string,
  label: "Answer" | "Research",
  options?: Record<string, unknown>,
): Promise<ToolOutput> {
  const client = createClient(config);
  const defaults =
    stripLocalExecutionOptions(asJsonObject(config.options?.research)) ?? {};
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
    provider: perplexityAdapter.id,
    text: lines.join("\n").trimEnd(),
    itemCount: dedupedSources.length,
  };
}

function createClient(config: Perplexity): PerplexityClient {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new PerplexityClient({
    apiKey,
    baseURL: resolveConfigValue(config.baseUrl),
  });
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
