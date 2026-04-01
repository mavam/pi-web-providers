import { afterEach, describe, expect, it, vi } from "vitest";

const { extractMock, searchMock, tavilyFactoryMock } = vi.hoisted(() => ({
  extractMock: vi.fn(),
  searchMock: vi.fn(),
  tavilyFactoryMock: vi.fn(),
}));

vi.mock("@tavily/core", () => ({
  tavily: tavilyFactoryMock.mockImplementation(function mockTavily() {
    return {
      search: searchMock,
      searchQNA: vi.fn(),
      searchContext: vi.fn(),
      extract: extractMock,
      crawl: vi.fn(),
      map: vi.fn(),
      research: vi.fn(),
      getResearch: vi.fn(),
    };
  }),
}));

import { tavilyAdapter } from "../src/providers/tavily.js";

afterEach(() => {
  delete process.env.TAVILY_API_KEY;
  searchMock.mockReset();
  extractMock.mockReset();
  tavilyFactoryMock.mockClear();
});

describe("tavilyAdapter", () => {
  it("merges search options, overrides maxResults, and preserves metadata", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    searchMock.mockResolvedValue({
      query: "tavily sdk",
      responseTime: 1.09,
      requestId: "request-123",
      images: [],
      results: [
        {
          title: "Tavily Docs",
          url: "https://docs.tavily.com",
          content: "A".repeat(400),
          rawContent: "Raw Tavily Docs",
          score: 0.92,
          publishedDate: "2026-03-01",
          favicon: "https://docs.tavily.com/favicon.ico",
        },
      ],
    });

    const response = await tavilyAdapter.search(
      "tavily sdk",
      5,
      {
        apiKey: "TAVILY_API_KEY",
        baseUrl: "https://api.tavily.test",
        options: {
          search: {
            topic: "news",
            requestTimeoutMs: 999,
          },
        },
      },
      { cwd: process.cwd() },
      {
        country: "US",
        maxResults: 50,
      },
    );

    expect(tavilyFactoryMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      apiBaseURL: "https://api.tavily.test",
    });
    expect(searchMock).toHaveBeenCalledWith("tavily sdk", {
      topic: "news",
      country: "US",
      maxResults: 5,
    });
    expect(response.results).toEqual([
      {
        title: "Tavily Docs",
        url: "https://docs.tavily.com",
        snippet: `${"A".repeat(299)}…`,
        score: 0.92,
        metadata: {
          publishedDate: "2026-03-01",
          favicon: "https://docs.tavily.com/favicon.ico",
          rawContent: "Raw Tavily Docs",
          requestId: "request-123",
          responseTime: 1.09,
        },
      },
    ]);
  });

  it("preserves URL order for contents and surfaces failed extractions", async () => {
    extractMock.mockResolvedValue({
      results: [
        {
          url: "https://example.com/b",
          title: "Page B",
          rawContent: "Body B",
          images: ["https://example.com/image.png"],
          favicon: "https://example.com/favicon.ico",
        },
      ],
      failedResults: [
        {
          url: "https://example.com/a",
          error: "blocked",
        },
      ],
      responseTime: 2.5,
      requestId: "extract-123",
    });

    const response = await tavilyAdapter.contents(
      ["https://example.com/a", "https://example.com/b"],
      {
        apiKey: "literal-key",
        options: {
          extract: {
            format: "markdown",
            requestTimeoutMs: 999,
          },
        },
      },
      { cwd: process.cwd() },
      {
        includeImages: true,
      },
    );

    expect(extractMock).toHaveBeenCalledWith(
      ["https://example.com/a", "https://example.com/b"],
      {
        format: "markdown",
        includeImages: true,
      },
    );
    expect(response.answers).toEqual([
      {
        url: "https://example.com/a",
        error: "blocked",
      },
      {
        url: "https://example.com/b",
        content: "Body B",
        metadata: {
          title: "Page B",
          images: ["https://example.com/image.png"],
          favicon: "https://example.com/favicon.ico",
          requestId: "extract-123",
          responseTime: 2.5,
        },
      },
    ]);
  });
});
