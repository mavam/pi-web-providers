import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type {
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  SearchResult,
  Serper,
  SerperSearchMode,
  Tool,
} from "../types.js";
import { SERPER_SEARCH_MODE_VALUES } from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

const DEFAULT_BASE_URL = "https://google.serper.dev";
const DEFAULT_SCRAPE_URL = "https://scrape.serper.dev";

type SerperRequestOptions = {
  mode: SerperSearchMode;
  gl?: string;
  hl?: string;
  location?: string;
  page?: number;
  tbs?: string;
  autocorrect?: boolean;
  url?: string;
  ll?: string;
  placeId?: string;
  cid?: string;
  fid?: string;
  sortBy?: string;
  topicId?: string;
  productId?: string;
  nextPageToken?: string;
  includeMarkdown?: boolean;
  includeImages?: boolean;
  includeLinks?: boolean;
  includeVideos?: boolean;
  extra: Record<string, unknown>;
};

const SERPER_SEARCH_MODES = Object.values(SERPER_SEARCH_MODE_VALUES);
const SERPER_SEARCH_MODE_SET = new Set<string>(SERPER_SEARCH_MODES);

const RESERVED_REQUEST_OPTION_KEYS = [
  "q",
  "num",
  "mode",
  "url",
  "productId",
  "nextPageToken",
  "ll",
  "placeId",
  "cid",
  "fid",
  "sortBy",
  "topicId",
  "includeMarkdown",
  "includeImages",
  "includeLinks",
  "includeVideos",
  "location",
  "gl",
  "hl",
  "tbs",
  "page",
  "autocorrect",
] as const;

const PRIMARY_RESULT_FIELDS_BY_MODE = {
  search: ["organic"],
  images: ["images"],
  videos: ["videos"],
  places: ["places"],
  maps: ["maps", "places"],
  reviews: ["reviews"],
  news: ["news"],
  shopping: ["shopping"],
  "product-reviews": ["reviews", "productReviews"],
  lens: ["visualMatches", "organic", "images"],
  scholar: ["organic"],
  patents: ["organic"],
  autocomplete: ["suggestions"],
  webpage: [],
} as const satisfies Record<SerperSearchMode, readonly string[]>;

const CONTEXT_ARRAY_FIELDS = [
  "peopleAlsoAsk",
  "relatedSearches",
  "topStories",
  "news",
  "images",
  "videos",
  "places",
  "maps",
  "shopping",
  "reviews",
  "productReviews",
  "visualMatches",
  "suggestions",
] as const;

const serperSearchOptionsSchema = Type.Object(
  {
    mode: Type.Optional(
      Type.Enum(SERPER_SEARCH_MODE_VALUES, {
        description:
          "Serper search type. Use 'search' for web results, 'news' for recent journalism/current events, 'images' for visual references, 'videos' for clips/tutorials, 'places' or 'maps' for local businesses/venues, 'reviews' for Google business reviews by place ID/CID/FID or query, 'shopping' for products, 'product-reviews' for product reviews, 'lens' for reverse image search, 'scholar' for scholarly articles, 'patents' for patents, 'autocomplete' for suggestions, and 'webpage' to scrape a URL.",
      }),
    ),
    gl: Type.Optional(
      Type.String({
        description: "Country code hint for Google results (for example 'us').",
      }),
    ),
    hl: Type.Optional(
      Type.String({
        description:
          "Language code hint for Google results (for example 'en').",
      }),
    ),
    location: Type.Optional(
      Type.String({
        description: "Geographic location hint for Google results.",
      }),
    ),
    page: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "1-based results page to request from Serper.",
      }),
    ),
    tbs: Type.Optional(
      Type.String({
        description:
          "Google time/date or vertical-specific filter string passed through to Serper, for example 'qdr:d' for past day.",
      }),
    ),
    autocorrect: Type.Optional(
      Type.Boolean({
        description: "Enable or disable Serper query autocorrection.",
      }),
    ),
    url: Type.Optional(
      Type.String({
        description:
          "URL for modes that need one: image URL for 'lens', or page URL for 'webpage'. Defaults to the query string when omitted.",
      }),
    ),
    ll: Type.Optional(
      Type.String({
        description:
          "Google Maps latitude/longitude/zoom hint, for example '@40.6973709,-74.1444871,11z'.",
      }),
    ),
    placeId: Type.Optional(
      Type.String({ description: "Google place ID for maps or reviews." }),
    ),
    cid: Type.Optional(
      Type.String({ description: "Google CID for maps or reviews." }),
    ),
    fid: Type.Optional(Type.String({ description: "Google FID for reviews." })),
    sortBy: Type.Optional(
      Type.String({ description: "Review sort order for reviews mode." }),
    ),
    topicId: Type.Optional(
      Type.String({ description: "Review topic ID for reviews mode." }),
    ),
    productId: Type.Optional(
      Type.String({
        description:
          "Google product ID for product-reviews mode. Defaults to the query string when omitted.",
      }),
    ),
    nextPageToken: Type.Optional(
      Type.String({
        description: "Pagination token for reviews or product-reviews modes.",
      }),
    ),
    includeMarkdown: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          "Include Markdown content in webpage mode. Defaults to true.",
      }),
    ),
    includeImages: Type.Optional(
      Type.Boolean({ description: "Include image metadata in webpage mode." }),
    ),
    includeLinks: Type.Optional(
      Type.Boolean({ description: "Include link metadata in webpage mode." }),
    ),
    includeVideos: Type.Optional(
      Type.Boolean({ description: "Include video metadata in webpage mode." }),
    ),
  },
  { description: "Serper search options." },
);

