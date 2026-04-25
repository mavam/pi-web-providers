import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiAdapter } from "../src/providers/gemini.js";
import type { Gemini, ProviderContext } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
          location: "https://example.com/use-cases",
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
                  title: "Example Security",
                  url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque",
                  rendered_content:
                    "<style>.x{display:none}</style><div>Example &amp; Security</div><svg><text>noise</text></svg><p>Flexible operations</p>",
                },
              ],
            },
          ],
        }),
      },
    });

    const response = await provider.search(
      "ACME products",
      5,
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.results).toEqual([
      {
        title: "Example Security",
        url: "https://example.com/use-cases",
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

  it("extracts title and URL from rendered content when Gemini omits structured fields", async () => {
    const provider = createProvider({
      interactions: {
        create: vi.fn().mockResolvedValue({
          outputs: [
            {
              type: "google_search_result",
              result: [
                {
                  renderedContent:
                    '<div class="result"><a href="https://example.com/use-cases" aria-label="ACME platform use cases">ACME platform &amp; use cases</a></div>',
                },
              ],
            },
          ],
        }),
      },
    });

    const response = await provider.search(
      "ACME platform use cases",
      5,
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.results).toEqual([
      {
        title: "ACME platform & use cases",
        url: "https://example.com/use-cases",
        snippet: "",
      },
    ]);
  });

  it("skips empty Gemini search result placeholders", async () => {
    const provider = createProvider({
      interactions: {
        create: vi.fn().mockResolvedValue({
          outputs: [
            {
              type: "google_search_result",
              result: [
                {},
                {
                  title: "Alpha",
                  uri: "https://example.com/alpha",
                },
              ],
            },
          ],
        }),
      },
    });

    const response = await provider.search(
      "example query",
      5,
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.results).toEqual([
      {
        title: "Alpha",
        url: "https://example.com/alpha",
        snippet: "",
      },
    ]);
  });

  it("extracts suggestion chips when Gemini only returns search_suggestions HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          headers: new Headers({
            location: "https://platform.openai.com/docs/overview",
          }),
        })
        .mockResolvedValueOnce({
          headers: new Headers({
            location: "https://platform.openai.com/docs/introduction",
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
                  search_suggestions:
                    '<div><a class="chip" href="https://vertexaisearch.cloud.google.com/grounding-api-redirect/a">OpenAI API overview</a><a class="chip" href="https://vertexaisearch.cloud.google.com/grounding-api-redirect/b">OpenAI API docs</a></div>',
                },
              ],
            },
          ],
        }),
      },
    });

    const response = await provider.search(
      "OpenAI API",
      5,
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.results).toEqual([
      {
        title: "OpenAI API overview",
        url: "https://platform.openai.com/docs/overview",
        snippet: "",
      },
      {
        title: "OpenAI API docs",
        url: "https://platform.openai.com/docs/introduction",
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
          text: "ACME platforms help teams route and transform operational data.",
          candidates: [
            {
              groundingMetadata: {
                groundingChunks: [
                  {
                    web: {
                      title: "ACME overview",
                      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-1",
                    },
                  },
                  {
                    web: {
                      title: "ACME docs",
                      uri: "https://example.com/docs",
                    },
                  },
                  {
                    web: {
                      title: "ACME overview",
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
      "ACME platform use cases",
      createConfig(),
      createContext(),
      undefined,
    );

    expect(response.text).toContain(
      "ACME platforms help teams route and transform operational data.",
    );
    expect(response.text).toContain("Sources:\n1. ACME overview\n2. ACME docs");
    expect(response.text).toContain("   https://example.com/docs");
    expect(response.text).not.toContain("vertexaisearch.cloud.google.com");
    expect(response.itemCount).toBe(2);
  });
});

it("does not expose a contents handler", () => {
  expect(geminiAdapter.contents).toBeUndefined();
});

describe("GeminiAdapter research", () => {
  it("starts Gemini deep research with supported request options", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });

    const provider = createProvider({
      interactions: {
        create,
      },
    });

    const job = await provider.startResearch!(
      "Investigate ACME platform use cases",
      createConfig(),
      { ...createContext(), idempotencyKey: "stable-key" },
      undefined,
    );

    expect(job).toEqual({ id: "research-1" });
    expect(create).toHaveBeenCalledWith(
      {
        input: "Investigate ACME platform use cases",
        agent: "deep-research-pro-preview-12-2025",
        background: true,
      },
      { idempotencyKey: "stable-key" },
    );
  });

  it("rejects unsupported Gemini deep-research options", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });
    const provider = createProvider({ interactions: { create } });

    await expect(
      provider.startResearch!(
        "Investigate ACME platform use cases",
        createConfig(),
        createContext(),
        { tools: [] },
      ),
    ).rejects.toThrow("Unsupported Gemini research options: tools.");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unsupported Gemini deep-research agent configuration", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });
    const provider = createProvider({ interactions: { create } });

    await expect(
      provider.startResearch!(
        "Investigate ACME platform use cases",
        createConfig(),
        createContext(),
        {
          agent_config: {
            response_length: "short",
          },
        },
      ),
    ).rejects.toThrow(
      "Unsupported Gemini agent_config options: response_length.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("forwards supported Gemini deep-research agent configuration", async () => {
    const create = vi.fn().mockResolvedValue({ id: "research-1" });

    const provider = createProvider({
      interactions: {
        create,
      },
    });

    await provider.startResearch!(
      "Investigate ACME platform use cases",
      createConfig(),
      createContext(),
      {
        agent_config: {
          thinking_summaries: "auto",
        },
      },
    );

    expect(create).toHaveBeenCalledWith(
      {
        agent_config: {
          type: "deep-research",
          thinking_summaries: "auto",
        },
        input: "Investigate ACME platform use cases",
        agent: "deep-research-pro-preview-12-2025",
        background: true,
      },
      undefined,
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
      error: "research failed",
    });
  });

  it("surfaces unknown Gemini research states as progress text", async () => {
    const get = vi.fn().mockResolvedValue({ status: "running" });

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
      status: "in_progress",
      statusText: "running",
    });
  });

  it("treats incomplete Gemini research as terminal failure", async () => {
    const get = vi.fn().mockResolvedValue({ status: "incomplete" });

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
      error: "research ended incomplete",
    });
  });

  it("treats requires_action Gemini research as terminal failure", async () => {
    const get = vi.fn().mockResolvedValue({
      status: "requires_action",
      outputs: [{ type: "function_call" }],
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
      status: "failed",
      error: "research requires additional action (function_call)",
    });
  });
});

function createProvider(client: unknown) {
  return {
    ...geminiAdapter,
    createClient: () => client,
  } as typeof geminiAdapter;
}

function createConfig(): Gemini {
  return {
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
