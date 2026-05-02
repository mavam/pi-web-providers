import { type TObject, Type } from "typebox";
import { Valyu as ValyuClient } from "valyu-js";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import { executeAsyncResearch } from "../execution-policy.js";
import type {
  ProviderCapabilityStatus,
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  Tool,
  ToolOutput,
  Valyu,
} from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { literalUnion } from "./schema.js";
import {
  asJsonObject,
  formatJson,
  getApiKeyStatus,
  trimSnippet,
} from "./shared.js";

const valyuSearchOptionsSchema = Type.Object(
  {
    searchType: Type.Optional(
      literalUnion(["all", "web", "proprietary", "news"], {
        description:
          "Valyu search type. Use 'news' for recent journalism or current events, 'web' for public web results, 'proprietary' for Valyu proprietary sources, and 'all' when both public and proprietary sources are useful.",
      }),
    ),
    responseLength: Type.Optional(
      literalUnion(["short", "medium", "large", "max"], {
        description: "Response length.",
      }),
    ),
    countryCode: Type.Optional(
      Type.String({ description: "Country code to scope search results." }),
    ),
    maxPrice: Type.Optional(
      Type.Number({ minimum: 0, description: "Maximum search cost in USD." }),
    ),
    relevanceThreshold: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 1,
        description: "Minimum result relevance score.",
      }),
    ),
    includedSources: Type.Optional(
      Type.Array(Type.String(), {
        description: "Restrict retrieval to these Valyu sources.",
      }),
    ),
    excludeSources: Type.Optional(
      Type.Array(Type.String(), {
        description: "Exclude these Valyu sources.",
      }),
    ),
    category: Type.Optional(
      Type.String({ description: "Valyu source category to search." }),
    ),
    startDate: Type.Optional(
      Type.String({ description: "ISO date string for earliest result date." }),
    ),
    endDate: Type.Optional(
      Type.String({ description: "ISO date string for latest result date." }),
    ),
    fastMode: Type.Optional(
      Type.Boolean({
        description: "Use Valyu fast mode when lower latency is preferred.",
      }),
    ),
    urlOnly: Type.Optional(
      Type.Boolean({
        description: "Return URL-focused results with less content.",
      }),
    ),
    instructions: Type.Optional(
      Type.String({
        description:
          "Provider instructions for retrieval and result selection.",
      }),
    ),
  },
  { description: "Valyu search options." },
);

const valyuSearchPromptGuidelines = [
  "Use Valyu searchType='news' for recent journalism or current events, 'web' for public web results, and 'proprietary' when proprietary Valyu sources are required.",
  "Use includedSources, excludeSources, category, or source biases from configuration when the user asks for source-specific retrieval.",
  "Use startDate/endDate and countryCode when the task requires temporal or geographic scoping.",
  "Set responseLength higher only when search results need richer inline context; otherwise prefer concise results and follow up with web_contents.",
] as const;

const valyuContentsOptionsSchema = Type.Object(
  {
    summary: Type.Optional(
      Type.Union([Type.Boolean(), Type.String()], {
        description:
          "Whether to include a summary, or instructions for the summary.",
      }),
    ),
    extractEffort: Type.Optional(
      literalUnion(["normal", "high", "auto"], {
        description:
          "Extraction effort. Use 'high' for difficult pages and 'normal' for faster extraction.",
      }),
    ),
    responseLength: Type.Optional(
      literalUnion(["short", "medium", "large", "max"], {
        description: "Content response length.",
      }),
    ),
    maxPriceDollars: Type.Optional(
      Type.Number({
        minimum: 0,
        description: "Maximum extraction cost in USD.",
      }),
    ),
    screenshot: Type.Optional(
      Type.Boolean({
        description: "Include screenshot capture when supported.",
      }),
    ),
  },
  { description: "Valyu contents options." },
);

const valyuAnswerOptionsSchema = Type.Object(
  {
    responseLength: Type.Optional(
      literalUnion(["short", "medium", "large", "max"], {
        description: "Response length for answers.",
      }),
    ),
    countryCode: Type.Optional(
      Type.String({ description: "Country code to scope answer results." }),
    ),
  },
  { description: "Valyu answer options." },
);

const valyuResearchOptionsSchema = Type.Object(
  {
    responseLength: Type.Optional(
      literalUnion(["short", "medium", "large", "max"], {
        description: "Response length for research.",
      }),
    ),
    countryCode: Type.Optional(
      Type.String({ description: "Country code to scope research results." }),
    ),
  },
  { description: "Valyu research options." },
);

