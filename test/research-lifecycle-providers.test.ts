import { afterEach, describe, expect, it, vi } from "vitest";

const {
  exaCtorMock,
  exaSearchMock,
  openaiCtorMock,
  openaiResponsesCreateMock,
  openaiResponsesRetrieveMock,
  valyuCtorMock,
  valyuDeepResearchCreateMock,
  valyuDeepResearchStatusMock,
} = vi.hoisted(() => ({
  exaCtorMock: vi.fn(),
  exaSearchMock: vi.fn(),
  openaiCtorMock: vi.fn(),
  openaiResponsesCreateMock: vi.fn(),
  openaiResponsesRetrieveMock: vi.fn(),
  valyuCtorMock: vi.fn(),
  valyuDeepResearchCreateMock: vi.fn(),
  valyuDeepResearchStatusMock: vi.fn(),
}));

vi.mock("exa-js", () => ({
  Exa: exaCtorMock.mockImplementation(function MockExa() {
    return {
      search: exaSearchMock,
    };
  }),
}));

vi.mock("valyu-js", () => ({
  Valyu: valyuCtorMock.mockImplementation(function MockValyu() {
    return {
      deepresearch: {
        create: valyuDeepResearchCreateMock,
        status: valyuDeepResearchStatusMock,
      },
    };
  }),
}));

vi.mock("openai", () => {
  const MockOpenAI = openaiCtorMock.mockImplementation(function MockOpenAI() {
    return {
      responses: {
        create: openaiResponsesCreateMock,
        retrieve: openaiResponsesRetrieveMock,
      },
    };
  });

  return {
    default: MockOpenAI,
    OpenAI: MockOpenAI,
  };
});

import { createWebfox, type WebfoxConfig } from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
  exaCtorMock.mockClear();
  exaSearchMock.mockReset();
  openaiCtorMock.mockClear();
  openaiResponsesCreateMock.mockReset();
  openaiResponsesRetrieveMock.mockReset();
  valyuCtorMock.mockClear();
  valyuDeepResearchCreateMock.mockReset();
  valyuDeepResearchStatusMock.mockReset();
});

describe("OpenAI provider", () => {
  it("uses structured outputs for web search", async () => {
    openaiResponsesCreateMock.mockResolvedValue({
      id: "resp_search_1",
      model: "gpt-4.1",
      status: "completed",
      output_text: JSON.stringify({
        sources: [
          {
            title: "OpenAI Deep Research docs",
            url: "https://platform.openai.com/docs/guides/deep-research",
            snippet: "Official guide for OpenAI deep research.",
          },
        ],
      }),
      output: [],
      error: null,
      incomplete_details: null,
    });

    const result = await createWebfox({
      config: {
        providers: {
          openai: {
            credentials: { api: { value: "literal-key" } },
            options: {
              search: {
                model: "gpt-4.1",
              },
            },
          },
        },
      } satisfies WebfoxConfig,
    }).search({
      provider: "openai",
      options: {
        instructions: "Prefer official sources.",
        allowedDomains: ["platform.openai.com"],
        searchContextSize: "high",
        userLocation: {
          country: "US",
          region: "California",
        },
      },
      maxResults: 3,
      queries: ["openai deep research"],
    });

    expect(openaiCtorMock).toHaveBeenCalledWith({
      maxRetries: 0,
      apiKey: "literal-key",
    });
    expect(openaiResponsesCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
      {
        model: "gpt-4.1",
        input: [
          "Search the public web and return only the most relevant sources for the user's query.",
          "Return at most 3 sources.",
          "Prefer official, primary, or highly reputable sources when available.",
          "Each snippet should be short, specific, and grounded in the retrieved source.",
          "Return only data matching the provided JSON schema.",
          "",
          "User query: openai deep research",
        ].join("\n"),
        tools: [
          {
            type: "web_search",
            filters: { allowed_domains: ["platform.openai.com"] },
            search_context_size: "high",
            user_location: {
              type: "approximate",
              country: "US",
              region: "California",
            },
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "openai_web_search_results",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["sources"],
              properties: {
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["title", "url", "snippet"],
                    properties: {
                      title: { type: "string" },
                      url: { type: "string" },
                      snippet: { type: "string" },
                    },
                  },
                },
              },
            },
            strict: true,
          },
        },
        instructions: "Prefer official sources.",
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.status).toBe("ok");
    expect(successful(result.results[0])?.results[0]).toMatchObject({
      title: "OpenAI Deep Research docs",
      url: "https://platform.openai.com/docs/guides/deep-research",
    });
  });

  it("uses web search for grounded answers and preserves citations", async () => {
    openaiResponsesCreateMock.mockResolvedValue({
      id: "resp_answer_1",
      model: "gpt-4.1",
      status: "completed",
      output_text: "OpenAI grounded answer",
      output: [
        {
          id: "msg_answer_1",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "OpenAI grounded answer",
              annotations: [
                {
                  type: "url_citation",
                  title: "Answer Source",
                  url: "https://example.com/answer",
                  start_index: 0,
                  end_index: 6,
                },
              ],
            },
          ],
        },
      ],
      error: null,
      incomplete_details: null,
    });

    const result = await createWebfox({
      config: {
        providers: {
          openai: {
            credentials: { api: { value: "literal-key" } },
            options: {
              answer: {
                model: "gpt-4.1",
              },
            },
          },
        },
      } satisfies WebfoxConfig,
    }).answer({
      provider: "openai",
      options: {
        instructions: "Keep the answer concise and prefer primary sources.",
      },
      queries: ["What is the latest OpenAI deep research API?"],
    });

    expect(openaiCtorMock).toHaveBeenCalledWith({
      maxRetries: 0,
      apiKey: "literal-key",
    });
    expect(openaiResponsesCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
      {
        model: "gpt-4.1",
        input: "What is the latest OpenAI deep research API?",
        tools: [{ type: "web_search" }],
        instructions: "Keep the answer concise and prefer primary sources.",
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(successful(result.results[0])?.text).toBe(
      "OpenAI grounded answer\n\nSources:\n1. Answer Source\n   https://example.com/answer",
    );
  });
});

