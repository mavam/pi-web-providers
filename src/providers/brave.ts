import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import type {
  Brave,
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { asJsonObject, formatConfigValueError, trimSnippet } from "./shared.js";

const DEFAULT_BASE_URL = "https://api.search.brave.com";
const BRAVE_API_VERSION: string | undefined = undefined;

const countryOption = Type.Optional(
  Type.String({
    description:
      "Country code used to localize Brave results, for example 'US'.",
  }),
);
const searchLangOption = Type.Optional(
  Type.String({
    description: "Content language for Brave results, for example 'en'.",
  }),
);
const uiLangOption = Type.Optional(
  Type.String({
    description: "UI language for response metadata, for example 'en-US'.",
  }),
);
const freshnessOption = Type.Optional(
  Type.String({
    description:
      "Freshness filter such as 'pd' (24h), 'pw' (7d), 'pm' (31d), 'py' (year), or a Brave date range.",
  }),
);
const safesearchOption = Type.Optional(
  Type.Enum({ off: "off", moderate: "moderate", strict: "strict" } as const, {
    description: "Safe-search filtering level.",
  }),
);
const spellcheckOption = Type.Optional(
  Type.Boolean({ description: "Whether Brave may spellcheck the query." }),
);
const countOption = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: 50,
    description:
      "Mode-specific result count override. Prefer top-level maxResults unless Brave-specific pagination is needed.",
  }),
);
const offsetOption = Type.Optional(
  Type.Integer({
    minimum: 0,
    description: "Brave result page offset for paginated requests.",
  }),
);
const gogglesOption = Type.Optional(
  Type.String({ description: "Brave Goggles URL or inline definition." }),
);
const extraSnippetsOption = Type.Optional(
  Type.Boolean({ description: "Whether to ask Brave for extra snippets." }),
);

