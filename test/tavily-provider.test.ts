import { afterEach, describe, expect, it, vi } from "vitest";

const {
  extractMock,
  getResearchMock,
  researchMock,
  searchMock,
  tavilyFactoryMock,
} = vi.hoisted(() => ({
  extractMock: vi.fn(),
  getResearchMock: vi.fn(),
  researchMock: vi.fn(),
  searchMock: vi.fn(),
  tavilyFactoryMock: vi.fn(),
}));

vi.mock("@tavily/core", () => ({
  tavily: tavilyFactoryMock.mockImplementation(function mockTavily() {
    return {
      search: searchMock,
      extract: extractMock,
      research: researchMock,
      getResearch: getResearchMock,
    };
  }),
}));

import { TavilyAdapter } from "../src/providers/tavily.js";

afterEach(() => {
  delete process.env.TAVILY_API_KEY;
  searchMock.mockReset();
  extractMock.mockReset();
  researchMock.mockReset();
  getResearchMock.mockReset();
  tavilyFactoryMock.mockClear();
});

describe("TavilyAdapter", () => {
  it("merges search options, overrides maxResults, and preserves metadata", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    searchMock.mockResolvedValue({
      results: [
        {
          title: "Tavily Docs",
          url: "https://docs.tavily.com",
          content: "A".repeat(400),
          score: 0.92,
          publishedDate: "2026-03-01",
          favicon: "https://docs.tavily.com/favicon.ico",
        },
      ],
    });

    const provider = new TavilyAdapter();
    const response = await provider.search(
      "tavily sdk",
      5,
      {
        enabled: true,
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
        },
      ],
      failedResults: [
        {
          url: "https://example.com/a",
          error: "blocked",
        },
      ],
    });

    const provider = new TavilyAdapter();
    const response = await provider.contents(
      ["https://example.com/a", "https://example.com/b"],
      {
        enabled: true,
        apiKey: "literal-key",
        options: {
          extract: {
            format: "markdown",
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
          url: "https://example.com/b",
          title: "Page B",
          rawContent: "Body B",
        },
      },
    ]);
  });

  it("starts research with a resumable request id", async () => {
    researchMock.mockResolvedValue({
      requestId: "research-123",
    });

    const provider = new TavilyAdapter();
    const response = await provider.startResearch(
      "Investigate Tavily",
      {
        enabled: true,
        apiKey: "literal-key",
        options: {
          research: {
            model: "pro",
            requestTimeoutMs: 999,
          },
        },
      },
      { cwd: process.cwd() },
      {
        citationFormat: "apa",
      },
    );

    expect(researchMock).toHaveBeenCalledWith("Investigate Tavily", {
      model: "pro",
      citationFormat: "apa",
    });
    expect(response).toEqual({ id: "research-123" });
  });

  it("formats completed research responses with sources and maps failures", async () => {
    getResearchMock
      .mockResolvedValueOnce({
        status: "completed",
        content: "Research result",
        sources: [
          {
            title: "Source A",
            url: "https://example.com/a",
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "failed",
      });

    const provider = new TavilyAdapter();
    const completed = await provider.pollResearch(
      "research-123",
      {
        enabled: true,
        apiKey: "literal-key",
      },
      { cwd: process.cwd() },
      undefined,
    );
    const failed = await provider.pollResearch(
      "research-456",
      {
        enabled: true,
        apiKey: "literal-key",
      },
      { cwd: process.cwd() },
      undefined,
    );

    expect(getResearchMock).toHaveBeenNthCalledWith(1, "research-123");
    expect(completed).toEqual({
      status: "completed",
      output: {
        provider: "tavily",
        text: "Research result\n\nSources:\n1. Source A\n   https://example.com/a",
        itemCount: 1,
      },
    });
    expect(failed).toEqual({
      status: "failed",
      error: "Tavily research failed.",
    });
  });
});
