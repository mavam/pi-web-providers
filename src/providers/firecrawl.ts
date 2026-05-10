import FirecrawlClient, {
  type Document,
  type SearchData,
} from "@mendable/firecrawl-js";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import type {
  Firecrawl,
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  SearchResult,
  Tool,
} from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { literalUnion } from "./schema.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

const firecrawlSearchOptionsSchema = Type.Object(
  {
    lang: Type.Optional(
      Type.String({
        description: "Language code for search results (for example 'en').",
      }),
    ),
    country: Type.Optional(
      Type.String({
        description: "Country code for search results (for example 'us').",
      }),
    ),
    sources: Type.Optional(
      Type.Array(Type.String(), {
        description: "Search source groups to include.",
      }),
    ),
    categories: Type.Optional(
      Type.Array(Type.String(), {
        description: "Search categories to include.",
      }),
    ),
    location: Type.Optional(
      Type.Object(
        {
          country: Type.Optional(Type.String({ description: "Country hint." })),
          region: Type.Optional(Type.String({ description: "Region hint." })),
          city: Type.Optional(Type.String({ description: "City hint." })),
        },
        { description: "Location hint for search." },
      ),
    ),
    timeout: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Request timeout in milliseconds.",
      }),
    ),
    scrapeOptions: Type.Optional(
      Type.Object(
        {
          formats: Type.Optional(
            Type.Array(literalUnion(["markdown", "html", "rawHtml"]), {
              description: "Output formats.",
            }),
          ),
          onlyMainContent: Type.Optional(
            Type.Boolean({ description: "Extract only the main content." }),
          ),
        },
        {
          description: "Options for scraping each search result.",
        },
      ),
    ),
  },
  { description: "Firecrawl search options." },
);

const firecrawlSearchPromptGuidelines = [
  "Use Firecrawl search when the task benefits from searchable results that can also include scraped page content through scrapeOptions.",
  "Set scrapeOptions.formats=['markdown'] and onlyMainContent=true when source snippets are not enough and the user needs extracted page context in the search results.",
  "Use lang, country, or location when the user asks for language-specific, country-specific, or local results.",
  "Prefer web_contents with Firecrawl scrape options after search when only a small set of known URLs needs full extraction.",
] as const;

const firecrawlScrapeOptionsSchema = Type.Object(
  {
    formats: Type.Optional(
      Type.Array(literalUnion(["markdown", "html", "rawHtml"]), {
        description: "Output formats for scraping.",
      }),
    ),
    onlyMainContent: Type.Optional(
      Type.Boolean({ description: "Extract only the main content." }),
    ),
    includeTags: Type.Optional(
      Type.Array(Type.String(), { description: "CSS selectors to include." }),
    ),
    excludeTags: Type.Optional(
      Type.Array(Type.String(), { description: "CSS selectors to exclude." }),
    ),
    waitFor: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Milliseconds to wait before scraping.",
      }),
    ),
    headers: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Headers to send when scraping.",
      }),
    ),
    location: Type.Optional(
      Type.Object(
        {
          country: Type.Optional(Type.String({ description: "Country hint." })),
          region: Type.Optional(Type.String({ description: "Region hint." })),
          city: Type.Optional(Type.String({ description: "City hint." })),
        },
        { description: "Location hint for scraping." },
      ),
    ),
    mobile: Type.Optional(
      Type.Boolean({ description: "Use a mobile browser profile." }),
    ),
    proxy: Type.Optional(
      Type.String({
        description: "Proxy mode passed through to the Firecrawl SDK.",
      }),
    ),
  },
  { description: "Firecrawl scrape options." },
);

