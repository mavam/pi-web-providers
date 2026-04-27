import {
  type FetchParams,
  LinkupClient,
  type SearchDepth,
  type SearchParams,
} from "linkup-sdk";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import type {
  Linkup,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  SearchResult,
  Tool,
} from "../types.js";
import { literalUnion } from "./schema.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

import { wrapAdapter } from "./definition.js";
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

type LinkupAdapter = ProviderAdapter<"linkup"> & {
  search(
    query: string,
    maxResults: number,
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Linkup,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
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

export const linkupAdapter: LinkupAdapter = {
  id: "linkup",
  label: "Linkup",
  docsUrl: "https://docs.linkup.so/pages/sdk/js/js",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return linkupSearchOptionsSchema;
      case "contents":
        return linkupContentsOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Linkup {
    return {
      apiKey: "LINKUP_API_KEY",
    };
  },

  getCapabilityStatus(config: Linkup | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
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
      provider: linkupAdapter.id,
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
      provider: linkupAdapter.id,
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

function createClient(config: Linkup): LinkupClient {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new LinkupClient({
    apiKey,
    baseUrl: resolveConfigValue(config.baseUrl),
  });
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

export const linkupProvider = wrapAdapter(linkupAdapter, {
  fields: ["apiKey", "baseUrl", "options", "settings"],
});
