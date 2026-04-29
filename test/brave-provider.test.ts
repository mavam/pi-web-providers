import { afterEach, describe, expect, it, vi } from "vitest";
import { braveProvider } from "../src/providers/brave.js";
import { providerHarness } from "./provider-harness.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.BRAVE_ANSWERS_API_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("providerHarness(braveProvider)", () => {
  it("uses the Brave News Search API for news mode", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Brave launches news mode",
              url: "https://news.example.com/brave",
              description: "Launch coverage",
              source_name: "Example News",
              age: "2 hours ago",
              extra_snippets: ["Extra context"],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await providerHarness(braveProvider).search(
      "brave api",
      5,
      {
        credentials: { search: "BRAVE_SEARCH_API_KEY" },
        baseUrl: "https://api.search.brave.test",
        options: {
          search: {
            mode: "news",
            common: { country: "US", ignored: true },
          },
        },
      },
      { cwd: process.cwd() },
      { news: { search_lang: "en", freshness: "pd", extra_snippets: true } },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://api.search.brave.test/res/v1/news/search?q=brave+api&count=5&country=US&search_lang=en&freshness=pd&extra_snippets=true",
      ),
      {
        headers: { "X-Subscription-Token": "test-key" },
        signal: undefined,
      },
    );
    expect(response).toEqual({
      provider: "brave",
      results: [
        {
          title: "Brave launches news mode",
          url: "https://news.example.com/brave",
          snippet: "Launch coverage — Example News — 2 hours ago",
          metadata: {
            title: "Brave launches news mode",
            url: "https://news.example.com/brave",
            description: "Launch coverage",
            source_name: "Example News",
            age: "2 hours ago",
            extra_snippets: ["Extra context"],
          },
        },
      ],
    });
  });

  it("uses the Brave Video Search API for videos mode", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Brave API tutorial",
              url: "https://video.example.com/brave",
              description: "How to use Brave APIs",
              age: "April 20, 2026",
              video: {
                creator: "Example Creator",
                duration: "12:22",
                views: 12345,
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await providerHarness(braveProvider).search(
      "brave tutorial",
      3,
      {
        credentials: { search: "BRAVE_SEARCH_API_KEY" },
        baseUrl: "https://api.search.brave.test",
        options: {
          search: {
            mode: "videos",
            videos: {},
          },
        },
      },
      { cwd: process.cwd() },
      { videos: { freshness: "pw", safesearch: "strict", spellcheck: false } },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://api.search.brave.test/res/v1/videos/search?q=brave+tutorial&count=3&freshness=pw&safesearch=strict&spellcheck=false",
      ),
      {
        headers: { "X-Subscription-Token": "test-key" },
        signal: undefined,
      },
    );
    expect(response.results).toEqual([
      {
        title: "Brave API tutorial",
        url: "https://video.example.com/brave",
        snippet:
          "How to use Brave APIs — Example Creator — 12:22 — 12345 views — April 20, 2026",
        metadata: {
          title: "Brave API tutorial",
          url: "https://video.example.com/brave",
          description: "How to use Brave APIs",
          age: "April 20, 2026",
          video: {
            creator: "Example Creator",
            duration: "12:22",
            views: 12345,
          },
        },
      },
    ]);
  });

  it("sends Brave Answers options under web_search_options and parses streamed tags", async () => {
    process.env.BRAVE_ANSWERS_API_KEY = "answers-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"Answer text "}}]}',
            'data: {"choices":[{"delta":{"content":"<citation>{\\"title\\":\\"Example source\\",\\"url\\":\\"https://example.com/source\\"}</citation>"}}]}',
            'data: {"choices":[{"delta":{"content":"<usage>{\\"X-Request-Queries\\":1}</usage>"}}]}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await providerHarness(braveProvider).answer(
      "what happened?",
      {
        credentials: { answers: "BRAVE_ANSWERS_API_KEY" },
        baseUrl: "https://api.search.brave.test",
      },
      { cwd: process.cwd() },
      { country: "US", language: "en", enable_entities: true },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.search.brave.test/res/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "X-Subscription-Token": "answers-key",
          "content-type": "application/json",
        },
        signal: undefined,
      }),
    );
    expect(JSON.parse(String(init.body))).toEqual({
      model: "brave",
      messages: [{ role: "user", content: "what happened?" }],
      stream: true,
      web_search_options: {
        country: "US",
        language: "en",
        enable_entities: true,
        enable_citations: true,
      },
    });
    expect(response).toEqual({
      provider: "brave",
      text: [
        "Answer text",
        "",
        "Sources:",
        "1. Example source",
        "   https://example.com/source",
      ].join("\n"),
      itemCount: 1,
      metadata: { usage: { "X-Request-Queries": 1 } },
    });
  });

  it("sends Brave research mode under web_search_options and extracts answer tags", async () => {
    process.env.BRAVE_ANSWERS_API_KEY = "answers-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"<queries>{\\"queries\\":[\\"research this topic\\"]}</queries>"}}]}',
            'data: {"choices":[{"delta":{"content":"<thinking>{\\"urls_analyzed\\":3}</thinking>"}}]}',
            'data: {"choices":[{"delta":{"content":"<blindspots>[\\"missing detail\\"]</blindspots>"}}]}',
            'data: {"choices":[{"delta":{"content":"<answer>{\\"answer\\":\\"Research report\\"}</answer>"}}]}',
            "data: [DONE]",
          ].join("\n\n"),
          { status: 200 },
        ),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await providerHarness(braveProvider).research(
      "research this topic",
      {
        credentials: { answers: "BRAVE_ANSWERS_API_KEY" },
        baseUrl: "https://api.search.brave.test",
      },
      { cwd: process.cwd() },
      {
        country: "US",
        research_maximum_number_of_queries: 3,
        max_completion_tokens: 1000,
      },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({
      model: "brave",
      messages: [{ role: "user", content: "research this topic" }],
      stream: true,
      max_completion_tokens: 1000,
      web_search_options: {
        country: "US",
        research_maximum_number_of_queries: 3,
        enable_research: true,
        enable_citations: false,
      },
    });
    expect(response.text).toBe("Research report");
  });

  it("fetches Brave place details and descriptions when requested", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-key";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === "/res/v1/local/place_search") {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: "loc-1",
                title: "ACME Cafe",
                url: "https://acme-cafe.example.com",
                postal_address: { displayAddress: "100 Example Street" },
                categories: ["Cafe", "Bakery"],
              },
              {
                id: "loc-2",
                title: "Example Market Hall",
                provider_url: "https://maps.example.com/market-hall",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.pathname === "/res/v1/local/pois") {
        return new Response(
          JSON.stringify({
            type: "local_pois",
            results: [
              {
                id: "loc-1",
                contact: { telephone: "+1 000 000 0000" },
                rating: { ratingValue: 4.5 },
              },
              {
                id: "loc-2",
                postal_address: { displayAddress: "200 Example Avenue" },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.pathname === "/res/v1/local/descriptions") {
        return new Response(
          JSON.stringify({
            type: "local_descriptions",
            results: [
              { id: "loc-1", description: "A fictional neighborhood cafe." },
              { id: "loc-2", description: "A fictional indoor market." },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("Not found", { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await providerHarness(braveProvider).search(
      "coffee",
      2,
      {
        credentials: { search: "BRAVE_SEARCH_API_KEY" },
        baseUrl: "https://api.search.brave.test",
        options: { search: { mode: "places" } },
      },
      { cwd: process.cwd() },
      {
        places: {
          location: "example city example region",
          includeDetails: true,
          includeDescriptions: true,
          search_lang: "en",
          ui_lang: "en-US",
          units: "imperial",
        },
      },
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL(
        "https://api.search.brave.test/res/v1/local/place_search?q=coffee&count=2&search_lang=en&ui_lang=en-US&location=example+city+example+region&units=imperial",
      ),
      {
        headers: { "X-Subscription-Token": "test-key" },
        signal: undefined,
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL(
        "https://api.search.brave.test/res/v1/local/pois?ids=loc-1&ids=loc-2&search_lang=en&ui_lang=en-US&units=imperial",
      ),
      {
        headers: { "X-Subscription-Token": "test-key" },
        signal: undefined,
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL(
        "https://api.search.brave.test/res/v1/local/descriptions?ids=loc-1&ids=loc-2",
      ),
      {
        headers: { "X-Subscription-Token": "test-key" },
        signal: undefined,
      },
    );
    expect(response.results).toEqual([
      {
        title: "ACME Cafe",
        url: "https://acme-cafe.example.com",
        snippet:
          "A fictional neighborhood cafe. — 100 Example Street — Cafe, Bakery — Rating: 4.5",
        metadata: {
          id: "loc-1",
          title: "ACME Cafe",
          url: "https://acme-cafe.example.com",
          postal_address: { displayAddress: "100 Example Street" },
          categories: ["Cafe", "Bakery"],
          poiDetails: {
            id: "loc-1",
            contact: { telephone: "+1 000 000 0000" },
            rating: { ratingValue: 4.5 },
          },
          poiDescription: {
            id: "loc-1",
            description: "A fictional neighborhood cafe.",
          },
        },
      },
      {
        title: "Example Market Hall",
        url: "https://maps.example.com/market-hall",
        snippet: "A fictional indoor market. — 200 Example Avenue",
        metadata: {
          id: "loc-2",
          title: "Example Market Hall",
          provider_url: "https://maps.example.com/market-hall",
          poiDetails: {
            id: "loc-2",
            postal_address: { displayAddress: "200 Example Avenue" },
          },
          poiDescription: {
            id: "loc-2",
            description: "A fictional indoor market.",
          },
        },
      },
    ]);
  });
});