const braveSearchOptionsSchema = Type.Object(
  {
    mode: Type.Optional(
      Type.Enum(
        {
          web: "web",
          llm_context: "llm_context",
          news: "news",
          videos: "videos",
          images: "images",
          places: "places",
        } as const,
        {
          description:
            "Brave search mode. Use 'news' for recent journalism or current events, 'videos' for clips/tutorials, 'images' for visual references, 'places' for local businesses, venues, cafes, restaurants, hotels, shops, or near/in-location searches, and 'llm_context' for retrieval context.",
        },
      ),
    ),
    common: Type.Optional(
      Type.Object(
        {
          country: countryOption,
          search_lang: searchLangOption,
          ui_lang: uiLangOption,
        },
        {
          description:
            "Common Brave query options merged into the selected mode's options.",
        },
      ),
    ),
    web: Type.Optional(
      Type.Object(
        {
          country: countryOption,
          search_lang: searchLangOption,
          ui_lang: uiLangOption,
          freshness: freshnessOption,
          safesearch: safesearchOption,
          spellcheck: spellcheckOption,
          goggles: gogglesOption,
          extra_snippets: extraSnippetsOption,
          offset: offsetOption,
          enable_rich_callback: Type.Optional(
            Type.Boolean({
              description: "Whether to enable Brave rich callback metadata.",
            }),
          ),
        },
        { description: "Options for Brave Web Search mode." },
      ),
    ),
    llmContext: Type.Optional(
      Type.Object(
        {
          count: countOption,
          maximum_number_of_urls: Type.Optional(
            Type.Integer({ minimum: 1, description: "Maximum source URLs." }),
          ),
          maximum_number_of_tokens: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Maximum context tokens.",
            }),
          ),
          maximum_number_of_snippets: Type.Optional(
            Type.Integer({ minimum: 1, description: "Maximum snippets." }),
          ),
          maximum_number_of_tokens_per_url: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Maximum context tokens per URL.",
            }),
          ),
          maximum_number_of_snippets_per_url: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "Maximum snippets per URL.",
            }),
          ),
          context_threshold_mode: Type.Optional(
            Type.String({ description: "Brave LLM Context threshold mode." }),
          ),
          enable_local: Type.Optional(
            Type.Boolean({ description: "Whether to include local results." }),
          ),
          enable_source_metadata: Type.Optional(
            Type.Boolean({
              description: "Whether to include source metadata in grounding.",
            }),
          ),
          country: countryOption,
          search_lang: searchLangOption,
          ui_lang: uiLangOption,
          freshness: freshnessOption,
          safesearch: safesearchOption,
          spellcheck: spellcheckOption,
          goggles: gogglesOption,
        },
        { description: "Options for Brave LLM Context mode." },
      ),
    ),
    news: Type.Optional(
      Type.Object(
        {
          country: countryOption,
          search_lang: searchLangOption,
          ui_lang: uiLangOption,
          freshness: freshnessOption,
          safesearch: safesearchOption,
          spellcheck: spellcheckOption,
          goggles: gogglesOption,
          extra_snippets: extraSnippetsOption,
          offset: offsetOption,
          count: countOption,
        },
        { description: "Options for Brave News Search mode." },
      ),
    ),
    videos: Type.Optional(
      Type.Object(
        {
          country: countryOption,
          search_lang: searchLangOption,
          ui_lang: uiLangOption,
          freshness: freshnessOption,
          safesearch: safesearchOption,
          spellcheck: spellcheckOption,
          offset: offsetOption,
          count: countOption,
        },
        { description: "Options for Brave Video Search mode." },
      ),
    ),
    images: Type.Optional(
      Type.Object(
        {
          country: countryOption,
          search_lang: searchLangOption,
          ui_lang: uiLangOption,
          safesearch: safesearchOption,
          spellcheck: spellcheckOption,
          count: countOption,
        },
        { description: "Options for Brave Image Search mode." },
      ),
    ),
    places: Type.Optional(
      Type.Object(
        {
          country: countryOption,
          search_lang: searchLangOption,
          ui_lang: uiLangOption,
          latitude: Type.Optional(
            Type.Number({ description: "Latitude for local place search." }),
          ),
          longitude: Type.Optional(
            Type.Number({ description: "Longitude for local place search." }),
          ),
          location: Type.Optional(
            Type.String({
              description:
                "Human-readable local search location, e.g. 'Eppendorf, Hamburg, Germany'. Use with mode='places' for neighborhood or near-me style searches.",
            }),
          ),
          radius: Type.Optional(
            Type.Number({ description: "Local search radius." }),
          ),
          units: Type.Optional(
            Type.String({ description: "Distance units for local search." }),
          ),
          safesearch: safesearchOption,
          spellcheck: spellcheckOption,
          geoloc: Type.Optional(
            Type.String({
              description: "Optional geolocation token used to refine results.",
            }),
          ),
          count: countOption,
          includeDetails: Type.Optional(
            Type.Boolean({
              description:
                "Places mode only. Fetch detailed POI metadata when the task needs contact info, opening hours, ratings/review counts, photos, profiles, or richer address/distance data. Leave off for simple place listings to avoid extra latency and quota usage.",
            }),
          ),
          includeDescriptions: Type.Optional(
            Type.Boolean({
              description:
                "Places mode only. Fetch AI-generated POI descriptions when the task needs qualitative summaries or short explanations of places. Leave off for simple nearby/place listing queries to avoid extra latency and quota usage.",
            }),
          ),
        },
        { description: "Options for Brave Local Place Search mode." },
      ),
    ),
  },
  { description: "Brave search options." },
);

const braveSearchPromptGuidelines = [
  "Use Brave places mode for local businesses, venues, restaurants, hotels, shops, landmarks, or other points of interest.",
  "In Brave places mode, set places.includeDetails when the task needs POI attributes beyond the basic result list, such as contact info, opening hours, ratings/review counts, photos, profiles, or richer address/distance metadata.",
  "In Brave places mode, set places.includeDescriptions when the task needs qualitative summaries or short explanations of places. Leave it off for simple nearby/place listing queries to avoid extra latency and quota usage.",
] as const;

