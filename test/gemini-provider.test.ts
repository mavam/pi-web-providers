import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiAdapter } from "../src/providers/gemini.js";
import type { Gemini, ProviderContext } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function getContentText(
  response: {
    answers: Array<{
      content?: string;
      error?: string;
    }>;
  },
  index: number,
): string | undefined {
  return response.answers[index]?.content;
}

function getErrorText(
  response: { answers: Array<{ error?: string }> },
  index: number,
): string | undefined {
  return response.answers[index]?.error;
}

describe("GeminiAdapter search", () => {
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
      undefined,
    );

    expect(create).toHaveBeenCalledWith(
      {
        model: "gemini-2.5-flash",
        input: "example query",
        tools: [{ type: "google_search" }],
        generation_config: {
          tool_choice: "any",
        },
      },
      undefined,
    );
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
      undefined,
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
      undefined,
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(
      1,
      {
        model: "gemini-2.5-flash",
        input: "fallback query",
        tools: [{ type: "google_search" }],
        generation_config: {
          tool_choice: "any",
        },
      },
      undefined,
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      {
        model: "gemini-2.5-flash",
        input: "fallback query",
        tools: [{ type: "google_search" }],
      },
      undefined,
    );
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
      undefined,
    );

    expect(response.results).toEqual([
      {
        title: "One",
        url: "https://example.com/1",
        snippet: "",
      },
    ]);
  });

  it("forwards only model and generation_config for Gemini search", async () => {
    const create = vi.fn().mockResolvedValue({
      outputs: [
        {
          type: "google_search_result",
          result: [
            {
              title: "Configured",
              url: "https://example.com/configured",
            },
          ],
        },
      ],
    });

    const provider = createProvider({ interactions: { create } });
    await provider.search(
      "configured query",
      5,
      createConfig(),
      createContext(),
      {
        model: "gemini-2.5-pro",
        generation_config: {
          temperature: 0.1,
          tool_choice: "none",
        },
        background: true,
        store: true,
      },
    );

    expect(create).toHaveBeenCalledWith(
      {
        model: "gemini-2.5-pro",
        input: "configured query",
        tools: [{ type: "google_search" }],
        generation_config: {
          temperature: 0.1,
          tool_choice: "any",
        },
      },
      undefined,
    );
  });
});

describe("GeminiAdapter answer", () => {
  it("supports provider-specific request options for answers while keeping Google Search grounding enabled", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Grounded answer",
      candidates: [],
    });

    const provider = createProvider({ models: { generateContent } });
    await provider.answer("What changed?", createConfig(), createContext(), {
      model: "gemini-2.5-pro",
      config: {
        labels: {
          route: "answer",
        },
        temperature: 0.1,
        tools: [{ urlContext: {} }],
      },
    });

    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-2.5-pro",
      contents: "What changed?",
      config: {
        labels: {
          route: "answer",
        },
        temperature: 0.1,
        tools: [{ googleSearch: {} }],
      },
    });
  });

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
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.text).toContain(
      "Tenzir helps route and transform security telemetry.",
    );
    expect(response.text).toContain(
      "Sources:\n1. Tenzir overview\n2. Tenzir docs",
    );
    expect(response.text).toContain("   https://tenzir.com/docs");
    expect(response.text).not.toContain("vertexaisearch.cloud.google.com");
    expect(response.itemCount).toBe(2);
  });
});

