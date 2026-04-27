import { afterEach, describe, expect, it, vi } from "vitest";
import { serperAdapter } from "../src/providers/serper.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.SERPER_API_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("serperAdapter", () => {
  it("maps Serper organic results and preserves rich metadata", async () => {
    process.env.SERPER_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          searchParameters: {
            q: "serper api",
            gl: "us",
            hl: "en",
          },
          credits: 1,
          knowledgeGraph: {
            title: "Serper",
            type: "Company",
          },
          answerBox: {
            answer: "Structured Google search API",
          },
          peopleAlsoAsk: [
            {
              question: "What is Serper?",
              link: "https://example.com/what-is-serper",
            },
          ],
          relatedSearches: [{ query: "serper pricing" }],
          organic: [
            {
              title: "Serper Docs",
              link: "https://serper.dev",
              snippet: "A".repeat(400),
              position: 1,
              date: "2026-04-10",
              sitelinks: [
                {
                  title: "Pricing",
                  link: "https://serper.dev/pricing",
                },
              ],
              attributes: {
                category: "API",
              },
              favicon: "https://serper.dev/favicon.ico",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await serperAdapter.search(
      "serper api",
      25,
      {
        apiKey: "SERPER_API_KEY",
        baseUrl: "https://google.serper.test",
        options: {
          search: {
            gl: "de",
            autocorrect: false,
          },
        },
      },
      { cwd: process.cwd() },
      {
        hl: "en",
        location: "Berlin, Berlin, Germany",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://google.serper.test/search",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          q: "serper api",
          num: 20,
          gl: "de",
          autocorrect: false,
          hl: "en",
          location: "Berlin, Berlin, Germany",
        }),
        signal: undefined,
      },
    );
    expect(response).toEqual({
      provider: "serper",
      results: [
        {
          title: "Serper Docs",
          url: "https://serper.dev",
          snippet: `${"A".repeat(299)}…`,
          metadata: {
            source: "organic",
            position: 1,
            date: "2026-04-10",
            attributes: {
              category: "API",
            },
            sitelinks: [
              {
                title: "Pricing",
                link: "https://serper.dev/pricing",
              },
            ],
            favicon: "https://serper.dev/favicon.ico",
            searchContext: {
              searchParameters: {
                q: "serper api",
                gl: "us",
                hl: "en",
              },
              credits: 1,
              answerBox: {
                answer: "Structured Google search API",
              },
              knowledgeGraph: {
                title: "Serper",
                type: "Company",
              },
              peopleAlsoAsk: [
                {
                  question: "What is Serper?",
                  link: "https://example.com/what-is-serper",
                },
              ],
              relatedSearches: [{ query: "serper pricing" }],
            },
          },
        },
      ],
    });
  });

  it("returns an empty result set when Serper has no organic matches", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ peopleAlsoAsk: [] }), { status: 200 }),
      ) as typeof fetch;

    const response = await serperAdapter.search(
      "serper",
      3,
      {
        apiKey: "literal-key",
      },
      { cwd: process.cwd() },
    );

    expect(response).toEqual({
      provider: "serper",
      results: [],
    });
  });

  it("surfaces Serper HTTP errors with response details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid key" }), {
        status: 401,
        statusText: "Unauthorized",
      }),
    ) as typeof fetch;

    await expect(
      serperAdapter.search(
        "serper",
        3,
        {
          apiKey: "literal-key",
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(
      /Serper API request failed \(401 Unauthorized\): invalid key/,
    );
  });

  it("requires an API key", async () => {
    await expect(
      serperAdapter.search(
        "serper",
        1,
        {
          apiKey: "SERPER_API_KEY",
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/missing an API key/);
  });
});