const braveAnswerOptionsSchema = Type.Object(
  {
    country: Type.Optional(Type.String()),
    language: Type.Optional(Type.String()),
    enable_citations: Type.Optional(Type.Boolean()),
    enable_entities: Type.Optional(Type.Boolean()),
    max_completion_tokens: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { description: "Brave answer options." },
);

const braveResearchOptionsSchema = Type.Object(
  {
    country: Type.Optional(Type.String()),
    language: Type.Optional(Type.String()),
    enable_entities: Type.Optional(Type.Boolean()),
    enable_citations: Type.Optional(
      Type.Boolean({
        description:
          "Accepted for compatibility but forced to false for Brave research mode.",
      }),
    ),
    max_completion_tokens: Type.Optional(Type.Integer({ minimum: 1 })),
    research_allow_thinking: Type.Optional(Type.Boolean()),
    research_maximum_number_of_tokens_per_query: Type.Optional(
      Type.Integer({ minimum: 1 }),
    ),
    research_maximum_number_of_queries: Type.Optional(
      Type.Integer({ minimum: 1 }),
    ),
    research_maximum_number_of_iterations: Type.Optional(
      Type.Integer({ minimum: 1 }),
    ),
    research_maximum_number_of_seconds: Type.Optional(
      Type.Integer({ minimum: 1 }),
    ),
    research_maximum_number_of_results_per_query: Type.Optional(
      Type.Integer({ minimum: 1 }),
    ),
  },
  { description: "Brave research options." },
);

const braveImplementation = {
  id: "brave" as const,
  label: "Brave",
  docsUrl: "https://api-dashboard.search.brave.com/app/documentation",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return braveSearchOptionsSchema;
      case "answer":
        return braveAnswerOptionsSchema;
      case "research":
        return braveResearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Brave {
    return {
      credentials: {
        search: "BRAVE_SEARCH_API_KEY",
        answers: "BRAVE_ANSWERS_API_KEY",
      },
      options: {},
    };
  },

  getCapabilityStatus(
    config: Brave | undefined,
    _cwd: string,
    tool?: Tool,
  ): ProviderCapabilityStatus {
    const key =
      tool === "answer" || tool === "research"
        ? config?.credentials?.answers
        : config?.credentials?.search;
    try {
      if (tool)
        return resolveConfigValue(key)
          ? { state: "ready" }
          : { state: "missing_api_key" };
      return [
        config?.credentials?.search,
        config?.credentials?.answers,
        config?.credentials?.autosuggest,
      ].some((v) => resolveConfigValue(v))
        ? { state: "ready" }
        : { state: "missing_api_key" };
    } catch (error) {
      return { state: "invalid_config", detail: formatConfigValueError(error) };
    }
  },

  async search(
    query: string,
    maxResults: number,
    config: Brave,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const apiKey = requireKey(config.credentials?.search, "Brave search");
    const defaults = asJsonObject(
      config.options?.search as Record<string, unknown> | undefined,
    );
    const callOptions = { ...defaults, ...(options ?? {}) };
    const mode = readMode(callOptions.mode);
    if (mode === "llm_context")
      return await llmContext(
        query,
        maxResults,
        config,
        context,
        apiKey,
        callOptions,
      );
    if (mode === "news")
      return await news(
        query,
        maxResults,
        config,
        context,
        apiKey,
        callOptions,
      );
    if (mode === "videos")
      return await videos(
        query,
        maxResults,
        config,
        context,
        apiKey,
        callOptions,
      );
    if (mode === "images")
      return await images(
        query,
        maxResults,
        config,
        context,
        apiKey,
        callOptions,
      );
    if (mode === "places")
      return await places(
        query,
        maxResults,
        config,
        context,
        apiKey,
        callOptions,
      );
    return await web(query, maxResults, config, context, apiKey, callOptions);
  },

  async answer(
    query: string,
    config: Brave,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const raw = {
      ...asJsonObject(
        config.options?.answer as Record<string, unknown> | undefined,
      ),
      ...(options ?? {}),
    };
    return await completion(query, config, context, buildAnswerRequest(raw));
  },

  async research(
    input: string,
    config: Brave,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const raw = {
      ...asJsonObject(
        config.options?.research as Record<string, unknown> | undefined,
      ),
      ...(options ?? {}),
    };
    return await completion(input, config, context, buildResearchRequest(raw));
  },
};

function requireKey(ref: string | undefined, label: string): string {
  const key = resolveConfigValue(ref);
  if (!key) throw new Error(`${label} is missing an API key`);
  return key;
}
function base(config: Brave): string {
  return (resolveConfigValue(config.baseUrl) ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}
function clamp(n: number, max = 20): number {
  return Math.max(1, Math.min(max, Math.trunc(n || 0)));
}
function readMode(
  v: unknown,
): "web" | "llm_context" | "news" | "videos" | "images" | "places" {
  return v === "llm_context" ||
    v === "news" ||
    v === "videos" ||
    v === "images" ||
    v === "places"
    ? v
    : "web";
}
function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function pick(
  source: Record<string, unknown>,
  allowed: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    allowed.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
  );
}
function mergeOptions(
  options: Record<string, unknown>,
  key: string,
  allowed: string[],
) {
  return pick({ ...obj(options.common), ...obj(options[key]) }, allowed);
}
function headers(key: string, json = false): Record<string, string> {
  const result: Record<string, string> = { "X-Subscription-Token": key };
  if (BRAVE_API_VERSION) {
    result["Api-Version"] = BRAVE_API_VERSION;
  }
  if (json) {
    result["content-type"] = "application/json";
  }
  return result;
}
function url(config: Brave, path: string, params: Record<string, unknown>) {
  const u = new URL(`${base(config)}${path}`);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined)
      u.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
  return u;
}
async function httpError(response: Response) {
  const text = (await response.text()).trim();
  return `Brave API request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})${text ? `: ${text}` : "."}`;
}