describe("GeminiAdapter contents", () => {
  it("extracts URL content via urlContext and reports retrieval metadata", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "# Example Page\n\nThis is the main content of the page.",
      candidates: [
        {
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://example.com",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
              },
            ],
          },
        },
      ],
    });

    const provider = createProvider({ models: { generateContent } });
    const response = await provider.contents(
      ["https://example.com"],
      createConfig(),
      createContext(),
      undefined,
    );

    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-2.5-flash",
      contents: [expect.stringContaining("https://example.com")],
      config: {
        tools: [{ urlContext: {} }],
      },
    });
    expect(response.answers).toHaveLength(1);
    expect(getContentText(response, 0)).toContain(
      "This is the main content of the page.",
    );
    expect(getErrorText(response, 0)).toBeUndefined();
  });

  it("reports retrieval failures in the output", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Could not access the page.",
      candidates: [
        {
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://paywall.example.com",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_PAYWALL",
              },
            ],
          },
        },
      ],
    });

    const provider = createProvider({ models: { generateContent } });
    const response = await provider.contents(
      ["https://paywall.example.com"],
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.answers).toEqual([
      {
        url: "https://paywall.example.com",
        error: "URL_RETRIEVAL_STATUS_PAYWALL",
      },
    ]);
  });

  it("handles multiple URLs with mixed retrieval statuses", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: [
        "[[[URL]]]",
        "https://example.com/a",
        "[[[TITLE]]]",
        "Page A",
        "[[[BODY]]]",
        "Content from the first URL.",
        "[[[END]]]",
        "",
        "[[[URL]]]",
        "https://example.com/c",
        "[[[TITLE]]]",
        "Page C",
        "[[[BODY]]]",
        "Content from the third URL.",
        "[[[END]]]",
      ].join("\n"),
      candidates: [
        {
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://example.com/a",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
              },
              {
                retrievedUrl: "https://example.com/b",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_ERROR",
              },
              {
                retrievedUrl: "https://example.com/c",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
              },
            ],
          },
        },
      ],
    });

    const provider = createProvider({ models: { generateContent } });
    const response = await provider.contents(
      [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.answers).toEqual([
      {
        url: "https://example.com/a",
        content: "Content from the first URL.",
      },
      {
        url: "https://example.com/b",
        error: "URL_RETRIEVAL_STATUS_ERROR",
      },
      {
        url: "https://example.com/c",
        content: "Content from the third URL.",
      },
    ]);
  });

  it("marks successfully retrieved URLs as failed when Gemini returns only a partial structured response", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: [
        "[[[URL]]]",
        "https://example.com/a",
        "[[[TITLE]]]",
        "Page A",
        "[[[BODY]]]",
        "Content from the first URL.",
        "[[[END]]]",
        "",
        "https://example.com/b",
        "Page B",
        "Content from the second URL.",
      ].join("\n"),
      candidates: [
        {
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://example.com/a",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
              },
              {
                retrievedUrl: "https://example.com/b",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
              },
            ],
          },
        },
      ],
    });

    const provider = createProvider({ models: { generateContent } });
    const response = await provider.contents(
      ["https://example.com/a", "https://example.com/b"],
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.answers).toEqual([
      {
        url: "https://example.com/a",
        content: "Content from the first URL.",
      },
      {
        url: "https://example.com/b",
        error: "Gemini returned content for this URL in an unexpected format.",
      },
    ]);
  });

  it("passes provider-specific generateContent config for contents", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Result.",
      candidates: [],
    });

    const provider = createProvider({ models: { generateContent } });
    await provider.contents(
      ["https://example.com"],
      createConfig(),
      createContext(),
      {
        config: {
          temperature: 0.2,
        },
      },
    );

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          temperature: 0.2,
          tools: [{ urlContext: {} }],
        },
      }),
    );
  });

  it("supports provider-specific request options for contents while preserving urlContext", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Result.",
      candidates: [],
    });

    const provider = createProvider({ models: { generateContent } });
    await provider.contents(
      ["https://example.com"],
      createConfig(),
      createContext(),
      {
        model: "gemini-2.5-pro",
        config: {
          labels: {
            request_id: "contents-1",
          },
          topK: 3,
          tools: [{ googleSearch: {} }],
        },
      },
    );

    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-2.5-pro",
      contents: [expect.stringContaining("https://example.com")],
      config: {
        labels: {
          request_id: "contents-1",
        },
        topK: 3,
        tools: [{ urlContext: {} }],
      },
    });
  });

  it("falls back to the legacy prompt when the structured prompt returns nothing", async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        candidates: [],
      })
      .mockResolvedValueOnce({
        text: "# Example Page\n\nThis is the main content of the page.",
        candidates: [
          {
            urlContextMetadata: {
              urlMetadata: [
                {
                  retrievedUrl: "https://example.com",
                  urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
                },
              ],
            },
          },
        ],
      });

    const provider = createProvider({ models: { generateContent } });
    const response = await provider.contents(
      ["https://example.com"],
      createConfig(),
      createContext(),
      undefined,
    );

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(response.answers).toHaveLength(1);
    expect(getContentText(response, 0)).toContain(
      "This is the main content of the page.",
    );
  });

  it("throws on an empty response so the caller can retry", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "",
      candidates: [],
    });

    const provider = createProvider({ models: { generateContent } });

    await expect(
      provider.contents(
        ["https://example.com"],
        createConfig(),
        createContext(),
        undefined,
      ),
    ).rejects.toThrow(
      "Gemini returned an empty URL Context response. Retrying may succeed.",
    );
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("throws on empty text even when urlContext reports a successful retrieval", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "",
      candidates: [
        {
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://example.com",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS",
              },
            ],
          },
        },
      ],
    });

    const provider = createProvider({ models: { generateContent } });

    await expect(
      provider.contents(
        ["https://example.com"],
        createConfig(),
        createContext(),
        undefined,
      ),
    ).rejects.toThrow(
      "Gemini returned an empty URL Context response. Retrying may succeed.",
    );
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("keeps surfacing retrieval failures when Gemini returns no text", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "",
      candidates: [
        {
          urlContextMetadata: {
            urlMetadata: [
              {
                retrievedUrl: "https://paywall.example.com",
                urlRetrievalStatus: "URL_RETRIEVAL_STATUS_PAYWALL",
              },
            ],
          },
        },
      ],
    });

    const provider = createProvider({ models: { generateContent } });
    const response = await provider.contents(
      ["https://paywall.example.com"],
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.answers).toEqual([
      {
        url: "https://paywall.example.com",
        error: "URL_RETRIEVAL_STATUS_PAYWALL",
      },
    ]);
  });
});