const valyuImplementation = {
  id: "valyu" as const,
  label: "Valyu",
  docsUrl: "https://docs.valyu.ai/sdk/typescript-sdk",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return valyuSearchOptionsSchema;
      case "contents":
        return valyuContentsOptionsSchema;
      case "answer":
        return valyuAnswerOptionsSchema;
      case "research":
        return valyuResearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Valyu {
    return {
      credentials: { api: "VALYU_API_KEY" },
      options: {
        search: {
          searchType: "all",
          responseLength: "short",
        },
      },
    };
  },

  getCapabilityStatus(config: Valyu | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.credentials?.api);
  },

  async search(
    query: string,
    maxResults: number,
    config: Valyu,
    _context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const options = {
      ...(asJsonObject(config.options?.search) ?? {}),
      ...(searchOptions ?? {}),
      maxNumResults: maxResults,
    };

    const response = await client.search(query, options as never);
    if (!response.success) {
      throw new Error(response.error || "search failed");
    }

    return {
      provider: valyuImplementation.id,
      results: (response.results ?? []).slice(0, maxResults).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: trimSnippet(
          result.description ??
            (typeof result.content === "string" ? result.content : ""),
        ),
        score: result.relevance_score,
      })),
    };
  },

  async contents(
    urls: string[],
    config: Valyu,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const response = await client.contents(urls, {
      ...(asJsonObject(config.options?.contents) ?? {}),
      ...(options ?? {}),
    } as never);
    const finalResponse =
      "jobId" in response
        ? await client.waitForJob(response.jobId, {})
        : response;

    if (!finalResponse.success) {
      throw new Error(finalResponse.error || "contents failed");
    }

    const resultsByUrl = new Map(
      (finalResponse.results ?? []).map(
        (result) => [result.url, result] as const,
      ),
    );

    return {
      provider: valyuImplementation.id,
      answers: urls.map((url) => {
        const result = resultsByUrl.get(url);
        if (!result) {
          return {
            url,
            error: "No content returned for this URL.",
          };
        }

        return result.status === "failed"
          ? {
              url,
              error: result.error ?? formatJson(result),
            }
          : {
              url,
              ...(typeof result.content === "string" ||
              typeof result.content === "number"
                ? { content: String(result.content) }
                : {}),
              ...(result.summary !== undefined
                ? { summary: result.summary }
                : {}),
              metadata: result as unknown as Record<string, unknown>,
            };
      }),
    };
  },

  async answer(
    query: string,
    config: Valyu,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const client = createClient(config);
    const response = await client.answer(query, {
      ...(asJsonObject(config.options?.answer) ?? {}),
      ...(options ?? {}),
      streaming: false,
    } as never);

    if (!("success" in response) || !response.success) {
      throw new Error(
        "error" in response && typeof response.error === "string"
          ? response.error
          : "answer failed",
      );
    }

    const lines: string[] = [];
    const contents =
      typeof response.contents === "string"
        ? response.contents
        : formatJson(response.contents);
    lines.push(contents);

    const sources = response.search_results ?? [];
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, result] of sources.entries()) {
        lines.push(`${index + 1}. ${result.title}`);
        lines.push(`   ${result.url}`);
      }
    }

    return {
      provider: valyuImplementation.id,
      text: lines.join("\n").trimEnd(),
      itemCount: sources.length,
    };
  },

  async research(
    input: string,
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: valyuImplementation.label,
      providerId: valyuImplementation.id,
      context,
      start: (researchContext) =>
        valyuImplementation.startResearch(
          input,
          config,
          researchContext,
          options,
        ),
      poll: (id, researchContext) =>
        valyuImplementation.pollResearch(id, config, researchContext, options),
    });
  },

  async startResearch(
    input: string,
    config: Valyu,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = createClient(config);
    const task = await client.deepresearch.create({
      input,
      ...(asJsonObject(config.options?.research) ?? {}),
      ...(options ?? {}),
    } as never);

    if (!task.success || !task.deepresearch_id) {
      throw new Error(task.error || "deep research creation failed");
    }

    return { id: task.deepresearch_id };
  },

  async pollResearch(
    id: string,
    config: Valyu,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = createClient(config);
    const result = await client.deepresearch.status(id);

    if (!result.success) {
      throw new Error(result.error || "deep research failed");
    }

    if (result.status === "completed") {
      const lines: string[] = [];
      lines.push(
        typeof result.output === "string"
          ? result.output
          : result.output
            ? formatJson(result.output)
            : "Valyu deep research completed without textual output.",
      );

      const sources = result.sources ?? [];
      if (sources.length > 0) {
        lines.push("");
        lines.push("Sources:");
        for (const [index, source] of sources.entries()) {
          lines.push(`${index + 1}. ${source.title}`);
          lines.push(`   ${source.url}`);
        }
      }

      return {
        status: "completed",
        output: {
          provider: valyuImplementation.id,
          text: lines.join("\n").trimEnd(),
          itemCount: sources.length,
        },
      };
    }

    if (result.status === "failed") {
      return {
        status: "failed",
        error: result.error || "research failed",
      };
    }

    if (result.status === "cancelled") {
      return {
        status: "cancelled",
        error: result.error || "research was canceled",
      };
    }

    return { status: "in_progress" };
  },
};

function createClient(config: Valyu): ValyuClient {
  const apiKey = resolveConfigValue(config.credentials?.api);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new ValyuClient(apiKey, resolveConfigValue(config.baseUrl));
}

export const valyuProvider = defineProvider({
  id: "valyu" as const,
  label: valyuImplementation.label,
  docsUrl: valyuImplementation.docsUrl,
  config: {
    createTemplate: () => valyuImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
    optionCapabilities: ["search", "contents", "answer", "research"],
  },
  getCapabilityStatus: (config, cwd, tool) =>
    (valyuImplementation.getCapabilityStatus as any)(
      config as Valyu | undefined,
      cwd,
      tool,
    ),
  capabilities: {
    search: defineCapability({
      options: valyuImplementation.getToolOptionsSchema?.("search"),
      promptGuidelines: valyuSearchPromptGuidelines,
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await valyuImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    contents: defineCapability({
      options: valyuImplementation.getToolOptionsSchema?.("contents"),
      async execute(input: any, ctx) {
        return await valyuImplementation.contents!(
          input.urls,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    answer: defineCapability({
      options: valyuImplementation.getToolOptionsSchema?.("answer"),
      async execute(input: any, ctx) {
        return await valyuImplementation.answer!(
          input.query,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    research: defineCapability({
      options: valyuImplementation.getToolOptionsSchema?.("research"),
      async execute(input: any, ctx) {
        return await valyuImplementation.research!(
          input.input,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
