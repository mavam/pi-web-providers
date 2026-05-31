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
  vi.unstubAllGlobals();
});

describe("providerHarness(firecrawlProvider)", () => {
  it("reports ready for a custom base URL without an API key", () => {
    expect(
      firecrawlProvider.getCapabilityStatus(
        {
          baseUrl: "http://localhost:3002",
        },
        process.cwd(),
      ),
    ).toEqual({ state: "ready" });
  });

  it("reports missing_api_key for Firecrawl Cloud without an API key", () => {
    expect(firecrawlProvider.getCapabilityStatus({}, process.cwd())).toEqual({
      state: "missing_api_key",
    });
    expect(
      firecrawlProvider.getCapabilityStatus(
        {
          baseUrl: "https://api.firecrawl.dev",
        },
        process.cwd(),
      ),
    ).toEqual({ state: "missing_api_key" });
  });

  it("searches with a custom base URL without an API key", async () => {
    firecrawlSearchMock.mockResolvedValue({ web: [] });

    const response = await providerHarness(firecrawlProvider).search(
      "firecrawl sdk",
      4,
      {
        baseUrl: "http://localhost:3002",
      },
      { cwd: process.cwd() },
    );

    expect(firecrawlCtorMock).toHaveBeenCalledWith({
      apiKey: undefined,
      apiUrl: "http://localhost:3002",
    });
    expect(firecrawlSearchMock).toHaveBeenCalledWith("firecrawl sdk", {
      limit: 4,
    });
    expect(response.results).toEqual([]);
  });

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
        credentials: { api: "FIRECRAWL_API_KEY" },
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
        credentials: { api: "literal-key" },
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

  it("answers a question about one URL using Firecrawl's question scrape format", async () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            answer: "The page says Firecrawl supports question scraping.",
            metadata: {
              title: "Firecrawl Docs",
            },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await providerHarness(firecrawlProvider).answer(
      "What does the page say about question scraping?",
      {
        credentials: { api: "FIRECRAWL_API_KEY" },
        options: {
          scrape: {
            formats: ["markdown"],
            onlyMainContent: false,
            waitFor: 100,
          },
          answer: {
            url: "https://docs.firecrawl.dev/features/scrape",
            mobile: true,
          },
        },
      },
      { cwd: process.cwd() },
      {
        url: "https://docs.firecrawl.dev/features/scrape#question-format",
        waitFor: 250,
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.firecrawl.dev/v2/scrape",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        },
        body: JSON.stringify({
          onlyMainContent: false,
          waitFor: 250,
          mobile: true,
          url: "https://docs.firecrawl.dev/features/scrape#question-format",
          formats: [
            {
              type: "question",
              question: "What does the page say about question scraping?",
            },
          ],
        }),
      },
    );
    expect(response).toEqual({
      provider: "firecrawl",
      text: "The page says Firecrawl supports question scraping.",
      itemCount: 1,
      metadata: {
        url: "https://docs.firecrawl.dev/features/scrape#question-format",
        metadata: {
          title: "Firecrawl Docs",
        },
      },
    });
  });

  it("requires a URL for Firecrawl answers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      providerHarness(firecrawlProvider).answer(
        "What does this page say?",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow("Firecrawl answer requires options.url.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a non-empty Firecrawl answer question", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      providerHarness(firecrawlProvider).answer(
        "   ",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        { url: "https://example.com" },
      ),
    ).rejects.toThrow("question must be a non-empty string.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Firecrawl answer questions over 10000 characters", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      providerHarness(firecrawlProvider).answer(
        "A".repeat(10_001),
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        { url: "https://example.com" },
      ),
    ).rejects.toThrow("Firecrawl question must be at most 10000 characters.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates Firecrawl answer API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            error: "question format is unavailable",
          }),
          { status: 400, statusText: "Bad Request" },
        ),
      ),
    );

    await expect(
      providerHarness(firecrawlProvider).answer(
        "What changed?",
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        { url: "https://example.com" },
      ),
    ).rejects.toThrow("question format is unavailable");
  });
});