describe("GeminiAdapter research", () => {
  it("starts Gemini deep research and forwards provider-specific request options", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });

    const provider = createProvider({
      interactions: {
        create,
      },
    });

    const job = await provider.startResearch!(
      "Investigate Tenzir use cases",
      createConfig(),
      { ...createContext(), idempotencyKey: "stable-key" },
      {
        agent_config: {
          response_length: "short",
        },
        store: true,
        response_format: {
          type: "json_schema",
        },
        response_modalities: ["TEXT"],
        system_instruction: "Focus on official sources.",
        tools: [{ urlContext: {} }],
        agent: "override-agent",
        background: false,
        input: "override",
      },
    );

    expect(job).toEqual({ id: "research-1" });
    expect(create).toHaveBeenCalledWith(
      {
        agent_config: {
          response_length: "short",
        },
        store: true,
        response_format: {
          type: "json_schema",
        },
        response_modalities: ["TEXT"],
        system_instruction: "Focus on official sources.",
        tools: [{ urlContext: {} }],
        input: "Investigate Tenzir use cases",
        agent: "deep-research-pro-preview-12-2025",
        background: true,
      },
      { idempotencyKey: "stable-key" },
    );
  });

  it("returns in-progress Gemini research status from polling", async () => {
    const get = vi.fn().mockResolvedValue({ status: "in_progress" });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(get).toHaveBeenCalledWith("research-1", undefined, undefined);
    expect(result).toEqual({ status: "in_progress" });
  });

  it("formats completed Gemini research output from polling", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "completed",
      outputs: [{ type: "text", text: "Research result" }],
    });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(result).toEqual({
      status: "completed",
      output: {
        provider: "gemini",
        text: "Research result",
      },
    });
  });

  it("maps failed Gemini research polling to a terminal status", async () => {
    const get = vi.fn().mockResolvedValue({ status: "failed" });

    const provider = createProvider({
      interactions: {
        get,
      },
    });

    const result = await provider.pollResearch!(
      "research-1",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(result).toEqual({
      status: "failed",
      error: "Gemini research failed.",
    });
  });
});

function createProvider(client: unknown): GeminiAdapter {
  const provider = new GeminiAdapter() as any;
  provider.createClient = () => client;
  return provider as GeminiAdapter;
}

function createConfig(): Gemini {
  return {
    enabled: true,
    apiKey: "literal-key",
    options: {
      searchModel: "gemini-2.5-flash",
    },
  };
}

function createContext(): ProviderContext {
  return {
    cwd: process.cwd(),
  };
}