const serperImplementation = {
  id: "serper" as const,
  label: "Serper",
  docsUrl: "https://serper.dev/",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return serperSearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Serper {
    return {
      credentials: { api: "SERPER_API_KEY" },
      options: {
        search: {
          includeMarkdown: true,
        },
      },
    };
  },

  getCapabilityStatus(config: Serper | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.credentials?.api);
  },

  async search(
    query: string,
    maxResults: number,
    config: Serper,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const apiKey = resolveConfigValue(config.credentials?.api);
    if (!apiKey) {
      throw new Error("is missing an API key");
    }

    const defaults = asJsonObject(config.options?.search);
    const callOptions = asJsonObject(options);
    const requestOptions = readRequestOptions({
      ...defaults,
      ...callOptions,
    });
    const requestBody = buildRequestBody(
      query,
      clampMaxResults(maxResults),
      requestOptions,
    );

    const response = await fetch(
      joinUrl(resolveConfigValue(config.baseUrl), requestOptions.mode),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: context.signal,
      },
    );

    if (!response.ok) {
      throw new Error(await buildHttpError(response));
    }

    const payload = (await response.json()) as unknown;
    const responseRecord = enrichResponseRecord(
      asRecord(payload) ?? {},
      requestOptions.mode,
      requestBody,
    );
    const results = readPrimaryResults(responseRecord, requestOptions.mode);
    const searchContext = buildSearchContext(
      responseRecord,
      requestOptions.mode,
    );

    return {
      provider: serperImplementation.id,
      results: results
        .map((entry) =>
          toSearchResult(entry, searchContext, requestOptions.mode),
        )
        .filter(
          (result): result is NonNullable<typeof result> => result !== null,
        )
        .slice(0, clampMaxResults(maxResults)),
    };
  },
};

function joinUrl(
  baseUrl: string | undefined,
  mode: SerperSearchMode = "search",
): string {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (mode === "webpage" && base === DEFAULT_BASE_URL) {
    return DEFAULT_SCRAPE_URL;
  }
  return `${base}/${mode}`;
}

function readRequestOptions(
  options: Record<string, unknown>,
): SerperRequestOptions {
  const result: SerperRequestOptions = {
    mode: readSearchMode(options.mode),
    extra: extractExtraMetadata(options, RESERVED_REQUEST_OPTION_KEYS),
  };

  copyStringOption(result, "gl", options.gl);
  copyStringOption(result, "hl", options.hl);
  copyStringOption(result, "location", options.location);
  copyStringOption(result, "tbs", options.tbs);
  copyStringOption(result, "url", options.url);
  copyStringOption(result, "ll", options.ll);
  copyStringOption(result, "placeId", options.placeId);
  copyStringOption(result, "cid", options.cid);
  copyStringOption(result, "fid", options.fid);
  copyStringOption(result, "sortBy", options.sortBy);
  copyStringOption(result, "topicId", options.topicId);
  copyStringOption(result, "productId", options.productId);
  copyStringOption(result, "nextPageToken", options.nextPageToken);
  copyBooleanOption(result, "autocorrect", options.autocorrect);
  copyBooleanOption(result, "includeMarkdown", options.includeMarkdown);
  copyBooleanOption(result, "includeImages", options.includeImages);
  copyBooleanOption(result, "includeLinks", options.includeLinks);
  copyBooleanOption(result, "includeVideos", options.includeVideos);

  const page = readInteger(options.page);
  if (page !== undefined) {
    result.page = Math.max(1, page);
  }

  return result;
}

