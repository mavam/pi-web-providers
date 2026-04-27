import { afterEach, describe, expect, it, vi } from "vitest";

const { firecrawlCtorMock, firecrawlScrapeMock, firecrawlSearchMock } =
  vi.hoisted(() => ({
    firecrawlCtorMock: vi.fn(),
    firecrawlScrapeMock: vi.fn(),
    firecrawlSearchMock: vi.fn(),
  }));

vi.mock("@mendable/firecrawl-js", () => ({
  default: firecrawlCtorMock.mockImplementation(function MockFirecrawl() {
    return {
      search: firecrawlSearchMock,
      scrape: firecrawlScrapeMock,
    };
  }),
}));

import { firecrawlProvider } from "../src/providers/firecrawl.js";
import { providerHarness } from "./provider-harness.js";

afterEach(() => {
  delete process.env.FIRECRAWL_API_KEY;
  firecrawlCtorMock.mockClear();
  firecrawlSearchMock.mockReset();
  firecrawlScrapeMock.mockReset();
});

describe("providerHarness(firecrawlProvider)", () => {
  it("merges search options and maps results", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";

    firecrawlSearchMock.mockResolvedValue({
      web: [
        {
          title: "Firecrawl Docs",
          url: "https://docs.firecrawl.dev",
          description: "Official documentation",
          category: "research",
        },
        {
          markdown: "# Deep scrape\n\n" + "A".repeat(400),
          metadata: {
            title: "Scraped result",
            sourceURL: "https://example.com/scraped",
            description: "Structured scrape",
          },
        },
      ],
      news: [
        {
          title: "Firecrawl launches feature",
          url: "https://news.example.com/firecrawl",
          snippet: "Launch coverage",
          date: "2026-04-01",
        },
      ],
      images: [
        {
          title: "Firecrawl logo",
          imageUrl: "https://example.com/logo.png",
          position: 1,
        },
      ],
    });

    const response = await providerHarness(firecrawlProvider).search(
      "firecrawl sdk",
      4,
      {
        apiKey: "FIRECRAWL_API_KEY",
        baseUrl: "https://api.firecrawl.test",
        options: {
          search: {
            sources: ["web", "news"],
            timeout: 15,
          },
        },
      },
      { cwd: process.cwd() },
      {
        location: "us",
        limit: 99,
      },
    );

    expect(firecrawlCtorMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      apiUrl: "https://api.firecrawl.test",
    });
    expect(firecrawlSearchMock).toHaveBeenCalledWith("firecrawl sdk", {
      sources: ["web", "news"],
      timeout: 15,
      location: "us",
      limit: 4,
    });
    expect(response.results).toHaveLength(4);
    expect(response.results[0]).toEqual({
      title: "Firecrawl Docs",
      url: "https://docs.firecrawl.dev",
      snippet: "Official documentation",
      metadata: {
        source: "web",
        category: "research",
      },
    });
    expect(response.results[1]).toMatchObject({
      title: "Scraped result",
      url: "https://example.com/scraped",
      metadata: {
        source: "web",
        title: "Scraped result",
        sourceURL: "https://example.com/scraped",
        description: "Structured scrape",
      },
    });
    expect(response.results[1]?.snippet).toMatch(/^# Deep scrape A+/);
    expect(response.results[1]?.snippet.endsWith("…")).toBe(true);
    expect(response.results[2]).toEqual({
      title: "Firecrawl launches feature",
      url: "https://news.example.com/firecrawl",
      snippet: "Launch coverage",
      metadata: {
        source: "news",
        date: "2026-04-01",
      },
    });
    expect(response.results[3]).toEqual({
      title: "Firecrawl logo",
      url: "https://example.com/logo.png",
      snippet: "",
      metadata: {
        source: "images",
        imageUrl: "https://example.com/logo.png",
        position: 1,
      },
    });
  });

  it("preserves URL order for contents, merges scrape options, and surfaces per-URL failures", async () => {
    firecrawlScrapeMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/a") {
        return {
          markdown: "# Page A\n\nBody A",
          metadata: {
            title: "Page A",
            sourceURL: "https://example.com/a?ref=firecrawl",
          },
          links: ["https://example.com/a/child"],
        };
      }
      if (url === "https://example.com/b") {
        throw new Error("blocked by robots");
      }
      return {
        json: {
          title: "Page C",
          items: [1, 2, 3],
        },
        metadata: {
          title: "Page C",
        },
      };
    });

    const response = await providerHarness(firecrawlProvider).contents(
      [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
      {
        apiKey: "literal-key",
        options: {
          scrape: {
            formats: ["markdown"],
            waitFor: 500,
          },
        },
      },
      { cwd: process.cwd() },
      {
        formats: ["html"],
        mobile: true,
      },
    );

    expect(firecrawlCtorMock).toHaveBeenCalledWith({
      apiKey: "literal-key",
      apiUrl: undefined,
    });
    expect(firecrawlScrapeMock).toHaveBeenNthCalledWith(
      1,
      "https://example.com/a",
      {
        formats: ["html"],
        onlyMainContent: true,
        waitFor: 500,
        mobile: true,
      },
    );
    expect(firecrawlScrapeMock).toHaveBeenNthCalledWith(
      2,
      "https://example.com/b",
      {
        formats: ["html"],
        onlyMainContent: true,
        waitFor: 500,
        mobile: true,
      },
    );
    expect(firecrawlScrapeMock).toHaveBeenNthCalledWith(
      3,
      "https://example.com/c",
      {
        formats: ["html"],
        onlyMainContent: true,
        waitFor: 500,
        mobile: true,
      },
    );
    expect(response.answers).toEqual([
      {
        url: "https://example.com/a",
        content: "# Page A\n\nBody A",
        metadata: {
          title: "Page A",
          sourceURL: "https://example.com/a?ref=firecrawl",
        },
      },
      {
        url: "https://example.com/b",
        error: "blocked by robots",
      },
      {
        url: "https://example.com/c",
        content: JSON.stringify(
          {
            title: "Page C",
            items: [1, 2, 3],
          },
          null,
          2,
        ),
        metadata: {
          title: "Page C",
        },
      },
    ]);
  });
});
