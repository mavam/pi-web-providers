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
});