function buildRequestBody(
  query: string,
  maxResults: number,
  options: SerperRequestOptions,
): Record<string, unknown> {
  const common = omitUndefined({
    location: options.location,
    gl: options.gl,
    hl: options.hl,
  });
  const withExtra = (body: Record<string, unknown>) => ({
    ...body,
    ...options.extra,
  });

  switch (options.mode) {
    case "webpage":
      return withExtra(
        omitUndefined({
          url: options.url ?? query,
          includeMarkdown: options.includeMarkdown ?? true,
          includeImages: options.includeImages,
          includeLinks: options.includeLinks,
          includeVideos: options.includeVideos,
        }),
      );
    case "product-reviews":
      return withExtra(
        omitUndefined({
          productId: options.productId ?? query,
          nextPageToken: options.nextPageToken,
          ...common,
          num: maxResults,
        }),
      );
    case "autocomplete":
      return withExtra({ q: query, ...common });
    case "maps":
      return withExtra(
        omitUndefined({
          q: query,
          num: maxResults,
          ...common,
          ll: options.ll,
          placeId: options.placeId,
          cid: options.cid,
          page: options.page,
        }),
      );
    case "reviews": {
      const hasExplicitPlaceIdentifier =
        firstNonEmptyString(options.cid, options.fid, options.placeId) !==
        undefined;
      return withExtra(
        omitUndefined({
          q: hasExplicitPlaceIdentifier ? undefined : query,
          cid: options.cid,
          fid: options.fid,
          placeId: options.placeId,
          gl: options.gl,
          hl: options.hl,
          sortBy: options.sortBy,
          topicId: options.topicId,
          nextPageToken: options.nextPageToken,
        }),
      );
    }
    case "lens":
      return withExtra(
        omitUndefined({
          url: options.url ?? query,
          ...common,
          tbs: options.tbs,
        }),
      );
    case "scholar":
      return withExtra(
        omitUndefined({
          q: query,
          ...common,
          autocorrect: options.autocorrect,
          tbs: options.tbs,
          page: options.page,
        }),
      );
    default:
      return withExtra(
        omitUndefined({
          q: query,
          num: maxResults,
          ...common,
          autocorrect: options.autocorrect,
          tbs: options.tbs,
          page: options.page,
        }),
      );
  }
}

function enrichResponseRecord(
  response: Record<string, unknown>,
  mode: SerperSearchMode,
  requestBody: Record<string, unknown>,
): Record<string, unknown> {
  if (mode !== "webpage") {
    return response;
  }
  return omitUndefined({
    ...response,
    url: readString(response.url) ?? readString(requestBody.url),
  });
}

function readSearchMode(value: unknown): SerperSearchMode {
  return typeof value === "string" && SERPER_SEARCH_MODE_SET.has(value)
    ? (value as SerperSearchMode)
    : "search";
}

function readPrimaryResults(
  response: Record<string, unknown>,
  mode: SerperSearchMode,
): unknown[] {
  if (mode === "webpage") {
    return [response];
  }

  for (const field of PRIMARY_RESULT_FIELDS_BY_MODE[mode]) {
    const values = asArray(response[field]);
    if (values) {
      return values;
    }
  }
  return [];
}

function clampMaxResults(value: number): number {
  return Math.max(1, Math.min(20, Math.trunc(value || 0)));
}

async function buildHttpError(response: Response): Promise<string> {
  const detail = await readErrorDetail(response);
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  return detail
    ? `Serper API request failed (${status}): ${detail}`
    : `Serper API request failed (${status}).`;
}

