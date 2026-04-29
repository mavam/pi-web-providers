import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type {
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  Serper,
  Tool,
} from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { asJsonObject, getApiKeyStatus, trimSnippet } from "./shared.js";

const DEFAULT_BASE_URL = "https://google.serper.dev";

const serperSearchOptionsSchema = Type.Object(
  {
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
    autocorrect: Type.Optional(
      Type.Boolean({
        description: "Enable or disable Serper query autocorrection.",
      }),
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
      options: {},
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

    const defaults = asJsonObject(config.options?.search) ?? {};
    const callOptions = asJsonObject(options);
    const {
      q: _ignoredQuery,
      num: _ignoredNum,
      ...providerOptions
    } = {
      ...defaults,
      ...(callOptions ?? {}),
    };

    const response = await fetch(joinUrl(resolveConfigValue(config.baseUrl)), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        q: query,
        num: clampMaxResults(maxResults),
        ...providerOptions,
      }),
      signal: context.signal,
    });

    if (!response.ok) {
      throw new Error(await buildHttpError(response));
    }

    const payload = (await response.json()) as unknown;
    const responseRecord = asRecord(payload) ?? {};
    const organic = asArray(responseRecord.organic) ?? [];
    const searchContext = buildSearchContext(responseRecord);

    return {
      provider: serperImplementation.id,
      results: organic
        .map((entry) => toSearchResult(entry, searchContext))
        .filter(
          (result): result is NonNullable<typeof result> => result !== null,
        )
        .slice(0, clampMaxResults(maxResults)),
    };
  },
};

function joinUrl(baseUrl: string | undefined): string {
  const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  return `${base}/search`;
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
) {
  const record = asRecord(entry);
  if (!record) {
    return null;
  }

  const url = readString(record.link) ?? "";
  const title = readString(record.title) || url || "Untitled";
  const snippet = trimSnippet(
    readString(record.snippet) ??
      readString(record.richSnippet) ??
      readString(record.date) ??
      "",
  );

  const metadata = omitUndefined({
    source: "organic",
    position: readNumber(record.position),
    date: readString(record.date),
    attributes: asRecord(record.attributes),
    sitelinks: asArray(record.sitelinks),
    rating: readNumber(record.rating),
    ratingCount: readNumber(record.ratingCount),
    cid: readString(record.cid),
    ...extractExtraMetadata(record, ["title", "link", "snippet"]),
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
): Record<string, unknown> | undefined {
  const context = omitUndefined({
    searchParameters: asRecord(response.searchParameters),
    searchInformation: asRecord(response.searchInformation),
    credits: readNumber(response.credits),
    answerBox: asRecord(response.answerBox),
    knowledgeGraph: asRecord(response.knowledgeGraph),
    peopleAlsoAsk: asArray(response.peopleAlsoAsk),
    relatedSearches: asArray(response.relatedSearches),
    topStories: asArray(response.topStories),
    news: asArray(response.news),
    images: asArray(response.images),
    videos: asArray(response.videos),
    places: asArray(response.places),
  });

  return Object.keys(context).length > 0 ? context : undefined;
}

function extractExtraMetadata(
  record: Record<string, unknown>,
  ignoredKeys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !ignoredKeys.includes(key) && value !== undefined,
    ),
  );
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
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
