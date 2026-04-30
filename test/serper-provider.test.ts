import { afterEach, describe, expect, it, vi } from "vitest";
import { serperProvider } from "../src/providers/serper.js";
import { providerHarness } from "./provider-harness.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete process.env.SERPER_API_KEY;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("providerHarness(serperProvider)", () => {
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

    const response = await providerHarness(serperProvider).search(
      "serper api",
      25,
      {
        credentials: { api: "SERPER_API_KEY" },
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
          location: "Berlin, Berlin, Germany",
          gl: "de",
          hl: "en",
          autocorrect: false,
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

  it("drops invalid Serper option types before sending requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ organic: [] }), { status: 200 }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await providerHarness(serperProvider).search(
      "serper api",
      3,
      {
        credentials: { api: "literal-key" },
        options: {
          search: {
            gl: 123,
            page: "2",
            autocorrect: "false",
            customOption: "preserved",
          },
        },
      },
      { cwd: process.cwd() },
    );

    expect(fetchMock).toHaveBeenCalledWith("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "literal-key",
      },
      body: JSON.stringify({
        q: "serper api",
        num: 3,
        customOption: "preserved",
      }),
      signal: undefined,
    });
  });

  it("queries Serper vertical endpoints with structured mode options", async () => {
    process.env.SERPER_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          videos: [
            {
              title: "SpaceX Falcon 9 Launches Starlink 6-55",
              link: "https://www.youtube.com/watch?v=2ag4dKkL-pM",
              snippet: "SpaceX launch of Starlink satellites",
              imageUrl: "https://i.ytimg.com/vi/2ag4dKkL-pM/mqdefault.jpg",
              duration: "2:22:33",
              source: "YouTube",
              channel: "NASASpaceflight",
              date: "1 day ago",
              position: 1,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await providerHarness(serperProvider).search(
      "falcon 9 launch",
      5,
      {
        credentials: { api: "SERPER_API_KEY" },
        baseUrl: "https://google.serper.test",
      },
      { cwd: process.cwd() },
      {
        mode: "videos",
        gl: "us",
        hl: "en",
        tbs: "qdr:d",
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://google.serper.test/videos",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "test-key",
        },
        body: JSON.stringify({
          q: "falcon 9 launch",
          num: 5,
          gl: "us",
          hl: "en",
          tbs: "qdr:d",
        }),
        signal: undefined,
      },
    );
    expect(response.results).toEqual([
      {
        title: "SpaceX Falcon 9 Launches Starlink 6-55",
        url: "https://www.youtube.com/watch?v=2ag4dKkL-pM",
        snippet: "SpaceX launch of Starlink satellites",
        metadata: {
          source: "YouTube",
          position: 1,
          date: "1 day ago",
          imageUrl: "https://i.ytimg.com/vi/2ag4dKkL-pM/mqdefault.jpg",
          duration: "2:22:33",
          channel: "NASASpaceflight",
        },
      },
    ]);
  });

  it("shapes Serper webpage requests and maps the scraped page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          text: "Example Domain",
          markdown: "# Example Domain",
          metadata: { title: "Example Domain" },
          credits: 2,
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await providerHarness(serperProvider).search(
      "https://example.com",
      1,
      {
        credentials: { api: "literal-key" },
      },
      { cwd: process.cwd() },
      { mode: "webpage" },
    );

    expect(fetchMock).toHaveBeenCalledWith("https://scrape.serper.dev", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "literal-key",
      },
      body: JSON.stringify({
        url: "https://example.com",
        includeMarkdown: true,
      }),
      signal: undefined,
    });
    expect(response.results[0]).toMatchObject({
      title: "Example Domain",
      url: "https://example.com",
      snippet: "# Example Domain",
      metadata: {
        source: "webpage",
        markdown: "# Example Domain",
        text: "Example Domain",
        metadata: { title: "Example Domain" },
        searchContext: { credits: 2 },
      },
    });
  });

  it("maps Serper maps responses that return places", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            {
              title: "Fauve Coffee Berlin",
              address: "Neue Schönhauser Str. 8, 10178 Berlin, Germany",
              website: "https://fauve.example",
              rating: 4.8,
            },
          ],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const response = await providerHarness(serperProvider).search(
      "coffee berlin",
      1,
      {
        credentials: { api: "literal-key" },
        options: {
          search: {
            gl: "de",
            location: "Berlin, Berlin, Germany",
          },
        },
      },
      { cwd: process.cwd() },
      { mode: "maps", hl: "en" },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://google.serper.dev/maps",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "literal-key",
        },
        body: JSON.stringify({
          q: "coffee berlin",
          num: 1,
          location: "Berlin, Berlin, Germany",
          gl: "de",
          hl: "en",
        }),
        signal: undefined,
      },
    );
    expect(response.results).toEqual([
      {
        title: "Fauve Coffee Berlin",
        url: "https://fauve.example",
        snippet: "Neue Schönhauser Str. 8, 10178 Berlin, Germany",
        metadata: {
          source: "maps",
          rating: 4.8,
          address: "Neue Schönhauser Str. 8, 10178 Berlin, Germany",
        },
      },
    ]);
  });

  it("maps Serper review titles from reviewer metadata", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reviews: [
            {
              rating: 5,
              date: "5 days ago",
              snippet: "Great service!",
              user: {
                name: "pilgrim",
              },
              link: "https://www.google.com/maps/reviews/data=abc",
            },
          ],
        }),
        { status: 200 },
      ),
    ) as typeof fetch;

    const response = await providerHarness(serperProvider).search(
      "ignored",
      1,
      {
        credentials: { api: "literal-key" },
      },
      { cwd: process.cwd() },
      { mode: "reviews", cid: "4800608071159241399" },
    );

    expect(response.results).toEqual([
      {
        title: "pilgrim",
        url: "https://www.google.com/maps/reviews/data=abc",
        snippet: "Great service!",
        metadata: {
          source: "reviews",
          date: "5 days ago",
          rating: 5,
          user: {
            name: "pilgrim",
          },
        },
      },
    ]);
  });

  it("returns an empty result set when Serper has no organic matches", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ peopleAlsoAsk: [] }), { status: 200 }),
      ) as typeof fetch;

    const response = await providerHarness(serperProvider).search(
      "serper",
      3,
      {
        credentials: { api: "literal-key" },
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
      providerHarness(serperProvider).search(
        "serper",
        3,
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(
      /Serper API request failed \(401 Unauthorized\): invalid key/,
    );
  });

  it("requires an API key", async () => {
    await expect(
      providerHarness(serperProvider).search(
        "serper",
        1,
        {
          credentials: { api: "SERPER_API_KEY" },
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/missing an API key/);
  });
});
