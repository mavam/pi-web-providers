import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../src/providers/gemini.js";
import type { GeminiProviderConfig, ProviderContext } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GeminiProvider search", () => {
  it("forces Google Search via interactions and returns search results", async () => {
    const create = vi.fn().mockResolvedValue({
      outputs: [
        {
          type: "google_search_result",
          result: [
            {
              title: "Alpha",
              url: "https://example.com/alpha",
              rendered_content: "Alpha snippet",
            },
            {
              title: "Beta",
              url: "https://example.com/beta",
              rendered_content: "Beta snippet",
            },
          ],
        },
      ],
    });

    const provider = createProvider({ interactions: { create } });
    const response = await provider.search(
      "example query",
      5,
      createConfig(),
      createContext(),
    );

    expect(create).toHaveBeenCalledWith({
      model: "gemini-2.5-flash",
      input: "example query",
      tools: [{ type: "google_search" }],
      generation_config: {
        tool_choice: "any",
      },
    });
    expect(response.results).toEqual([
      {
        title: "Alpha",
        url: "https://example.com/alpha",
        snippet: "",
      },
      {
        title: "Beta",
        url: "https://example.com/beta",
        snippet: "",
      },
    ]);
  });

  it("resolves Google grounding redirects and drops unusable snippets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        headers: new Headers({
          location: "https://tenzir.com/use-cases",
        }),
      }),
    );

    const provider = createProvider({
      interactions: {
        create: vi.fn().mockResolvedValue({
          outputs: [
            {
              type: "google_search_result",
              result: [
                {
                  title: "Tenzir",
                  url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque",
                  rendered_content:
                    "<style>.x{display:none}</style><div>Tenzir &amp; Security</div><svg><text>noise</text></svg><p>Flexible operations</p>",
                },
              ],
            },
          ],
        }),
      },
    });

    const response = await provider.search(
      "tenzir",
      5,
      createConfig(),
      createContext(),
    );

    expect(response.results).toEqual([
      {
        title: "Tenzir",
        url: "https://tenzir.com/use-cases",
        snippet: "",
      },
    ]);
  });

  it("retries without tool_choice when Gemini rejects built-in tool forcing", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          '400 {"error":{"message":"Function calling config is set without function_declarations.","code":"invalid_request"}}',
        ),
      )
      .mockResolvedValueOnce({
        outputs: [
          {
            type: "google_search_result",
            result: [
              {
                title: "Fallback",
                url: "https://example.com/fallback",
                rendered_content: "Fallback snippet",
              },
            ],
          },
        ],
      });

    const provider = createProvider({ interactions: { create } });
    const response = await provider.search(
      "fallback query",
      5,
      createConfig(),
      createContext(),
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, {
      model: "gemini-2.5-flash",
      input: "fallback query",
      tools: [{ type: "google_search" }],
      generation_config: {
        tool_choice: "any",
      },
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      model: "gemini-2.5-flash",
      input: "fallback query",
      tools: [{ type: "google_search" }],
    });
    expect(response.results).toEqual([
      {
        title: "Fallback",
        url: "https://example.com/fallback",
        snippet: "",
      },
    ]);
  });

  it("caps Gemini search results by maxResults", async () => {
    const provider = createProvider({
      interactions: {
        create: vi.fn().mockResolvedValue({
          outputs: [
            {
              type: "google_search_result",
              result: [
                {
                  title: "One",
                  url: "https://example.com/1",
                  rendered_content: "One",
                },
                {
                  title: "Two",
                  url: "https://example.com/2",
                  rendered_content: "Two",
                },
              ],
            },
          ],
        }),
      },
    });

    const response = await provider.search(
      "example query",
      1,
      createConfig(),
      createContext(),
    );

    expect(response.results).toEqual([
      {
        title: "One",
        url: "https://example.com/1",
        snippet: "",
      },
    ]);
  });
});

describe("GeminiProvider answer", () => {
  it("suppresses opaque grounding redirect URLs and dedupes source display", async () => {
    const provider = createProvider({
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "Tenzir helps route and transform security telemetry.",
          candidates: [
            {
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      title: "Tenzir overview",
                      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-1",
                    },
                  },
                  {
                    web: {
                      title: "Tenzir docs",
                      uri: "https://tenzir.com/docs",
                    },
                  },
                  {
                    web: {
                      title: "Tenzir overview",
                      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-2",
                    },
                  },
                ],
              },
            },
          ],
        }),
      },
    });

    const response = await provider.answer(
      "Tenzir use cases",
      undefined,
      createConfig(),
      createContext(),
    );

    expect(response.text).toContain(
      "Tenzir helps route and transform security telemetry.",
    );
    expect(response.text).toContain(
      "Sources:\n1. Tenzir overview\n2. Tenzir docs",
    );
    expect(response.text).toContain("   https://tenzir.com/docs");
    expect(response.text).not.toContain("vertexaisearch.cloud.google.com");
    expect(response.summary).toBe("Answer via Gemini with 2 source(s)");
    expect(response.itemCount).toBe(2);
  });
});

describe("GeminiProvider research", () => {
  it("emits elapsed-time heartbeats while research stays in progress", async () => {
    vi.useFakeTimers();

    try {
      const get = vi
        .fn()
        .mockResolvedValueOnce({
          status: "in_progress",
        })
        .mockResolvedValueOnce({
          status: "in_progress",
        })
        .mockResolvedValueOnce({
          status: "in_progress",
        })
        .mockResolvedValueOnce({
          status: "in_progress",
        })
        .mockResolvedValueOnce({
          status: "completed",
          outputs: [{ type: "text", text: "Research result" }],
        });

      const provider = createProvider({
        interactions: {
          create: vi.fn().mockResolvedValue({ id: "research-1" }),
          get,
        },
      });
      const messages: string[] = [];

      const promise = provider.research(
        "Investigate Tenzir use cases",
        { pollIntervalMs: 5000 },
        createConfig(),
        {
          ...createContext(),
          onProgress: (message) => messages.push(message),
        },
      );

      await vi.advanceTimersByTimeAsync(20000);
      const response = await promise;

      expect(response.text).toBe("Research result");
      expect(messages).toContain("Starting Gemini deep research");
      expect(messages).toContain("Gemini research started: research-1");
      expect(messages).toContain(
        "Gemini research status: in_progress (0s elapsed)",
      );
      expect(messages).toContain(
        "Gemini research status: completed (20s elapsed)",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

function createProvider(client: unknown): GeminiProvider {
  const provider = new GeminiProvider() as any;
  provider.createClient = () => client;
  return provider as GeminiProvider;
}

function createConfig(): GeminiProviderConfig {
  return {
    enabled: true,
    apiKey: "literal-key",
    defaults: {
      searchModel: "gemini-2.5-flash",
    },
  };
}

function createContext(): ProviderContext {
  return {
    cwd: process.cwd(),
  };
}
