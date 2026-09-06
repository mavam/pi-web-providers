import { asWebfoxError, httpError, WebfoxError } from "../../errors.js";
import { orderedContents } from "../../contents.js";
import FirecrawlClient, {
  type Document,
  type SearchData,
} from "@mendable/firecrawl-js";
import type { ContentsResponse } from "../../contents.js";
import type {
  ProviderContext,
  SearchResponse,
  SearchResult,
  ToolOutput,
} from "../contract.js";
import type { Firecrawl } from "./types.js";

import { formatJson, trimSnippet } from "../shared.js";

const FIRECRAWL_CLOUD_HOST = "api.firecrawl.dev";
const FIRECRAWL_DEFAULT_API_URL = "https://api.firecrawl.dev";
const FIRECRAWL_QUESTION_LIMIT = 10_000;

// Scrape tuning controls shared by `web_contents` (scrape) and `web_answer`.

const firecrawlImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Firecrawl,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);

    const response = await client.search(query, {
      ...(options ?? {}),
      limit: maxResults,
    });

    return {
      provider: "firecrawl",
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

    const scrapeOptions = {
      formats: ["markdown"],
      onlyMainContent: true,

      ...(options ?? {}),
      autoResume: false,
    };

    return {
      provider: "firecrawl",
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
              error: asWebfoxError(error).toJSON(),
            };
          }
        }),
      ),
    };
  },

  async answer(
    query: string,
    config: Firecrawl,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const question = validateQuestion(query);

    const mergedOptions: Record<string, unknown> = {
      onlyMainContent: true,

      ...(options ?? {}),
    };
    const url = validateUrl(mergedOptions.url);
    const scrapeOptions = stripAnswerOnlyOptions(mergedOptions);
    const response = await scrapeQuestion(
      config,
      url,
      question,
      scrapeOptions,
      context.signal,
    );
    const document = getFirecrawlDocument(response);
    const answer = readString(document.answer);

    if (!answer?.trim()) {
      throw new Error("No answer returned for this URL.");
    }

    return {
      provider: "firecrawl",
      text: answer.trim(),
      itemCount: 1,
      metadata: {
        url,
        ...(asRecord(document.metadata)
          ? { metadata: document.metadata as Record<string, unknown> }
          : {}),
      },
    };
  },
};

function createClient(config: Firecrawl): FirecrawlClient {
  const apiUrl = config.baseUrl;
  const apiKey = config.credentials?.api;
  if (isFirecrawlCloudApiUrl(apiUrl) && !apiKey) {
    throw new WebfoxError(
      "PROVIDER_UNAVAILABLE",
      "Firecrawl cloud requires FIRECRAWL_API_KEY; self-hosted instances can use baseUrl without a key.",
    );
  }

  return new FirecrawlClient({
    // Firecrawl counts attempts, unlike SDKs whose maxRetries excludes the first call.
    maxRetries: 1,
    apiKey,
    apiUrl,
  });
}

function isFirecrawlCloudApiUrl(apiUrl: string | undefined): boolean {
  return !apiUrl || apiUrl.includes(FIRECRAWL_CLOUD_HOST);
}

function validateQuestion(query: string): string {
  const question = query.trim();
  if (!question) {
    throw new Error("question must be a non-empty string.");
  }
  if (question.length > FIRECRAWL_QUESTION_LIMIT) {
    throw new Error(
      `Firecrawl question must be at most ${FIRECRAWL_QUESTION_LIMIT} characters.`,
    );
  }
  return question;
}

function validateUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Firecrawl answer requires options.url.");
  }
  return value.trim();
}

function stripAnswerOnlyOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  const { url: _url, formats: _formats, ...scrapeOptions } = options;
  return scrapeOptions;
}

async function scrapeQuestion(
  config: Firecrawl,
  url: string,
  question: string,
  options: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const apiUrl = config.baseUrl ?? FIRECRAWL_DEFAULT_API_URL;
  const apiKey = config.credentials?.api;
  if (isFirecrawlCloudApiUrl(apiUrl) && !apiKey) {
    throw new WebfoxError(
      "PROVIDER_UNAVAILABLE",
      "Firecrawl cloud requires FIRECRAWL_API_KEY; self-hosted instances can use baseUrl without a key.",
    );
  }

  const response = await fetch(joinUrl(apiUrl, "/v2/scrape"), {
    signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      ...options,
      url,
      formats: [{ type: "question", question }],
    }),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw httpError(response, readFirecrawlError(payload, response.statusText));
  }
  if (isFirecrawlFailure(payload)) {
    throw new Error(readFirecrawlError(payload, "Firecrawl scrape failed."));
  }
  return payload;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}/${path.replace(/^\/+/g, "")}`;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isFirecrawlFailure(value: unknown): boolean {
  const record = asRecord(value);
  return record?.success === false || record?.error !== undefined;
}

function readFirecrawlError(value: unknown, fallback: string): string {
  const record = asRecord(value);
  return (
    readString(record?.error) ??
    readString(record?.message) ??
    (typeof value === "string" ? value : undefined) ??
    fallback
  );
}

function getFirecrawlDocument(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const data = asRecord(record?.data);
  if (data) {
    return data;
  }
  if (record) {
    return record;
  }
  throw new Error(`Unexpected Firecrawl response: ${formatJson(value)}`);
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

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Firecrawl,
    context: ProviderContext,
  ) {
    return await firecrawlImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Firecrawl,
    context: ProviderContext,
  ) {
    return orderedContents(
      await firecrawlImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
  async answer(
    input: import("../contract.js").ProviderRequest<"answer">,
    config: Firecrawl,
    context: ProviderContext,
  ) {
    return await firecrawlImplementation.answer(
      input.query,
      config,
      context,
      input.options,
    );
  },
};