async function web(
  query: string,
  maxResults: number,
  config: Brave,
  context: ProviderContext,
  key: string,
  options: Record<string, unknown>,
): Promise<SearchResponse> {
  const params = {
    q: query,
    count: clamp(maxResults),
    text_decorations: false,
    ...mergeOptions(options, "web", [
      "country",
      "search_lang",
      "ui_lang",
      "freshness",
      "safesearch",
      "spellcheck",
      "goggles",
      "extra_snippets",
      "offset",
      "enable_rich_callback",
    ]),
  };
  const r = await fetch(url(config, "/res/v1/web/search", params), {
    headers: headers(key),
    signal: context.signal,
  });
  if (!r.ok) throw new Error(await httpError(r));
  const p = obj(await r.json());
  return {
    provider: "brave",
    results: arr(obj(p.web).results)
      .map((e) => {
        const x = obj(e);
        const u = str(x.url) ?? "";
        return {
          title: str(x.title) || u || "Untitled",
          url: u,
          snippet: trimSnippet(
            str(x.description) ?? arr(x.extra_snippets).join(" "),
          ),
          metadata: x,
        };
      })
      .slice(0, clamp(maxResults)),
  };
}
async function llmContext(
  query: string,
  maxResults: number,
  config: Brave,
  context: ProviderContext,
  key: string,
  options: Record<string, unknown>,
): Promise<SearchResponse> {
  const params = {
    q: query,
    count: clamp(maxResults),
    maximum_number_of_urls: clamp(maxResults),
    maximum_number_of_tokens: 8192,
    enable_source_metadata: true,
    ...mergeOptions(options, "llmContext", [
      "count",
      "maximum_number_of_urls",
      "maximum_number_of_tokens",
      "maximum_number_of_snippets",
      "maximum_number_of_tokens_per_url",
      "maximum_number_of_snippets_per_url",
      "context_threshold_mode",
      "enable_local",
      "enable_source_metadata",
      "country",
      "search_lang",
      "ui_lang",
      "freshness",
      "safesearch",
      "spellcheck",
      "goggles",
    ]),
  };
  const r = await fetch(url(config, "/res/v1/llm/context", params), {
    headers: headers(key),
    signal: context.signal,
  });
  if (!r.ok) throw new Error(await httpError(r));
  const p = obj(await r.json());
  return {
    provider: "brave",
    results: arr(obj(p.grounding).generic)
      .map((e) => {
        const x = obj(e);
        const snippets = arr(x.snippets).map(String);
        const u = str(x.url) ?? str(obj(x.source).url) ?? "";
        return {
          title: str(x.title) ?? str(obj(x.source).title) ?? (u || "Untitled"),
          url: u,
          snippet: trimSnippet(snippets.join("\n\n"), 1200),
          metadata: x,
        };
      })
      .slice(0, clamp(maxResults)),
  };
}
async function news(
  query: string,
  maxResults: number,
  config: Brave,
  context: ProviderContext,
  key: string,
  options: Record<string, unknown>,
): Promise<SearchResponse> {
  const params = {
    q: query,
    count: clamp(maxResults, 50),
    ...mergeOptions(options, "news", [
      "country",
      "search_lang",
      "ui_lang",
      "freshness",
      "safesearch",
      "spellcheck",
      "goggles",
      "extra_snippets",
      "offset",
      "count",
    ]),
  };
  const r = await fetch(url(config, "/res/v1/news/search", params), {
    headers: headers(key),
    signal: context.signal,
  });
  if (!r.ok) throw new Error(await httpError(r));
  const p = obj(await r.json());
  return {
    provider: "brave",
    results: arr(p.results)
      .map((e) => {
        const x = obj(e);
        const u = str(x.url) ?? "";
        const source = str(x.source) ?? str(x.source_name);
        return {
          title: str(x.title) || u || "Untitled",
          url: u,
          snippet: trimSnippet(
            [
              str(x.description) ?? arr(x.extra_snippets).join(" "),
              source,
              str(x.age) ?? str(x.page_age),
            ]
              .filter(Boolean)
              .join(" — "),
          ),
          metadata: x,
        };
      })
      .slice(0, clamp(maxResults, 50)),
  };
}

