import { asWebMuxError } from "../../errors.js";
import { orderedContents } from "../../contents.js";
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

import type { ContentsResponse } from "../../contents.js";
import { executeAsyncResearch } from "../../runtime/polling.js";
import type {
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  SearchResult,
  ToolOutput,
} from "../contract.js";
import type { Linkup } from "./types.js";

import { formatJson, trimSnippet } from "../shared.js";

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

const linkupImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Linkup,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);

    const response = await client.search(
      buildSearchParams(query, maxResults, {
        ...(options ?? {}),
      }),
    );

    return {
      provider: "linkup",
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

    return {
      provider: "linkup",
      answers: await Promise.all(
        urls.map(async (url) => {
          try {
            const response = await client.fetch(
              buildFetchParams(url, {
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
              error: asWebMuxError(error).toJSON(),
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
      providerLabel: "Linkup",
      providerId: "linkup",
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

    const task = await client.research(
      buildResearchParams(input, {
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
  const apiKey = config.credentials?.api;
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new LinkupClient({
    apiKey,
    baseUrl: config.baseUrl,
  });
}

function formatResearchTaskOutput(task: ResearchTask): ToolOutput {
  const output = task.output;
  if (!output) {
    return {
      provider: "linkup",
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
      provider: "linkup",
      text: lines.join("\n").trimEnd(),
      itemCount: sources.length,
    };
  }

  return {
    provider: "linkup",
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

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Linkup,
    context: ProviderContext,
  ) {
    return await linkupImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Linkup,
    context: ProviderContext,
  ) {
    return orderedContents(
      await linkupImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
  async research(
    input: import("../contract.js").ProviderRequest<"research">,
    config: Linkup,
    context: ProviderContext,
  ) {
    return await linkupImplementation.research(
      input.input,
      config,
      context,
      input.options,
    );
  },
};
