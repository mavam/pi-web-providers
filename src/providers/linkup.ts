import {
  type FetchParams,
  LinkupClient,
  type ResearchMode,
  type ResearchParams,
  type ResearchReasoningDepth,
  type ResearchTask,
  type SearchDepth,
  type SearchParams,
} from "linkup-sdk";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import { executeAsyncResearch } from "../execution-policy.js";
import type {
  Linkup,
  ProviderCapabilityStatus,
  ProviderCapabilityStatusOptions,
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  SearchResult,
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

import { defineCapability, defineProvider } from "./definition.js";
type LinkupSearchOptions = {
  depth?: SearchDepth;
  includeImages?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  fromDate?: string | number | Date;
  toDate?: string | number | Date;
  query?: string;
  outputType?: string;
  maxResults?: number;
  includeInlineCitations?: boolean;
  includeSources?: boolean;
  structuredOutputSchema?: unknown;
};

type LinkupFetchOptions = Omit<FetchParams, "url"> & {
  url?: string;
};

type ManagedLinkupSearchParams = Extract<
  SearchParams,
  { outputType: "searchResults" }
>;

type ManagedLinkupResearchParams = ResearchParams;

type LinkupResearchOptions = {
  outputType?: "sourcedAnswer" | "structured";
  mode?: ResearchMode;
  reasoningDepth?: ResearchReasoningDepth;
  includeDomains?: string[];
  excludeDomains?: string[];
  fromDate?: string | number | Date;
  toDate?: string | number | Date;
  structuredOutputSchema?: unknown;
  q?: string;
  query?: string;
  input?: string;
};

const linkupSearchOptionsSchema = Type.Object(
  {
    depth: Type.Optional(
      literalUnion(["standard", "deep"], {
        description: "Search depth. 'deep' is slower but more thorough.",
      }),
    ),
    includeImages: Type.Optional(
      Type.Boolean({ description: "Include images in search results." }),
    ),
    includeDomains: Type.Optional(
      Type.Array(Type.String(), {
        description: "Restrict results to these domains.",
      }),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String(), { description: "Exclude these domains." }),
    ),
    fromDate: Type.Optional(
      Type.String({ description: "ISO date string for earliest result date." }),
    ),
    toDate: Type.Optional(
      Type.String({ description: "ISO date string for latest result date." }),
    ),
  },
  { description: "Linkup search options." },
);

const linkupContentsOptionsSchema = Type.Object(
  {
    renderJs: Type.Optional(
      Type.Boolean({
        description: "Render JavaScript before extracting content.",
      }),
    ),
    includeRawHtml: Type.Optional(
      Type.Boolean({ description: "Include raw HTML in the response." }),
    ),
    extractImages: Type.Optional(
      Type.Boolean({ description: "Extract images from the page." }),
    ),
  },
  { description: "Linkup fetch options." },
);

const linkupResearchOptionsSchema = Type.Object(
  {
    outputType: Type.Optional(
      literalUnion(["sourcedAnswer", "structured"], {
        description:
          "Research output type. Defaults to 'sourcedAnswer' unless structuredOutputSchema is provided.",
      }),
    ),
    mode: Type.Optional(
      literalUnion(["answer", "auto", "investigate", "research"], {
        description:
          "Research mode. Use 'answer' for precise verified answers, 'investigate' for focused deep dives, 'research' for broad reports, or omit/auto to let Linkup classify the task.",
      }),
    ),
    reasoningDepth: Type.Optional(
      literalUnion(["S", "M", "L", "XL"], {
        description:
          "Reasoning depth. Higher values trade latency for more thorough investigation.",
      }),
    ),
    includeDomains: Type.Optional(
      Type.Array(Type.String(), {
        description: "Restrict research to these domains.",
      }),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String(), { description: "Exclude these domains." }),
    ),
    fromDate: Type.Optional(
      Type.String({ description: "ISO date string for earliest result date." }),
    ),
    toDate: Type.Optional(
      Type.String({ description: "ISO date string for latest result date." }),
    ),
    structuredOutputSchema: Type.Optional(
      Type.Record(Type.String(), Type.Any(), {
        description:
          "JSON schema object required when outputType is 'structured'.",
      }),
    ),
  },
  { description: "Linkup research options." },
);