async function videos(
  query: string,
  maxResults: number,
  config: Brave,
  context: ProviderContext,
  key: string,
  options: Record<string, unknown>,
): Promise<SearchResponse> {
  const params = {
    q: query,
    count: clamp(maxResults, 50),
    ...mergeOptions(options, "videos", [
      "country",
      "search_lang",
      "ui_lang",
      "freshness",
      "safesearch",
      "spellcheck",
      "offset",
      "count",
    ]),
  };
  const r = await fetch(url(config, "/res/v1/videos/search", params), {
    headers: headers(key),
    signal: context.signal,
  });
  if (!r.ok) throw new Error(await httpError(r));
  const p = obj(await r.json());
  return {
    provider: "brave",
    results: arr(p.results)
      .map((e) => {
        const x = obj(e);
        const u = str(x.url) ?? "";
        const video = obj(x.video);
        return {
          title: str(x.title) || u || "Untitled",
          url: u,
          snippet: trimSnippet(
            [
              str(x.description),
              str(video.creator) ?? str(x.creator),
              str(video.duration) ?? str(x.duration),
              num(video.views) ? `${num(video.views)} views` : undefined,
              str(x.age) ?? str(x.page_age),
            ]
              .filter(Boolean)
              .join(" — "),
          ),
          metadata: x,
        };
      })
      .slice(0, clamp(maxResults, 50)),
  };
}

