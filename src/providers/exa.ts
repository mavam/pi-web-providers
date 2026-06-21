import { Exa as ExaClient } from "exa-js";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import { executeAsyncResearch } from "../execution-policy.js";
import type {
  Exa,
  ProviderCapabilityStatus,
  ProviderCapabilityStatusOptions,
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { literalUnion } from "./schema.js";
import {
  asJsonObject,
  formatJson,
  getApiKeyStatus,
  trimSnippet,
} from "./shared.js";

const exaSearchOptionsSchema = Type.Object(
  {
    type: Type.Optional(
      literalUnion(
        [
          "keyword",
          "neural",
          "auto",
          "hybrid",
          "fast",
          "instant",
          "deep-lite",
          "deep",
          "deep-reasoning",
        ],
        { description: "Exa search mode." },
      ),
    ),
    category: Type.Optional(
      Type.String({
        description: "Filter by category (e.g., 'company', 'research paper').",
      }),
    ),
    includeDomains: Type.Optional(
      Type.Array(Type.String(), {
        description: "Restrict results to these domains.",
      }),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String(), { description: "Exclude these domains." }),
    ),
    startCrawlDate: Type.Optional(
      Type.String({
        description: "ISO date string for earliest crawl date.",
      }),
    ),
    endCrawlDate: Type.Optional(
      Type.String({ description: "ISO date string for latest crawl date." }),
    ),
    startPublishedDate: Type.Optional(
      Type.String({
        description: "ISO date string for earliest publish date.",
      }),
    ),
    endPublishedDate: Type.Optional(
      Type.String({ description: "ISO date string for latest publish date." }),
    ),
    includeText: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Require result page text to contain these terms. Exa currently supports one short phrase.",
      }),
    ),
    excludeText: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Require result page text not to contain these terms. Exa currently supports one short phrase.",
      }),
    ),
    systemPrompt: Type.Optional(
      Type.String({
        description:
          "Additional Exa instructions for deep search source selection and synthesis.",
      }),
    ),
    additionalQueries: Type.Optional(
      Type.Array(Type.String(), {
        maxItems: 5,
        description:
          "Alternative query formulations for Exa deep search variants.",
      }),
    ),
    userLocation: Type.Optional(
      Type.String({
        description:
          "Two-letter ISO country code for the user location, such as 'US'.",
      }),
    ),
    contents: Type.Optional(
      Type.Object(
        {
          text: Type.Optional(
            Type.Union(
              [
                Type.Boolean(),
                Type.Object(
                  {
                    maxCharacters: Type.Optional(
                      Type.Integer({
                        minimum: 1,
                        description: "Maximum text characters per result.",
                      }),
                    ),
                    includeHtmlTags: Type.Optional(
                      Type.Boolean({
                        description: "Include HTML tags in returned text.",
                      }),
                    ),
                    verbosity: Type.Optional(
                      literalUnion(["compact", "standard", "full"], {
                        description: "Verbosity level for returned text.",
                      }),
                    ),
                  },
                  { additionalProperties: false },
                ),
              ],
              { description: "Include text content." },
            ),
          ),
          highlights: Type.Optional(
            Type.Union(
              [
                Type.Boolean(),
                Type.Object(
                  {
                    query: Type.Optional(
                      Type.String({
                        description: "Query to use for highlights.",
                      }),
                    ),
                    maxCharacters: Type.Optional(
                      Type.Integer({
                        minimum: 1,
                        description: "Maximum highlight characters.",
                      }),
                    ),
                  },
                  { additionalProperties: false },
                ),
              ],
              { description: "Include highlighted excerpts." },
            ),
          ),
          summary: Type.Optional(
            Type.Union(
              [
                Type.Boolean(),
                Type.Object(
                  {
                    query: Type.Optional(
                      Type.String({
                        description: "Query to guide summary generation.",
                      }),
                    ),
                  },
                  { additionalProperties: false },
                ),
              ],
              { description: "Include AI-generated summary." },
            ),
          ),
          livecrawl: Type.Optional(
            literalUnion(["never", "fallback", "always", "auto", "preferred"], {
              description: "Livecrawl mode for fetching fresh content.",
            }),
          ),
          livecrawlTimeout: Type.Optional(
            Type.Integer({
              minimum: 0,
              description: "Livecrawl timeout in milliseconds.",
            }),
          ),
          maxAgeHours: Type.Optional(
            Type.Number({
              description:
                "Maximum age of cached content in hours. Use 0 to always fetch fresh content.",
            }),
          ),
          filterEmptyResults: Type.Optional(
            Type.Boolean({ description: "Filter results with no contents." }),
          ),
          subpages: Type.Optional(
            Type.Integer({
              minimum: 0,
              description: "Number of subpages to return for each result.",
            }),
          ),
          subpageTarget: Type.Optional(
            Type.Union([Type.String(), Type.Array(Type.String())], {
              description: "Text used to match/rank returned subpages.",
            }),
          ),
          extras: Type.Optional(
            Type.Object(
              {
                links: Type.Optional(
                  Type.Integer({
                    minimum: 0,
                    description: "Number of page links to include.",
                  }),
                ),
                imageLinks: Type.Optional(
                  Type.Integer({
                    minimum: 0,
                    description: "Number of image links to include.",
                  }),
                ),
              },
              { additionalProperties: false },
            ),
          ),
        },
        {
          additionalProperties: false,
          description: "What content to include in results.",
        },
      ),
    ),
  },
  { description: "Exa search options." },
);

