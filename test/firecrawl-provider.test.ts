import { afterEach, describe, expect, it, vi } from "vitest";

const {
  firecrawlCtorMock,
  firecrawlSearchMock,
  firecrawlScrapeMock,
  firecrawlBatchScrapeMock,
  firecrawlBatchErrorsMock,
} = vi.hoisted(() => ({
  firecrawlCtorMock: vi.fn(),
  firecrawlSearchMock: vi.fn(),
  firecrawlScrapeMock: vi.fn(),
  firecrawlBatchScrapeMock: vi.fn(),
  firecrawlBatchErrorsMock: vi.fn(),
}));

vi.mock("@mendable/firecrawl-js", () => ({
  default: firecrawlCtorMock.mockImplementation(function MockFirecrawl() {
    return {
      search: firecrawlSearchMock,
      scrape: firecrawlScrapeMock,
      batchScrape: firecrawlBatchScrapeMock,
      getBatchScrapeErrors: firecrawlBatchErrorsMock,
    };
  }),
}));

import { FirecrawlAdapter } from "../src/providers/firecrawl.js";

afterEach(() => {
  delete process.env.FIRECRAWL_API_KEY;
  firecrawlCtorMock.mockClear();
  firecrawlSearchMock.mockReset();
  firecrawlScrapeMock.mockReset();
  firecrawlBatchScrapeMock.mockReset();
  firecrawlBatchErrorsMock.mockReset();
});

describe("FirecrawlAdapter", () => {
  it("merges search defaults, applies maxResults as limit, and normalizes mixed result shapes", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    firecrawlSearchMock.mockResolvedValue({
      web: [
        {
          url: "https://example.com/search",
          title: "Search result",
          description: "Search description",
        },
        {
          metadata: {
            sourceURL: "https://example.com/doc",
            title: "Doc result",
            description: "Doc description",
          },
          markdown: "Doc markdown body",
        },
      ],
      news: [
        {
          url: "https://example.com/news",
          title: "News result",
          snippet: "News snippet",
          date: "2026-03-20",
        },
      ],
    });

    const provider = new FirecrawlAdapter();
    const response = await provider.search(
      "firecrawl docs",
      2,
      {
        enabled: true,
        apiKey: "FIRECRAWL_API_KEY",
        options: {
          search: {
            sources: ["web"],
            scrapeOptions: {
              formats: ["markdown"],
            },
          },
        },
      },
      { cwd: process.cwd() },
      {
        timeout: 15000,
        limit: 99,
      },
    );

    expect(firecrawlCtorMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      apiUrl: undefined,
    });
    expect(firecrawlSearchMock).toHaveBeenCalledWith("firecrawl docs", {
      sources: ["web"],
      scrapeOptions: {
        formats: ["markdown"],
      },
      timeout: 15000,
      limit: 2,
    });
    expect(response.results).toEqual([
      {
        title: "Search result",
        url: "https://example.com/search",
        snippet: "Search description",
        metadata: undefined,
      },
      {
        title: "Doc result",
        url: "https://example.com/doc",
        snippet: "Doc description",
        metadata: {
          metadata: {
            sourceURL: "https://example.com/doc",
            title: "Doc result",
            description: "Doc description",
          },
          markdown: "Doc markdown body",
        },
      },
    ]);
  });

  it("uses scrape for a single URL and prefers markdown content", async () => {
    firecrawlScrapeMock.mockResolvedValue({
      metadata: {
        sourceURL: "https://example.com/page",
        title: "Example Page",
      },
      markdown: "# Heading\n\nBody",
      summary: "Short summary",
      html: "<h1>Heading</h1><p>Body</p>",
    });

    const provider = new FirecrawlAdapter();
    const response = await provider.contents(
      ["https://example.com/page"],
      {
        enabled: true,
        apiKey: "literal-key",
        options: {
          scrape: {
            formats: ["markdown"],
            onlyMainContent: true,
          },
        },
      },
      { cwd: process.cwd() },
      {
        maxAge: 60_000,
      },
    );

    expect(firecrawlScrapeMock).toHaveBeenCalledWith(
      "https://example.com/page",
      {
        formats: ["markdown"],
        onlyMainContent: true,
        maxAge: 60_000,
      },
    );
    expect(response.answers).toEqual([
      {
        url: "https://example.com/page",
        content: "# Heading\n\nBody",
        summary: "Short summary",
        metadata: {
          metadata: {
            sourceURL: "https://example.com/page",
            title: "Example Page",
          },
          markdown: "# Heading\n\nBody",
          summary: "Short summary",
          html: "<h1>Heading</h1><p>Body</p>",
        },
      },
    ]);
  });

  it("uses batchScrape for multiple URLs and maps batch errors per URL", async () => {
    firecrawlBatchScrapeMock.mockResolvedValue({
      id: "batch-1",
      status: "completed",
      data: [
        {
          metadata: {
            sourceURL: "https://example.com/a",
            title: "Page A",
          },
          markdown: "Page A markdown",
        },
      ],
    });
    firecrawlBatchErrorsMock.mockResolvedValue({
      errors: [
        {
          url: "https://example.com/b",
          error: "Blocked by robots.txt",
        },
      ],
    });

    const provider = new FirecrawlAdapter();
    const response = await provider.contents(
      ["https://example.com/a", "https://example.com/b"],
      {
        enabled: true,
        apiKey: "literal-key",
        options: {
          scrape: {
            formats: ["markdown"],
            onlyMainContent: true,
          },
        },
      },
      { cwd: process.cwd() },
      undefined,
    );

    expect(firecrawlBatchScrapeMock).toHaveBeenCalledWith(
      ["https://example.com/a", "https://example.com/b"],
      {
        options: {
          formats: ["markdown"],
          onlyMainContent: true,
        },
      },
    );
    expect(firecrawlBatchErrorsMock).toHaveBeenCalledWith("batch-1");
    expect(response.answers).toEqual([
      {
        url: "https://example.com/a",
        content: "Page A markdown",
        metadata: {
          metadata: {
            sourceURL: "https://example.com/a",
            title: "Page A",
          },
          markdown: "Page A markdown",
        },
      },
      {
        url: "https://example.com/b",
        error: "Blocked by robots.txt",
      },
    ]);
  });
});