async function images(
  query: string,
  maxResults: number,
  config: Brave,
  context: ProviderContext,
  key: string,
  options: Record<string, unknown>,
): Promise<SearchResponse> {
  const params = {
    q: query,
    count: clamp(maxResults),
    ...mergeOptions(options, "images", [
      "country",
      "search_lang",
      "ui_lang",
      "safesearch",
      "spellcheck",
      "count",
    ]),
  };
  const r = await fetch(url(config, "/res/v1/images/search", params), {
    headers: headers(key),
    signal: context.signal,
  });
  if (!r.ok) throw new Error(await httpError(r));
  const p = obj(await r.json());
  return {
    provider: "brave",
    results: arr(p.results)
      .map((e) => {
        const x = obj(e);
        const props = obj(x.properties);
        const page = str(x.url) ?? str(x.source) ?? str(props.url) ?? "";
        const image = str(props.url);
        return {
          title: str(x.title) || page || "Untitled",
          url: page || image || "",
          snippet: trimSnippet(
            [str(x.description), str(x.publisher), image]
              .filter(Boolean)
              .join(" — "),
          ),
          metadata: x,
        };
      })
      .slice(0, clamp(maxResults)),
  };
}
async function places(
  query: string,
  maxResults: number,
  config: Brave,
  context: ProviderContext,
  key: string,
  options: Record<string, unknown>,
): Promise<SearchResponse> {
  const placeOptions = obj(options.places);
  const params = {
    q: query,
    count: clamp(maxResults),
    ...mergeOptions(options, "places", [
      "country",
      "search_lang",
      "ui_lang",
      "latitude",
      "longitude",
      "location",
      "radius",
      "units",
      "safesearch",
      "spellcheck",
      "geoloc",
      "count",
    ]),
  };
  const r = await fetch(url(config, "/res/v1/local/place_search", params), {
    headers: headers(key),
    signal: context.signal,
  });
  if (!r.ok) throw new Error(await httpError(r));
  const p = obj(await r.json());
  const rows = arr(p.results).slice(0, clamp(maxResults));
  const ids = rows.map((e) => str(obj(e).id)).filter((id) => id !== undefined);
  const [detailsById, descriptionsById] = await Promise.all([
    placeOptions.includeDetails && ids.length > 0
      ? fetchPlaceDetails(
          config,
          context,
          key,
          ids,
          pick(params, ["search_lang", "ui_lang", "units"]),
        )
      : Promise.resolve(new Map<string, Record<string, unknown>>()),
    placeOptions.includeDescriptions && ids.length > 0
      ? fetchPlaceDescriptions(config, context, key, ids)
      : Promise.resolve(new Map<string, Record<string, unknown>>()),
  ]);
  return {
    provider: "brave",
    results: rows.map((e) => {
      const x = obj(e);
      const id = str(x.id);
      const details = id ? detailsById.get(id) : undefined;
      const description = id ? descriptionsById.get(id) : undefined;
      const u = str(x.url) ?? str(x.provider_url) ?? "";
      return {
        title: str(x.title) || u || "Untitled",
        url: u,
        snippet: trimSnippet(
          [
            placeDescriptionText(description) ?? str(x.description),
            placeAddress(x, details),
            arr(x.categories).join(", "),
            placeRating(x, details),
          ]
            .filter(Boolean)
            .join(" — "),
        ),
        metadata: {
          ...x,
          ...(details ? { poiDetails: details } : {}),
          ...(description ? { poiDescription: description } : {}),
        },
      };
    }),
  };
}

async function fetchPlaceDetails(
  config: Brave,
  context: ProviderContext,
  key: string,
  ids: string[],
  options: Record<string, unknown>,
): Promise<Map<string, Record<string, unknown>>> {
  const r = await fetch(
    urlWithRepeatedArrays(config, "/res/v1/local/pois", {
      ids: ids.slice(0, 20),
      ...options,
    }),
    {
      headers: headers(key),
      signal: context.signal,
    },
  );
  if (!r.ok) throw new Error(await httpError(r));
  return indexById(arr(obj(await r.json()).results));
}

async function fetchPlaceDescriptions(
  config: Brave,
  context: ProviderContext,
  key: string,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const r = await fetch(
    urlWithRepeatedArrays(config, "/res/v1/local/descriptions", {
      ids: ids.slice(0, 20),
    }),
    {
      headers: headers(key),
      signal: context.signal,
    },
  );
  if (!r.ok) throw new Error(await httpError(r));
  return indexById(arr(obj(await r.json()).results));
}

