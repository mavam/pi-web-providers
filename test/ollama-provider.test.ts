import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentsResponse } from "../src/contents.js";
import { executeProviderCapability } from "../src/providers/definition.js";
import { ollamaProvider } from "../src/providers/ollama.js";
import type { Ollama, ProviderContext, SearchResponse } from "../src/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.OLLAMA_API_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function searchOllama(
  query: string,
  maxResults: number,
  config: Ollama,
  context: ProviderContext,
): Promise<SearchResponse> {
  return await executeProviderCapability(
    ollamaProvider,
    "search",
    { query, maxResults },
    { ...context, config },
  );
}

async function fetchOllama(
  urls: string[],
  config: Ollama,
  context: ProviderContext,
): Promise<ContentsResponse> {
  return await executeProviderCapability(
    ollamaProvider,
    "contents",
    { urls },
    { ...context, config },
  );
}

describe("ollamaProvider", () => {
  it("returns search results from the Ollama web search API", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Ollama",
              url: "https://ollama.com/",
              content: "Cloud models are now available in Ollama",
            },
            {
              title: "What is Ollama?",
              url: "https://example.com/what-is-ollama",
              content: "Ollama is an open-source tool...",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await searchOllama(
      "what is ollama?",
      5,
      {
        credentials: { api: "OLLAMA_API_KEY" },
      },
      { cwd: process.cwd() },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ollama.com/api/web_search",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: "what is ollama?", max_results: 5 }),
      }),
    );

    expect(response).toEqual({
      provider: "ollama",
      results: [
        {
          title: "Ollama",
          url: "https://ollama.com/",
          snippet: "Cloud models are now available in Ollama",
        },
        {
          title: "What is Ollama?",
          url: "https://example.com/what-is-ollama",
          snippet: "Ollama is an open-source tool...",
        },
      ],
    });
  });

  it("clamps web search result counts to Ollama's 1-10 range", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await searchOllama(
      "test",
      20,
      {
        credentials: { api: "OLLAMA_API_KEY" },
      },
      { cwd: process.cwd() },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ query: "test", max_results: 10 }),
      }),
    );
  });

  it("returns contents from the Ollama web fetch API", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          title: "Ollama",
          content:
            "Cloud models are now available in Ollama\n\n\nExplore models",
          links: ["https://ollama.com/models"],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await fetchOllama(
      ["https://ollama.com"],
      {
        credentials: { api: "OLLAMA_API_KEY" },
      },
      { cwd: process.cwd() },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ollama.com/api/web_fetch",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: "https://ollama.com" }),
      }),
    );

    expect(response).toEqual({
      provider: "ollama",
      answers: [
        {
          url: "https://ollama.com",
          content: "Cloud models are now available in Ollama\n\nExplore models",
          metadata: {
            title: "Ollama",
            links: ["https://ollama.com/models"],
          },
        },
      ],
    });
  });

  it("builds Ollama endpoints from a configurable base URL", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await searchOllama(
      "test",
      5,
      {
        credentials: { api: "OLLAMA_API_KEY" },
        baseUrl: "https://ollama-proxy.test/api/",
      },
      { cwd: process.cwd() },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ollama-proxy.test/api/web_search",
      expect.any(Object),
    );
  });

  it("handles failed fetch requests per URL", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid key" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await fetchOllama(
      ["https://ollama.com"],
      {
        credentials: { api: "OLLAMA_API_KEY" },
      },
      { cwd: process.cwd() },
    );

    expect(response).toEqual({
      provider: "ollama",
      answers: [
        {
          url: "https://ollama.com",
          error: "Ollama API request failed (401 Unauthorized): invalid key",
        },
      ],
    });
  });

  it("surfaces Ollama HTTP errors with response details", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid key" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    ) as typeof fetch;

    await expect(
      searchOllama(
        "test",
        5,
        {
          credentials: { api: "OLLAMA_API_KEY" },
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(
      /Ollama API request failed \(401 Unauthorized\): invalid key/,
    );
  });

  it("requires an API key", async () => {
    await expect(
      searchOllama(
        "test",
        5,
        {
          credentials: { api: "OLLAMA_API_KEY" },
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/missing an API key/);
  });

  it("reports missing_api_key when the configured API key does not resolve", () => {
    expect(
      ollamaProvider.getCapabilityStatus(
        {
          credentials: { api: "OLLAMA_API_KEY" },
        },
        process.cwd(),
      ),
    ).toEqual({ state: "missing_api_key" });
  });

  it("reports ready when the configured API key resolves", () => {
    process.env.OLLAMA_API_KEY = "test-key";

    expect(
      ollamaProvider.getCapabilityStatus(
        {
          credentials: { api: "OLLAMA_API_KEY" },
        },
        process.cwd(),
      ),
    ).toEqual({ state: "ready" });
  });

  it("supports search and contents tools", () => {
    expect(typeof ollamaProvider.capabilities.search.execute).toBe("function");
    expect(typeof ollamaProvider.capabilities.contents.execute).toBe(
      "function",
    );
    expect("answer" in ollamaProvider.capabilities).toBe(false);
    expect("research" in ollamaProvider.capabilities).toBe(false);
  });
});

describe("Ollama config", () => {
  it("creates an Ollama provider template", () => {
    expect(ollamaProvider.config.createTemplate()).toEqual({
      credentials: { api: "OLLAMA_API_KEY" },
    });
  });
});