const exaSearchPromptGuidelines = [
  "Use Exa's neural/auto search modes for semantic source discovery where exact keywords are uncertain; use keyword mode when exact terms, names, or identifiers matter.",
  "Use Exa category filters such as 'research paper' or 'company' when the user asks for a specific source type.",
  "Set includeDomains or excludeDomains when the task names preferred sources, requires primary sources, or needs noisy domains filtered out.",
  "Use startCrawlDate/endCrawlDate or contents.maxAgeHours when freshness of Exa's crawled content matters.",
  "Use includeText/excludeText for short required or forbidden phrases in page text.",
  "Request contents.text, contents.highlights, or contents.summary only when snippets are insufficient and richer source context is needed directly in search results.",
] as const;

const exaImplementation = {
  id: "exa" as const,
  label: "Exa",
  docsUrl: "https://exa.ai/docs/sdks/typescript-sdk-specification",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return exaSearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Exa {
    return {
      credentials: { api: "EXA_API_KEY" },
      options: {
        search: {
          type: "auto",
          contents: {
            text: true,
          },
        },
      },
    };
  },

  getCapabilityStatus(
    config: Exa | undefined,
    _cwd: string,
    _tool: Tool | undefined,
    options?: ProviderCapabilityStatusOptions,
  ): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.credentials?.api, options);
  },

  async search(
    query: string,
    maxResults: number,
    config: Exa,
    _context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const options = {
      ...(asJsonObject(config.options?.search) ?? {}),
      ...(searchOptions ?? {}),
      numResults: maxResults,
    };

    const response = await client.search(query, options as never);

    return {
      provider: exaImplementation.id,
      results: (response.results ?? [])
        .slice(0, maxResults)
        .map((result: any) => ({
          title: String(result.title ?? result.url ?? "Untitled"),
          url: String(result.url ?? ""),
          snippet: trimSnippet(
            typeof result.text === "string"
              ? result.text
              : Array.isArray(result.highlights)
                ? result.highlights.join(" ")
                : typeof result.summary === "string"
                  ? result.summary
                  : "",
          ),
          score: typeof result.score === "number" ? result.score : undefined,
        })),
    };
  },

  async contents(
    urls: string[],
    config: Exa,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const response = await client.getContents(urls, options as never);

    const results = response.results ?? [];

    return {
      provider: exaImplementation.id,
      answers: urls.map((url, index) => {
        const result = results[index];
        if (!result) {
          return {
            url,
            error: "No content returned for this URL.",
          };
        }

        return {
          url,
          ...(typeof result.text === "string" ? { content: result.text } : {}),
          ...(result.summary !== undefined ? { summary: result.summary } : {}),
          metadata: result as unknown as Record<string, unknown>,
        };
      }),
    };
  },

  async answer(
    query: string,
    config: Exa,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const client = createClient(config);
    const response = await client.answer(query, options as never);

    const lines: string[] = [];
    lines.push(
      typeof response.answer === "string"
        ? response.answer
        : formatJson(response.answer),
    );

    const citations = response.citations ?? [];
    if (citations.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, citation] of citations.entries()) {
        lines.push(
          `${index + 1}. ${String(citation.title ?? citation.url ?? "Untitled")}`,
        );
        lines.push(`   ${String(citation.url ?? "")}`);
      }
    }

    return {
      provider: exaImplementation.id,
      text: lines.join("\n").trimEnd(),
      itemCount: citations.length,
    };
  },

  async research(
    input: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: exaImplementation.label,
      providerId: exaImplementation.id,
      context,
      start: (researchContext) =>
        exaImplementation.startResearch(
          input,
          config,
          researchContext,
          options,
        ),
      poll: (id, researchContext) =>
        exaImplementation.pollResearch(id, config, researchContext, options),
    });
  },

  async startResearch(
    input: string,
    config: Exa,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = createClient(config);
    const task = await client.research.create({
      instructions: input,
      ...(options ?? {}),
    });

    return { id: task.researchId };
  },

  async pollResearch(
    id: string,
    config: Exa,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = createClient(config);
    const result = await client.research.get(id, { events: false });

    if (result.status === "completed") {
      const content = result.output?.content;
      return {
        status: "completed",
        output: {
          provider: exaImplementation.id,
          text:
            typeof content === "string"
              ? content
              : content !== undefined
                ? formatJson(content)
                : "Exa research completed without textual output.",
        },
      };
    }

    if (result.status === "failed") {
      return {
        status: "failed",
        error: result.error ?? "research failed",
      };
    }

    if (result.status === "canceled") {
      return {
        status: "cancelled",
        error: "research was canceled",
      };
    }

    return { status: "in_progress" };
  },
};

function createClient(config: Exa): ExaClient {
  const apiKey = resolveConfigValue(config.credentials?.api);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new ExaClient(apiKey, resolveConfigValue(config.baseUrl));
}

export const exaProvider = defineProvider({
  id: "exa" as const,
  label: exaImplementation.label,
  docsUrl: exaImplementation.docsUrl,
  config: {
    createTemplate: () => exaImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
    optionCapabilities: ["search"],
  },
  getCapabilityStatus: (config, cwd, tool, options) =>
    (exaImplementation.getCapabilityStatus as any)(
      config as Exa | undefined,
      cwd,
      tool,
      options,
    ),
  capabilities: {
    search: defineCapability({
      options: exaImplementation.getToolOptionsSchema?.("search"),
      promptGuidelines: exaSearchPromptGuidelines,
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await exaImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    contents: defineCapability({
      options: exaImplementation.getToolOptionsSchema?.("contents"),
      async execute(input: any, ctx) {
        return await exaImplementation.contents!(
          input.urls,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    answer: defineCapability({
      options: exaImplementation.getToolOptionsSchema?.("answer"),
      async execute(input: any, ctx) {
        return await exaImplementation.answer!(
          input.query,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    research: defineCapability({
      options: exaImplementation.getToolOptionsSchema?.("research"),
      async execute(input: any, ctx) {
        return await exaImplementation.research!(
          input.input,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
