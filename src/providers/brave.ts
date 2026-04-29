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
import { literalUnion } from "./schema.js";
import { asJsonObject, formatConfigValueError, trimSnippet } from "./shared.js";

const DEFAULT_BASE_URL = "https://api.search.brave.com";
const BRAVE_API_VERSION: string | undefined = undefined;

const braveSearchOptionsSchema = Type.Object(
  {
    mode: Type.Optional(
      literalUnion(["web", "llm_context", "images", "places"], {
        description: "Brave search mode.",
      }),
    ),
    common: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    web: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    llmContext: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    images: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    places: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { description: "Brave search options." },
);

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
    max_completion_tokens: Type.Optional(Type.Integer({ minimum: 1 })),
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
    return await completion(query, config, context, {
      ...asJsonObject(
        config.options?.answer as Record<string, unknown> | undefined,
      ),
      ...(options ?? {}),
      enable_citations: options?.enable_citations ?? true,
      stream: true,
    });
  },

  async research(
    input: string,
    config: Brave,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await completion(input, config, context, {
      ...asJsonObject(
        config.options?.research as Record<string, unknown> | undefined,
      ),
      ...(options ?? {}),
      enable_research: true,
      enable_citations: false,
      stream: true,
    });
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
function readMode(v: unknown): "web" | "llm_context" | "images" | "places" {
  return v === "llm_context" || v === "images" || v === "places" ? v : "web";
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
  return {
    provider: "brave",
    results: rows.map((e) => {
      const x = obj(e);
      const u = str(x.url) ?? str(x.provider_url) ?? "";
      return {
        title: str(x.title) || u || "Untitled",
        url: u,
        snippet: trimSnippet(
          [
            str(x.description),
            str(x.address),
            arr(x.categories).join(", "),
            num(x.rating) ? `Rating: ${num(x.rating)}` : undefined,
          ]
            .filter(Boolean)
            .join(" — "),
        ),
        metadata: {
          ...x,
          includeDetails: !!placeOptions.includeDetails,
          includeDescriptions: !!placeOptions.includeDescriptions,
        },
      };
    }),
  };
}

async function completion(
  input: string,
  config: Brave,
  context: ProviderContext,
  raw: Record<string, unknown>,
): Promise<ToolOutput> {
  const key = requireKey(config.credentials?.answers, "Brave Answers");
  const body = {
    model: "brave",
    messages: [{ role: "user", content: input }],
    ...raw,
    stream: true,
  };
  const r = await fetch(`${base(config)}/res/v1/chat/completions`, {
    method: "POST",
    headers: headers(key, true),
    body: JSON.stringify(body),
    signal: context.signal,
  });
  if (!r.ok) throw new Error(await httpError(r));
  const text = await r.text();
  const { answer, citations, usage } = parseAnswerStream(text);
  const lines = [answer.trim() || text.trim()];
  if (citations.length) {
    lines.push("", "Sources:");
    citations.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.title ?? c.url ?? "Source"}`);
      if (c.url) lines.push(`   ${c.url}`);
    });
  }
  return {
    provider: "brave",
    text: lines.join("\n").trimEnd(),
    itemCount: citations.length,
    metadata: usage ? { usage } : undefined,
  };
}
function parseAnswerStream(text: string): {
  answer: string;
  citations: Array<{ title?: string; url?: string }>;
  usage?: unknown;
} {
  let answer = "";
  const citations: Array<{ title?: string; url?: string }> = [];
  let usage: unknown;
  for (const line of text.split(/\r?\n/)) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!data || data === "[DONE]") continue;
    const dataTags = extractBraveTags(data);
    citations.push(...dataTags.citations);
    usage = dataTags.usage ?? usage;
    try {
      const parsed = obj(JSON.parse(data));
      const choice = obj(arr(parsed.choices)[0]);
      const delta = str(obj(choice.delta).content);
      if (delta) {
        const deltaTags = extractBraveTags(delta);
        citations.push(...deltaTags.citations);
        usage = deltaTags.usage ?? usage;
        answer += deltaTags.text;
      }
    } catch {
      answer += dataTags.text;
    }
  }
  return { answer, citations: dedupeCitations(citations), usage };
}

function extractBraveTags(text: string): {
  text: string;
  citations: Array<{ title?: string; url?: string }>;
  usage?: unknown;
} {
  const citations: Array<{ title?: string; url?: string }> = [];
  let usage: unknown;
  const cleaned = text.replace(
    /<(citation|usage|enum_item)(\{.*?\})(?:<\/\1>?)?/gs,
    (_match, tag: string, json: string) => {
      try {
        const parsed = JSON.parse(json);
        if (tag === "citation") {
          citations.push({
            title: str(parsed.title),
            url: str(parsed.url),
          });
        } else if (tag === "usage") {
          usage = parsed;
        }
      } catch {}
      return "";
    },
  );
  return { text: cleaned, citations, usage };
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