describe("async research providers", () => {
  it("uses Exa deep-reasoning search to synthesize research", async () => {
    exaSearchMock.mockResolvedValue({
      output: { content: "Exa research result" },
      results: [],
    });

    const promise = createWebfox({
      config: {
        execution: { retries: 1 },
        providers: {
          exa: {
            credentials: { api: { value: "literal-key" } },
          },
        },
      } satisfies WebfoxConfig,
    }).research({
      provider: "exa",
      options: undefined,
      input: "Investigate Exa research polling",
    });

    const result = await promise;

    expect(exaCtorMock).toHaveBeenCalledWith("literal-key", undefined);
    expect(exaSearchMock).toHaveBeenCalledTimes(1);
    expect(exaSearchMock).toHaveBeenCalledWith(
      "Investigate Exa research polling",
      {
        type: "deep-reasoning",
        outputSchema: { type: "text", description: expect.any(String) },
      },
    );
    expect(successful(result.results[0])?.text).toBe("Exa research result");
  });

  it("uses OpenAI background responses polling and preserves citations", async () => {
    vi.useFakeTimers();

    openaiResponsesCreateMock.mockResolvedValue({ id: "resp_1" });
    openaiResponsesRetrieveMock
      .mockRejectedValueOnce(
        Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
      )
      .mockResolvedValueOnce({
        id: "resp_1",
        model: "o3-deep-research",
        status: "completed",
        output_text: "OpenAI research result",
        output: [
          {
            id: "msg_1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "OpenAI research result",
                annotations: [
                  {
                    type: "url_citation",
                    title: "Source A",
                    url: "https://example.com/a",
                    start_index: 0,
                    end_index: 6,
                  },
                ],
              },
            ],
          },
        ],
        error: null,
        incomplete_details: null,
      });

    const promise = createWebfox({
      config: {
        providers: {
          openai: {
            credentials: { api: { value: "literal-key" } },
            options: {
              research: {
                model: "o3-deep-research",
              },
            },
          },
        },
        execution: { retries: 1 },
      } satisfies WebfoxConfig,
    }).research({
      provider: "openai",
      options: {
        instructions: "Prefer primary sources.",
        max_tool_calls: 12,
      },
      input: "Investigate OpenAI deep research polling",
    });

    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(openaiCtorMock).toHaveBeenCalledWith({
      maxRetries: 0,
      apiKey: "literal-key",
    });
    expect(openaiResponsesCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
      {
        model: "o3-deep-research",
        input: "Investigate OpenAI deep research polling",
        background: true,
        tools: [{ type: "web_search" }],
        instructions: "Prefer primary sources.",
        max_tool_calls: 12,
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(openaiResponsesRetrieveMock).toHaveBeenCalledTimes(2);
    expect(openaiResponsesRetrieveMock).toHaveBeenNthCalledWith(
      1,
      "resp_1",
      undefined,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(successful(result.results[0])?.text).toBe(
      "OpenAI research result\n\nSources:\n1. Source A\n   https://example.com/a",
    );
  });

  it("uses Valyu polling so transient errors do not create duplicate jobs", async () => {
    vi.useFakeTimers();

    valyuDeepResearchCreateMock.mockResolvedValue({
      success: true,
      deepresearch_id: "valyu-job-1",
    });
    valyuDeepResearchStatusMock
      .mockRejectedValueOnce(
        Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
      )
      .mockResolvedValueOnce({
        success: true,
        status: "completed",
        output: "Valyu research result",
        sources: [
          {
            title: "Source A",
            url: "https://example.com/a",
          },
        ],
      });

    const promise = createWebfox({
      config: {
        execution: { retries: 1 },
        providers: {
          valyu: {
            credentials: { api: { value: "literal-key" } },
          },
        },
      } satisfies WebfoxConfig,
    }).research({
      provider: "valyu",
      options: undefined,
      input: "Investigate Valyu research polling",
    });

    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(valyuCtorMock).toHaveBeenCalledWith("literal-key", undefined);
    expect(valyuDeepResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(valyuDeepResearchStatusMock).toHaveBeenCalledTimes(2);
    expect(valyuDeepResearchStatusMock).toHaveBeenNthCalledWith(
      1,
      "valyu-job-1",
    );
    expect(successful(result.results[0])?.text).toBe(
      "Valyu research result\n\nSources:\n1. Source A\n   https://example.com/a",
    );
  });
});

function successful<T>(result: import("../src/index.js").InputResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
