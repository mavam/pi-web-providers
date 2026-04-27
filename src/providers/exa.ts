import { Exa as ExaClient } from "exa-js";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import { executeAsyncResearch } from "../execution-policy.js";
import type {
  Exa,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { literalUnion } from "./schema.js";
import {
  asJsonObject,
  formatJson,
  getApiKeyStatus,
  trimSnippet,
} from "./shared.js";

import { wrapAdapter } from "./definition.js";
type ExaAdapter = ProviderAdapter<"exa"> & {
  search(
    query: string,
    maxResults: number,
    config: Exa,
    context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
  answer(
    query: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
  research(
    input: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
  startResearch(
    input: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob>;
  pollResearch(
    id: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchPollResult>;
};

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
          "deep",
          "deep-reasoning",
          "deep-max",
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
    startPublishedDate: Type.Optional(
      Type.String({
        description: "ISO date string for earliest publish date.",
      }),
    ),
    endPublishedDate: Type.Optional(
      Type.String({ description: "ISO date string for latest publish date." }),
    ),
    userLocation: Type.Optional(
      Type.Object(
        {
          country: Type.Optional(
            Type.String({ description: "Country hint for the user location." }),
          ),
          region: Type.Optional(
            Type.String({ description: "Region hint for the user location." }),
          ),
          city: Type.Optional(
            Type.String({ description: "City hint for the user location." }),
          ),
          timezone: Type.Optional(
            Type.String({
              description: "Timezone hint for the user location.",
            }),
          ),
        },
        {
          description: "User location hint passed through to the Exa SDK.",
        },
      ),
    ),
    contents: Type.Optional(
      Type.Object(
        {
          text: Type.Optional(
            Type.Boolean({ description: "Include text content." }),
          ),
          highlights: Type.Optional(
            Type.Boolean({ description: "Include highlighted excerpts." }),
          ),
          summary: Type.Optional(
            Type.Boolean({ description: "Include AI-generated summary." }),
          ),
        },
        { description: "What content to include in results." },
      ),
    ),
  },
  { description: "Exa search options." },
);

export const exaAdapter: ExaAdapter = {
  id: "exa",
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
      apiKey: "EXA_API_KEY",
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

  getCapabilityStatus(config: Exa | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
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
      provider: exaAdapter.id,
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
      provider: exaAdapter.id,
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
      provider: exaAdapter.id,
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
      providerLabel: exaAdapter.label,
      providerId: exaAdapter.id,
      context,
      start: (researchContext) =>
        exaAdapter.startResearch(input, config, researchContext, options),
      poll: (id, researchContext) =>
        exaAdapter.pollResearch(id, config, researchContext, options),
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
          provider: exaAdapter.id,
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
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new ExaClient(apiKey, resolveConfigValue(config.baseUrl));
}

export const exaProvider = wrapAdapter(exaAdapter, {
  fields: ["apiKey", "baseUrl", "options", "settings"],
  optionCapabilities: ["search"],
});