function urlWithRepeatedArrays(
  config: Brave,
  path: string,
  params: Record<string, unknown>,
): URL {
  const u = new URL(`${base(config)}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        u.searchParams.append(k, String(item));
      }
    } else {
      u.searchParams.set(k, String(v));
    }
  }
  return u;
}

function indexById(values: unknown[]): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const value of values) {
    const entry = obj(value);
    const id = str(entry.id);
    if (id) {
      result.set(id, entry);
    }
  }
  return result;
}

function placeDescriptionText(
  description: Record<string, unknown> | undefined,
): string | undefined {
  if (!description) return undefined;
  return (
    str(description.description) ??
    str(description.text) ??
    str(description.summary) ??
    str(obj(description.description).text)
  );
}

function placeAddress(
  place: Record<string, unknown>,
  details: Record<string, unknown> | undefined,
): string | undefined {
  return (
    str(place.address) ??
    str(obj(place.postal_address).displayAddress) ??
    str(details?.address) ??
    str(obj(details?.postal_address).displayAddress)
  );
}

function placeRating(
  place: Record<string, unknown>,
  details: Record<string, unknown> | undefined,
): string | undefined {
  const rating =
    num(place.rating) ??
    num(obj(place.rating).ratingValue) ??
    num(details?.rating) ??
    num(obj(details?.rating).ratingValue);
  return rating === undefined ? undefined : `Rating: ${rating}`;
}

function buildAnswerRequest(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const webSearchOptions = pick(raw, [
    "country",
    "language",
    "safesearch",
    "enable_entities",
    "enable_citations",
  ]);
  if (webSearchOptions.enable_citations === undefined) {
    webSearchOptions.enable_citations = true;
  }
  const stream =
    webSearchOptions.enable_citations === true ||
    webSearchOptions.enable_entities === true;
  return {
    stream,
    ...pick(raw, ["max_completion_tokens", "metadata", "seed"]),
    web_search_options: webSearchOptions,
  };
}

function buildResearchRequest(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const webSearchOptions = {
    ...pick(raw, [
      "country",
      "language",
      "safesearch",
      "enable_entities",
      "research_allow_thinking",
      "research_maximum_number_of_tokens_per_query",
      "research_maximum_number_of_queries",
      "research_maximum_number_of_iterations",
      "research_maximum_number_of_seconds",
      "research_maximum_number_of_results_per_query",
    ]),
    enable_research: true,
    enable_citations: false,
  };
  return {
    stream: true,
    ...pick(raw, ["max_completion_tokens", "metadata", "seed"]),
    web_search_options: webSearchOptions,
  };
}

async function completion(
  input: string,
  config: Brave,
  context: ProviderContext,
  request: Record<string, unknown>,
): Promise<ToolOutput> {
  const key = requireKey(config.credentials?.answers, "Brave Answers");
  const body: Record<string, unknown> = {
    model: "brave",
    messages: [{ role: "user", content: input }],
    ...request,
  };
  const r = await fetch(`${base(config)}/res/v1/chat/completions`, {
    method: "POST",
    headers: headers(key, true),
    body: JSON.stringify(body),
    signal: context.signal,
  });
  if (!r.ok) throw new Error(await httpError(r));

  const text = await r.text();
  const parsed =
    body.stream === false ? parseAnswerJson(text) : parseAnswerStream(text);
  const lines = [parsed.answer.trim() || text.trim()];
  if (parsed.citations.length) {
    lines.push("", "Sources:");
    parsed.citations.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.title ?? c.url ?? "Source"}`);
      if (c.url) lines.push(`   ${c.url}`);
    });
  }
  return {
    provider: "brave",
    text: lines.join("\n").trimEnd(),
    itemCount: parsed.citations.length,
    metadata: parsed.usage ? { usage: parsed.usage } : undefined,
  };
}
function parseAnswerJson(text: string): {
  answer: string;
  citations: Array<{ title?: string; url?: string }>;
  usage?: unknown;
} {
  const payload = obj(JSON.parse(text));
  const choice = obj(arr(payload.choices)[0]);
  const message = obj(choice.message);
  const content = str(message.content) ?? "";
  const tags = extractBraveTags(content);
  return {
    answer: tags.text,
    citations: dedupeCitations(tags.citations),
    usage: payload.usage ?? tags.usage,
  };
}

function parseAnswerStream(text: string): {
  answer: string;
  citations: Array<{ title?: string; url?: string }>;
  usage?: unknown;
} {
  let rawAnswer = "";
  for (const line of text.split(/\r?\n/)) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = obj(JSON.parse(data));
      const choice = obj(arr(parsed.choices)[0]);
      const delta = str(obj(choice.delta).content);
      if (delta) {
        rawAnswer += delta;
      }
    } catch {
      rawAnswer += data;
    }
  }
  const tags = extractBraveTags(rawAnswer);
  return {
    answer: tags.text,
    citations: dedupeCitations(tags.citations),
    usage: tags.usage,
  };
}