async function readErrorDetail(
  response: Response,
): Promise<string | undefined> {
  const text = (await response.text()).trim();
  if (!text) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const record = asRecord(parsed);
    const detail =
      readString(record?.message) ??
      readString(record?.error) ??
      readString(record?.detail);
    if (detail) {
      return detail;
    }
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

function toSearchResult(
  entry: unknown,
  searchContext: Record<string, unknown> | undefined,
  mode: SerperSearchMode,
): SearchResult | null {
  if (typeof entry === "string") {
    return {
      title: entry,
      url: mode === "autocomplete" ? toGoogleSearchUrl(entry) : "",
      snippet: entry,
      metadata: {
        source: mode,
        ...(searchContext ? { searchContext } : {}),
      },
    };
  }

  const record = asRecord(entry);
  if (!record) {
    return null;
  }

  const responseMetadata = asRecord(record.metadata);
  const user = asRecord(record.user);
  const resultUrl =
    firstString(record.link, record.website, record.url, record.imageUrl) ?? "";
  const title =
    firstNonEmptyString(
      record.title,
      responseMetadata?.title,
      record.name,
      record.query,
      record.value,
      user?.name,
      formatReviewTitle(record, user),
      resultUrl,
    ) ?? "Untitled";
  const url =
    resultUrl || (mode === "autocomplete" ? toGoogleSearchUrl(title) : "");
  const snippet = trimSnippet(
    firstNonEmptyString(
      record.snippet,
      record.richSnippet,
      record.markdown,
      record.text,
      record.address,
      record.price,
      record.date,
      record.name,
      record.value,
      record.url,
    ) ?? "",
  );

  const metadata = omitUndefined({
    source: readString(record.source) ?? (mode === "search" ? "organic" : mode),
    position: readNumber(record.position),
    date: readString(record.date),
    attributes: asRecord(record.attributes),
    sitelinks: asArray(record.sitelinks),
    rating: readNumber(record.rating),
    ratingCount: readNumber(record.ratingCount),
    cid: readString(record.cid),
    ...extractExtraMetadata(record, [
      "title",
      "name",
      "query",
      "value",
      "link",
      "website",
      "url",
      "snippet",
    ]),
    ...(searchContext ? { searchContext } : {}),
  });

  return {
    title,
    url,
    snippet,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function buildSearchContext(
  response: Record<string, unknown>,
  mode: SerperSearchMode,
): Record<string, unknown> | undefined {
  const context = omitUndefined({
    searchParameters: asRecord(response.searchParameters),
    searchInformation: asRecord(response.searchInformation),
    credits: readNumber(response.credits),
    answerBox: asRecord(response.answerBox),
    knowledgeGraph: asRecord(response.knowledgeGraph),
  });
  const primaryResultFields = new Set<string>(
    PRIMARY_RESULT_FIELDS_BY_MODE[mode],
  );

  for (const field of CONTEXT_ARRAY_FIELDS) {
    if (primaryResultFields.has(field)) {
      continue;
    }
    const value = asArray(response[field]);
    if (value) {
      context[field] = value;
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

function copyStringOption(
  target: SerperRequestOptions,
  key: keyof Pick<
    SerperRequestOptions,
    | "gl"
    | "hl"
    | "location"
    | "tbs"
    | "url"
    | "ll"
    | "placeId"
    | "cid"
    | "fid"
    | "sortBy"
    | "topicId"
    | "productId"
    | "nextPageToken"
  >,
  value: unknown,
): void {
  const text = readString(value);
  if (text !== undefined) {
    target[key] = text;
  }
}

function copyBooleanOption(
  target: SerperRequestOptions,
  key: keyof Pick<
    SerperRequestOptions,
    | "autocorrect"
    | "includeMarkdown"
    | "includeImages"
    | "includeLinks"
    | "includeVideos"
  >,
  value: unknown,
): void {
  const flag = readBoolean(value);
  if (flag !== undefined) {
    target[key] = flag;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string");
}

function toGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function formatReviewTitle(
  record: Record<string, unknown>,
  user: Record<string, unknown> | undefined,
): string | undefined {
  const userName = readString(user?.name);
  const rating = readNumber(record.rating);
  const date = readString(record.date) ?? readString(record.isoDate);

  if (userName && rating !== undefined) {
    return `${userName} (${rating}-star review)`;
  }
  if (userName) {
    return `${userName}'s review`;
  }
  if (rating !== undefined && date) {
    return `${rating}-star review from ${date}`;
  }
  if (rating !== undefined) {
    return `${rating}-star review`;
  }
  if (date) {
    return `Review from ${date}`;
  }
  return undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function extractExtraMetadata(
  record: Record<string, unknown>,
  ignoredKeys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !ignoredKeys.includes(key) && value !== undefined,
    ),
  );
}

function omitUndefined(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export const serperProvider = defineProvider({
  id: "serper" as const,
  label: serperImplementation.label,
  docsUrl: serperImplementation.docsUrl,
  config: {
    createTemplate: () => serperImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
    optionCapabilities: ["search"],
  },
  getCapabilityStatus: (config, cwd, tool) =>
    (serperImplementation.getCapabilityStatus as any)(
      config as Serper | undefined,
      cwd,
      tool,
    ),
  capabilities: {
    search: defineCapability({
      options: serperImplementation.getToolOptionsSchema?.("search"),
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await serperImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
  },
});