const linkupImplementation = {
  id: "linkup" as const,
  label: "Linkup",
  docsUrl: "https://docs.linkup.so/pages/sdk/js/js",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return linkupSearchOptionsSchema;
      case "contents":
        return linkupContentsOptionsSchema;
      case "research":
        return linkupResearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Linkup {
    return {
      credentials: { api: "LINKUP_API_KEY" },
    };
  },

  getCapabilityStatus(
    config: Linkup | undefined,
    _cwd: string,
    _tool: Tool | undefined,
    options?: ProviderCapabilityStatusOptions,
  ): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.credentials?.api, options);
  },

  async search(
    query: string,
    maxResults: number,
    config: Linkup,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.search) ?? {};
    const response = await client.search(
      buildSearchParams(query, maxResults, {
        ...defaults,
        ...(options ?? {}),
      }),
    );

    return {
      provider: linkupImplementation.id,
      results: (response.results ?? [])
        .map(toSearchResult)
        .filter((result): result is SearchResult => result !== null)
        .slice(0, maxResults),
    };
  },

  async contents(
    urls: string[],
    config: Linkup,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.fetch) ?? {};

    return {
      provider: linkupImplementation.id,
      answers: await Promise.all(
        urls.map(async (url) => {
          try {
            const response = await client.fetch(
              buildFetchParams(url, {
                ...defaults,
                ...(options ?? {}),
              }),
            );

            return response.markdown
              ? {
                  url,
                  content: response.markdown,
                }
              : {
                  url,
                  error: "No content returned for this URL.",
                };
          } catch (error) {
            return {
              url,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      ),
    };
  },

  async research(
    input: string,
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: linkupImplementation.label,
      providerId: linkupImplementation.id,
      context,
      start: (researchContext) =>
        linkupImplementation.startResearch(
          input,
          config,
          researchContext,
          options,
        ),
      poll: (id, researchContext) =>
        linkupImplementation.pollResearch(id, config, researchContext),
    });
  },

  async startResearch(
    input: string,
    config: Linkup,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.research) ?? {};
    const task = await client.research(
      buildResearchParams(input, {
        ...defaults,
        ...(options ?? {}),
      }),
    );

    return { id: task.id };
  },

  async pollResearch(
    id: string,
    config: Linkup,
    _context: ProviderContext,
  ): Promise<ResearchPollResult> {
    const client = createClient(config);
    const task = await client.getResearch(id);

    if (task.status === "completed") {
      return {
        status: "completed",
        output: formatResearchTaskOutput(task),
      };
    }

    if (task.status === "failed") {
      return {
        status: "failed",
        error: task.error ?? "research failed",
      };
    }

    return {
      status: "in_progress",
      statusText: task.status,
    };
  },
};

function buildSearchParams(
  query: string,
  maxResults: number,
  options: Record<string, unknown>,
): ManagedLinkupSearchParams {
  const searchOptions = options as LinkupSearchOptions;

  if (searchOptions.query !== undefined) {
    throw new Error("Linkup search options cannot override the managed query.");
  }
  if (searchOptions.maxResults !== undefined) {
    throw new Error(
      "Linkup search options cannot override the managed maxResults.",
    );
  }
  if (
    searchOptions.outputType !== undefined &&
    searchOptions.outputType !== "searchResults"
  ) {
    throw new Error("Linkup search only supports outputType 'searchResults'.");
  }
  if (
    searchOptions.includeInlineCitations !== undefined ||
    searchOptions.includeSources !== undefined ||
    searchOptions.structuredOutputSchema !== undefined
  ) {
    throw new Error(
      "Linkup search only supports search-results mode for managed web_search.",
    );
  }

  return {
    query,
    depth: searchOptions.depth ?? "standard",
    outputType: "searchResults",
    maxResults,
    ...(searchOptions.includeImages !== undefined
      ? { includeImages: searchOptions.includeImages }
      : {}),
    ...(searchOptions.includeDomains !== undefined
      ? { includeDomains: searchOptions.includeDomains }
      : {}),
    ...(searchOptions.excludeDomains !== undefined
      ? { excludeDomains: searchOptions.excludeDomains }
      : {}),
    ...(searchOptions.fromDate !== undefined
      ? { fromDate: toDate(searchOptions.fromDate, "fromDate") }
      : {}),
    ...(searchOptions.toDate !== undefined
      ? { toDate: toDate(searchOptions.toDate, "toDate") }
      : {}),
  };
}

function buildFetchParams(
  url: string,
  options: Record<string, unknown>,
): FetchParams {
  const fetchOptions = options as LinkupFetchOptions;

  if (fetchOptions.url !== undefined) {
    throw new Error("Linkup fetch options cannot override the managed URL.");
  }

  return {
    url,
    ...(fetchOptions.renderJs !== undefined
      ? { renderJs: fetchOptions.renderJs }
      : {}),
    ...(fetchOptions.includeRawHtml !== undefined
      ? { includeRawHtml: fetchOptions.includeRawHtml }
      : {}),
    ...(fetchOptions.extractImages !== undefined
      ? { extractImages: fetchOptions.extractImages }
      : {}),
  };
}

