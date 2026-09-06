import { httpError } from "../../errors.js";
import type {
  ProviderContext,
  SearchResponse,
  SearchResult,
} from "../contract.js";
import type { Serper, SerperSearchMode } from "./types.js";
import { SERPER_SEARCH_MODE_VALUES } from "./types.js";
import { asJsonObject, trimSnippet } from "../shared.js";

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

const serperImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Serper,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const apiKey = config.credentials?.api;
    if (!apiKey) {
      throw new Error("is missing an API key");
    }

    const callOptions = asJsonObject(options);
    const requestOptions = readRequestOptions({
      ...callOptions,
    });
    const requestBody = buildRequestBody(
      query,
      clampMaxResults(maxResults),
      requestOptions,
    );

    const response = await fetch(joinUrl(config.baseUrl, requestOptions.mode), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: context.signal,
    });

    if (!response.ok) {
      throw httpError(response, await buildHttpError(response));
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
      provider: "serper",
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

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Serper,
    context: ProviderContext,
  ) {
    return await serperImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
};
