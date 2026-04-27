import { resolveConfigValue } from "../config-values.js";
import type { ContentsResponse } from "../contents.js";
import type {
  Ollama,
  ProviderAdapter,
  ProviderContext,
  SearchResponse,
} from "../types.js";
import {
  adapterFromProvider,
  defineCapability,
  defineProvider,
} from "./definition.js";
import {
  getApiKeyStatus,
  normalizeContentText,
  trimSnippet,
} from "./shared.js";

const DEFAULT_BASE_URL = "https://ollama.com";
const WEB_SEARCH_PATH = "/api/web_search";
const WEB_FETCH_PATH = "/api/web_fetch";

export const ollamaProvider = defineProvider({
  id: "ollama",
  label: "Ollama",
  docsUrl: "https://docs.ollama.com/capabilities/web-search",

  config: {
    createTemplate(): Ollama {
      return {
        apiKey: "OLLAMA_API_KEY",
      };
    },
    fields: ["apiKey", "baseUrl", "settings"],
  },

  getCapabilityStatus(config: Ollama | undefined) {
    return getApiKeyStatus(config?.apiKey);
  },

  capabilities: {
    search: defineCapability<{ query: string; maxResults: number }>({
      limits: {
        maxResults: 10,
      },
      async execute(
        { query, maxResults },
        { config, signal },
      ): Promise<SearchResponse> {
        return await searchOllama(query, maxResults, config as Ollama, {
          signal,
        });
      },
    }),
    contents: defineCapability<{ urls: string[] }>({
      async execute({ urls }, { config, signal }): Promise<ContentsResponse> {
        return await fetchOllamaContents(urls, config as Ollama, { signal });
      },
    }),
  },
});

export const ollamaAdapter = adapterFromProvider(
  ollamaProvider,
) as ProviderAdapter<"ollama"> & {
  search: NonNullable<ProviderAdapter<"ollama">["search"]>;
  contents: NonNullable<ProviderAdapter<"ollama">["contents"]>;
};

async function searchOllama(
  query: string,
  maxResults: number,
  config: Ollama,
  context: Pick<ProviderContext, "signal">,
): Promise<SearchResponse> {
  const apiKey = resolveApiKey(config);

  const response = await fetch(
    resolveEndpoint(config.baseUrl, WEB_SEARCH_PATH),
    {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        query,
        max_results: clampMaxResults(maxResults),
      }),
      signal: context.signal,
    },
  );

  if (!response.ok) {
    throw new Error(await buildHttpError(response));
  }

  const data = (await response.json()) as OllamaSearchResponse;
  const results = Array.isArray(data.results) ? data.results : [];

  return {
    provider: ollamaProvider.id,
    results: results.slice(0, clampMaxResults(maxResults)).map((result) => ({
      title: result.title || result.url || "Untitled",
      url: result.url ?? "",
      snippet: trimSnippet(result.content),
    })),
  };
}

async function fetchOllamaContents(
  urls: string[],
  config: Ollama,
  context: Pick<ProviderContext, "signal">,
): Promise<ContentsResponse> {
  const apiKey = resolveApiKey(config);
  const endpoint = resolveEndpoint(config.baseUrl, WEB_FETCH_PATH);

  return {
    provider: ollamaProvider.id,
    answers: await Promise.all(
      urls.map(async (url) => {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: buildHeaders(apiKey),
            body: JSON.stringify({
              url,
            }),
            signal: context.signal,
          });

          if (!response.ok) {
            return {
              url,
              error: await buildHttpError(response),
            };
          }

          const data = (await response.json()) as OllamaFetchResponse;
          const content = normalizeContentText(data.content);
          if (!content) {
            return {
              url,
              error: "No content returned for this URL.",
            };
          }

          const metadata = buildFetchMetadata(data);
          return {
            url,
            content,
            ...(metadata ? { metadata } : {}),
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
}

function resolveApiKey(config: Ollama): string {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }
  return apiKey;
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

function resolveEndpoint(
  baseUrlReference: string | undefined,
  endpointPath: string,
): string {
  const baseUrl = resolveConfigValue(baseUrlReference) ?? DEFAULT_BASE_URL;
  const base = baseUrl.replace(/\/+$/, "");
  const apiPath = endpointPath.replace(/^\/api\//, "");

  if (base.endsWith(endpointPath)) {
    return base;
  }
  if (base.endsWith("/api")) {
    return `${base}/${apiPath}`;
  }
  return `${base}${endpointPath}`;
}

function clampMaxResults(value: number): number {
  return Math.max(1, Math.min(10, Math.trunc(value || 0)));
}

async function buildHttpError(response: Response): Promise<string> {
  const detail = await readErrorDetail(response);
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  return detail
    ? `Ollama API request failed (${status}): ${detail}`
    : `Ollama API request failed (${status}).`;
}

async function readErrorDetail(
  response: Response,
): Promise<string | undefined> {
  const text = (await response.text()).trim();
  if (!text) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
      detail?: unknown;
    };
    for (const key of ["message", "error", "detail"] as const) {
      if (typeof parsed[key] === "string" && parsed[key].trim()) {
        return parsed[key];
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

interface OllamaSearchResponse {
  results?: OllamaSearchResult[];
}

interface OllamaSearchResult {
  title?: string;
  url?: string;
  content?: string;
}

interface OllamaFetchResponse {
  title?: string;
  content?: string;
  links?: string[];
}

function buildFetchMetadata(
  data: OllamaFetchResponse,
): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  if (data.title) {
    metadata.title = data.title;
  }
  if (data.links?.length) {
    metadata.links = data.links;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