function extractBraveTags(text: string): {
  text: string;
  citations: Array<{ title?: string; url?: string }>;
  usage?: unknown;
} {
  const citations: Array<{ title?: string; url?: string }> = [];
  let usage: unknown;
  let cleaned = "";
  let offset = 0;

  while (offset < text.length) {
    const tagStart = text.indexOf("<", offset);
    if (tagStart === -1) {
      cleaned += text.slice(offset);
      break;
    }

    const parsedTag = readBraveTagStart(text, tagStart);
    if (!parsedTag) {
      cleaned += text.slice(offset, tagStart + 1);
      offset = tagStart + 1;
      continue;
    }

    const jsonEnd = findJsonValueEnd(text, parsedTag.jsonStart);
    if (jsonEnd === -1) {
      cleaned += text.slice(offset);
      break;
    }

    cleaned += text.slice(offset, tagStart);
    const json = text.slice(parsedTag.jsonStart, jsonEnd + 1);
    try {
      const parsed = JSON.parse(json);
      if (parsedTag.tag === "answer") {
        cleaned += str(parsed.answer) ?? str(parsed.text) ?? "";
      } else if (parsedTag.tag === "citation") {
        citations.push({
          title: str(parsed.title),
          url: str(parsed.url),
        });
      } else if (parsedTag.tag === "usage") {
        usage = parsed;
      }
    } catch {}

    const closing = `</${parsedTag.tag}>`;
    const abbreviatedClosing = `</${parsedTag.tag}`;
    if (text.startsWith(closing, jsonEnd + 1)) {
      offset = jsonEnd + 1 + closing.length;
    } else if (text.startsWith(abbreviatedClosing, jsonEnd + 1)) {
      offset = jsonEnd + 1 + abbreviatedClosing.length;
    } else {
      offset = jsonEnd + 1;
    }
  }

  return { text: cleaned, citations, usage };
}

const BRAVE_STRUCTURED_TAGS = new Set([
  "analyzing",
  "answer",
  "blindspots",
  "citation",
  "enum_item",
  "progress",
  "queries",
  "thinking",
  "usage",
]);

function readBraveTagStart(
  text: string,
  tagStart: number,
): { tag: string; jsonStart: number } | undefined {
  const match = /^<([A-Za-z_][A-Za-z0-9_-]*)(>)?[{[]/.exec(
    text.slice(tagStart),
  );
  if (!match) return undefined;
  const tag = match[1];
  if (!BRAVE_STRUCTURED_TAGS.has(tag)) return undefined;
  return {
    tag,
    jsonStart: tagStart + match[0].length - 1,
  };
}

function findJsonValueEnd(text: string, start: number): number {
  const first = text[start];
  const closing = first === "{" ? "}" : first === "[" ? "]" : undefined;
  if (!closing) return -1;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") {
      stack.push("}");
    } else if (char === "[") {
      stack.push("]");
    } else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }

  return -1;
}

function dedupeCitations(
  citations: Array<{ title?: string; url?: string }>,
): Array<{ title?: string; url?: string }> {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.url ?? citation.title;
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const braveProvider = defineProvider({
  id: "brave" as const,
  label: braveImplementation.label,
  docsUrl: braveImplementation.docsUrl,
  config: {
    createTemplate: () => braveImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
    credentials: {
      search: "BRAVE_SEARCH_API_KEY",
      answers: "BRAVE_ANSWERS_API_KEY",
      autosuggest: "BRAVE_AUTOSUGGEST_API_KEY",
    },
    optionCapabilities: ["search", "answer", "research"],
  },
  getCapabilityStatus: (config, cwd, tool) =>
    braveImplementation.getCapabilityStatus(
      config as Brave | undefined,
      cwd,
      tool,
    ),
  capabilities: {
    search: defineCapability({
      options: braveImplementation.getToolOptionsSchema("search"),
      promptGuidelines: braveSearchPromptGuidelines,
      async execute(input: any, ctx) {
        return await braveImplementation.search(
          input.query,
          input.maxResults,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    answer: defineCapability({
      options: braveImplementation.getToolOptionsSchema("answer"),
      async execute(input: any, ctx) {
        return await braveImplementation.answer(
          input.query,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    research: defineCapability({
      options: braveImplementation.getToolOptionsSchema("research"),
      async execute(input: any, ctx) {
        return await braveImplementation.research(
          input.input,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
