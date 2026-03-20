import { afterEach, describe, expect, it, vi } from "vitest";

const { searchCreateMock, chatCreateMock, perplexityCtorMock } = vi.hoisted(
  () => ({
    searchCreateMock: vi.fn(),
    chatCreateMock: vi.fn(),
    perplexityCtorMock: vi.fn(),
  }),
);

vi.mock("@perplexity-ai/perplexity_ai", () => ({
  default: perplexityCtorMock.mockImplementation(function MockPerplexity() {
    return {
      search: {
        create: searchCreateMock,
      },
      chat: {
        completions: {
          create: chatCreateMock,
        },
      },
    };
  }),
}));

import { PerplexityAdapter } from "../src/providers/perplexity.js";

afterEach(() => {
  delete process.env.PERPLEXITY_API_KEY;
  searchCreateMock.mockReset();
  chatCreateMock.mockReset();
  perplexityCtorMock.mockClear();
});

describe("PerplexityAdapter", () => {
  it("forwards merged search options and preserves date metadata", async () => {
    process.env.PERPLEXITY_API_KEY = "test-key";
    searchCreateMock.mockResolvedValue({
      results: [
        {
          title: "Energy policy",
          url: "https://example.com/policy",
          snippet: "Recent policy changes",
          date: "2026-03-01",
          last_updated: "2026-03-05",
        },
      ],
    });

    const provider = new PerplexityAdapter();
    const response = await provider.search(
      "government policies on renewable energy",
      5,
      {
        country: "US",
        max_results: 99,
      },
      {
        enabled: true,
        apiKey: "PERPLEXITY_API_KEY",
        options: {
          search: {
            search_mode: "academic",
          },
        },
      },
      { cwd: process.cwd() },
    );

    expect(perplexityCtorMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: undefined,
    });
    expect(searchCreateMock).toHaveBeenCalledWith(
      {
        search_mode: "academic",
        country: "US",
        query: "government policies on renewable energy",
        max_results: 5,
      },
      undefined,
    );
    expect(response.results).toEqual([
      {
        title: "Energy policy",
        url: "https://example.com/policy",
        snippet: "Recent policy changes",
        metadata: {
          date: "2026-03-01",
          last_updated: "2026-03-05",
        },
      },
    ]);
  });

  it("defaults answer calls to sonar and dedupes repeated sources", async () => {
    process.env.PERPLEXITY_API_KEY = "test-key";
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Perplexity answer",
          },
        },
      ],
      search_results: [
        {
          title: "Source A",
          url: "https://example.com/a",
        },
        {
          title: "Source A",
          url: "https://example.com/a",
        },
      ],
    });

    const provider = new PerplexityAdapter();
    const response = await provider.answer(
      "What changed?",
      { country: "US" },
      {
        enabled: true,
        apiKey: "PERPLEXITY_API_KEY",
      },
      { cwd: process.cwd() },
    );

    expect(chatCreateMock).toHaveBeenCalledWith(
      {
        country: "US",
        messages: [{ role: "user", content: "What changed?" }],
        model: "sonar",
        stream: false,
      },
      undefined,
    );
    expect(response.text).toBe(
      "Perplexity answer\n\nSources:\n1. Source A\n   https://example.com/a",
    );
    expect(response.itemCount).toBe(1);
  });

  it("streams research calls with sonar-deep-research", async () => {
    process.env.PERPLEXITY_API_KEY = "test-key";
    chatCreateMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                role: "assistant",
                content: "Research ",
              },
              message: {
                role: "assistant",
                content: null,
              },
            },
          ],
        };
        yield {
          choices: [
            {
              delta: {
                role: "assistant",
                content: "result",
              },
              message: {
                role: "assistant",
                content: [{ type: "text", text: "Research result" }],
              },
            },
          ],
          citations: ["https://example.com/research"],
        };
      },
    });

    const provider = new PerplexityAdapter();
    const response = await provider.research(
      "Investigate the topic",
      undefined,
      {
        enabled: true,
        apiKey: "PERPLEXITY_API_KEY",
      },
      {
        cwd: process.cwd(),
      },
    );

    expect(chatCreateMock).toHaveBeenCalledWith(
      {
        messages: [{ role: "user", content: "Investigate the topic" }],
        model: "sonar-deep-research",
        stream: true,
      },
      undefined,
    );
    expect(response.text).toBe(
      "Research result\n\nSources:\n1. https://example.com/research\n   https://example.com/research",
    );
    expect(response.itemCount).toBe(1);
  });

  it("falls back to citations when search_results is empty", async () => {
    process.env.PERPLEXITY_API_KEY = "test-key";
    chatCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Answer with citations fallback",
          },
        },
      ],
      search_results: [],
      citations: ["https://example.com/fallback"],
    });

    const provider = new PerplexityAdapter();
    const response = await provider.answer(
      "What changed?",
      undefined,
      {
        enabled: true,
        apiKey: "PERPLEXITY_API_KEY",
      },
      { cwd: process.cwd() },
    );

    expect(response.text).toBe(
      "Answer with citations fallback\n\nSources:\n1. https://example.com/fallback\n   https://example.com/fallback",
    );
    expect(response.itemCount).toBe(1);
  });
});