function buildResearchParams(
  input: string,
  options: Record<string, unknown>,
): ManagedLinkupResearchParams {
  const researchOptions = options as LinkupResearchOptions;

  if (
    researchOptions.q !== undefined ||
    researchOptions.query !== undefined ||
    researchOptions.input !== undefined
  ) {
    throw new Error(
      "Linkup research options cannot override the managed input.",
    );
  }

  const outputType =
    researchOptions.outputType ??
    (researchOptions.structuredOutputSchema !== undefined
      ? "structured"
      : "sourcedAnswer");

  if (
    outputType === "structured" &&
    researchOptions.structuredOutputSchema === undefined
  ) {
    throw new Error(
      "Linkup research outputType 'structured' requires structuredOutputSchema.",
    );
  }

  if (
    outputType === "sourcedAnswer" &&
    researchOptions.structuredOutputSchema !== undefined
  ) {
    throw new Error(
      "Linkup research structuredOutputSchema requires outputType 'structured'.",
    );
  }

  const commonParams = {
    query: input,
    ...(researchOptions.includeDomains !== undefined
      ? { includeDomains: researchOptions.includeDomains }
      : {}),
    ...(researchOptions.excludeDomains !== undefined
      ? { excludeDomains: researchOptions.excludeDomains }
      : {}),
    ...(researchOptions.fromDate !== undefined
      ? { fromDate: toDate(researchOptions.fromDate, "fromDate") }
      : {}),
    ...(researchOptions.toDate !== undefined
      ? { toDate: toDate(researchOptions.toDate, "toDate") }
      : {}),
    ...(researchOptions.mode !== undefined
      ? { mode: researchOptions.mode }
      : {}),
    ...(researchOptions.reasoningDepth !== undefined
      ? { reasoningDepth: researchOptions.reasoningDepth }
      : {}),
  };

  if (outputType === "structured") {
    return {
      ...commonParams,
      outputType,
      structuredOutputSchema: researchOptions.structuredOutputSchema,
    } as ManagedLinkupResearchParams;
  }

  return {
    ...commonParams,
    outputType,
  } as ManagedLinkupResearchParams;
}

function createClient(config: Linkup): LinkupClient {
  const apiKey = resolveConfigValue(config.credentials?.api);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new LinkupClient({
    apiKey,
    baseUrl: resolveConfigValue(config.baseUrl),
  });
}

function formatResearchTaskOutput(task: ResearchTask): ToolOutput {
  const output = task.output;
  if (!output) {
    return {
      provider: linkupImplementation.id,
      text: "Linkup research completed without textual output.",
    };
  }

  const outputRecord = asRecord(output);
  const inputRecord = asRecord(task.input);
  const outputType = inputRecord
    ? readString(inputRecord.outputType)
    : undefined;
  const answer = outputRecord ? readString(outputRecord.answer) : undefined;
  const sources = outputRecord ? readSources(outputRecord.sources) : [];

  if (outputType !== "structured" && answer !== undefined) {
    const lines = [answer];
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }

    return {
      provider: linkupImplementation.id,
      text: lines.join("\n").trimEnd(),
      itemCount: sources.length,
    };
  }

  return {
    provider: linkupImplementation.id,
    text: formatJson(output),
  };
}

function toSearchResult(value: unknown): SearchResult | null {
  const entry = asRecord(value);
  if (!entry) {
    return null;
  }

  const url = readString(entry.url) ?? "";
  const title = readString(entry.name) ?? (url || "Untitled");
  const type = readString(entry.type);
  const favicon = readString(entry.favicon);
  const snippet =
    type === "text" ? trimSnippet(readString(entry.content) ?? "") : "";
  const metadata = {
    ...(type ? { type } : {}),
    ...(favicon ? { favicon } : {}),
  };

  return {
    title,
    url,
    snippet,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function readSources(value: unknown): Array<{ title: string; url: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const source = asRecord(entry);
    if (!source) {
      return [];
    }

    const url = readString(source.url);
    if (!url) {
      return [];
    }

    return [
      {
        title: readString(source.name) ?? url,
        url,
      },
    ];
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toDate(value: string | number | Date, name: string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Linkup option '${name}' must be a valid date string, timestamp, or Date.`,
    );
  }
  return date;
}

export const linkupProvider = defineProvider({
  id: "linkup" as const,
  label: linkupImplementation.label,
  docsUrl: linkupImplementation.docsUrl,
  config: {
    createTemplate: () => linkupImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
  },
  getCapabilityStatus: (config, cwd, tool, options) =>
    (linkupImplementation.getCapabilityStatus as any)(
      config as Linkup | undefined,
      cwd,
      tool,
      options,
    ),
  capabilities: {
    search: defineCapability({
      options: linkupImplementation.getToolOptionsSchema?.("search"),
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await linkupImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    contents: defineCapability({
      options: linkupImplementation.getToolOptionsSchema?.("contents"),
      async execute(input: any, ctx) {
        return await linkupImplementation.contents!(
          input.urls,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    research: defineCapability({
      options: linkupImplementation.getToolOptionsSchema?.("research"),
      async execute(input: any, ctx) {
        return await linkupImplementation.research!(
          input.input,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