const firecrawlImplementation = {
  id: "firecrawl" as const,
  label: "Firecrawl",
  docsUrl: "https://docs.firecrawl.dev/sdks/node",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return firecrawlSearchOptionsSchema;
      case "contents":
        return firecrawlScrapeOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Firecrawl {
    return {
      credentials: { api: "FIRECRAWL_API_KEY" },
      options: {
        scrape: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      },
    };
  },

  getCapabilityStatus(config: Firecrawl | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.credentials?.api);
  },

  async search(
    query: string,
    maxResults: number,
    config: Firecrawl,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.search) ?? {};
    const response = await client.search(query, {
      ...defaults,
      ...(options ?? {}),
      limit: maxResults,
    });

    return {
      provider: firecrawlImplementation.id,
      results: flattenSearchResults(response).slice(0, maxResults),
    };
  },

  async contents(
    urls: string[],
    config: Firecrawl,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const defaults = asJsonObject(config.options?.scrape) ?? {};
    const scrapeOptions = {
      formats: ["markdown"],
      onlyMainContent: true,
      ...defaults,
      ...(options ?? {}),
    };

    return {
      provider: firecrawlImplementation.id,
      answers: await Promise.all(
        urls.map(async (url) => {
          try {
            const document = await client.scrape(url, scrapeOptions as never);
            const content = getDocumentContent(document);
            return content
              ? {
                  url,
                  content,
                  ...(document.metadata
                    ? {
                        metadata: document.metadata as Record<string, unknown>,
                      }
                    : {}),
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

function createClient(config: Firecrawl): FirecrawlClient {
  const apiKey = resolveConfigValue(config.credentials?.api);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new FirecrawlClient({
    apiKey,
    apiUrl: resolveConfigValue(config.baseUrl),
  });
}

function flattenSearchResults(response: SearchData): SearchResult[] {
  return (["web", "news", "images"] as const).flatMap((source) =>
    (response[source] ?? [])
      .map((entry) => toSearchResult(source, entry))
      .filter((entry): entry is SearchResult => entry !== null),
  );
}

function toSearchResult(
  source: "web" | "news" | "images",
  value: unknown,
): SearchResult | null {
  const entry = asRecord(value);
  if (!entry) {
    return null;
  }

  const metadata = asRecord(entry.metadata);
  const url =
    readString(entry.url) ??
    readString(metadata?.sourceURL) ??
    readString(entry.imageUrl) ??
    "";
  const title = readString(entry.title) ?? readString(metadata?.title) ?? url;
  const snippet = trimSnippet(
    readString(entry.description) ??
      readString(entry.snippet) ??
      readString(entry.markdown) ??
      readString(metadata?.description) ??
      "",
  );
  const resultMetadata = {
    source,
    ...(readString(entry.category) ? { category: entry.category } : {}),
    ...(readString(entry.date) ? { date: entry.date } : {}),
    ...(readString(entry.imageUrl) ? { imageUrl: entry.imageUrl } : {}),
    ...(typeof entry.position === "number" ? { position: entry.position } : {}),
    ...(metadata ?? {}),
  };

  return {
    title: title || "Untitled",
    url,
    snippet,
    metadata:
      Object.keys(resultMetadata).length > 1 ? resultMetadata : undefined,
  };
}

function getDocumentContent(document: Document): string | undefined {
  if (typeof document.markdown === "string" && document.markdown.trim()) {
    return document.markdown;
  }
  if (typeof document.html === "string" && document.html.trim()) {
    return document.html;
  }
  if (typeof document.rawHtml === "string" && document.rawHtml.trim()) {
    return document.rawHtml;
  }
  return document.json !== undefined
    ? JSON.stringify(document.json, null, 2)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const firecrawlProvider = defineProvider({
  id: "firecrawl" as const,
  label: firecrawlImplementation.label,
  docsUrl: firecrawlImplementation.docsUrl,
  config: {
    createTemplate: () => firecrawlImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
  },
  getCapabilityStatus: (config, cwd, tool) =>
    (firecrawlImplementation.getCapabilityStatus as any)(
      config as Firecrawl | undefined,
      cwd,
      tool,
    ),
  capabilities: {
    search: defineCapability({
      options: firecrawlImplementation.getToolOptionsSchema?.("search"),
      promptGuidelines: firecrawlSearchPromptGuidelines,
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await firecrawlImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    contents: defineCapability({
      options: firecrawlImplementation.getToolOptionsSchema?.("contents"),
      async execute(input: any, ctx) {
        return await firecrawlImplementation.contents!(
          input.urls,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
