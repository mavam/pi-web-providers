import { afterEach, describe, expect, it, vi } from "vitest";
import { braveProvider } from "../src/providers/brave.js";
import { providerHarness } from "./provider-harness.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.BRAVE_SEARCH_API_KEY;
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
                title: "Blue Bottle Coffee",
                url: "https://bluebottlecoffee.example",
                postal_address: { displayAddress: "66 Mint St" },
                categories: ["Coffee & Tea", "Cafe"],
              },
              {
                id: "loc-2",
                title: "Ferry Building",
                provider_url: "https://maps.example/ferry-building",
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
                contact: { telephone: "+1 555 0100" },
                rating: { ratingValue: 4.5 },
              },
              {
                id: "loc-2",
                postal_address: { displayAddress: "1 Ferry Building" },
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
              { id: "loc-1", description: "A cozy coffee shop." },
              { id: "loc-2", description: "A historic marketplace." },
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
          location: "san francisco ca united states",
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
        "https://api.search.brave.test/res/v1/local/place_search?q=coffee&count=2&search_lang=en&ui_lang=en-US&location=san+francisco+ca+united+states&units=imperial",
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
        title: "Blue Bottle Coffee",
        url: "https://bluebottlecoffee.example",
        snippet:
          "A cozy coffee shop. — 66 Mint St — Coffee & Tea, Cafe — Rating: 4.5",
        metadata: {
          id: "loc-1",
          title: "Blue Bottle Coffee",
          url: "https://bluebottlecoffee.example",
          postal_address: { displayAddress: "66 Mint St" },
          categories: ["Coffee & Tea", "Cafe"],
          poiDetails: {
            id: "loc-1",
            contact: { telephone: "+1 555 0100" },
            rating: { ratingValue: 4.5 },
          },
          poiDescription: {
            id: "loc-1",
            description: "A cozy coffee shop.",
          },
        },
      },
      {
        title: "Ferry Building",
        url: "https://maps.example/ferry-building",
        snippet: "A historic marketplace. — 1 Ferry Building",
        metadata: {
          id: "loc-2",
          title: "Ferry Building",
          provider_url: "https://maps.example/ferry-building",
          poiDetails: {
            id: "loc-2",
            postal_address: { displayAddress: "1 Ferry Building" },
          },
          poiDescription: {
            id: "loc-2",
            description: "A historic marketplace.",
          },
        },
      },
    ]);
  });
});
