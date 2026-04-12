import { afterEach, describe, expect, it, vi } from "vitest";

const {
  exaCtorMock,
  exaResearchCreateMock,
  exaResearchGetMock,
  openaiCtorMock,
  openaiResponsesCreateMock,
  openaiResponsesRetrieveMock,
  valyuCtorMock,
  valyuDeepResearchCreateMock,
  valyuDeepResearchStatusMock,
} = vi.hoisted(() => ({
  exaCtorMock: vi.fn(),
  exaResearchCreateMock: vi.fn(),
  exaResearchGetMock: vi.fn(),
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
      research: {
        create: exaResearchCreateMock,
        get: exaResearchGetMock,
      },
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

import { __test__ } from "../src/index.js";
import type { WebProviders } from "../src/types.js";

afterEach(() => {
  vi.useRealTimers();
  exaCtorMock.mockClear();
  exaResearchCreateMock.mockReset();
  exaResearchGetMock.mockReset();
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

    const result = await __test__.executeSearchTool({
      config: {
        providers: {
          openai: {
            apiKey: "literal-key",
            options: {
              search: {
                model: "gpt-4.1",
              },
            },
          },
        },
      } satisfies WebProviders,
      explicitProvider: "openai",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: {
        instructions: "Prefer official sources.",
      },
      maxResults: 3,
      queries: ["openai deep research"],
    });

    expect(openaiCtorMock).toHaveBeenCalledWith({
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
        tools: [{ type: "web_search_preview" }],
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
    expect(result.content[0]?.text).toContain('## "openai deep research"');
    expect(result.content[0]?.text).toContain(
      "1. [OpenAI Deep Research docs](<https://platform.openai.com/docs/guides/deep-research>)",
    );
    expect(result.details).toEqual({
      tool: "web_search",
      provider: "openai",
      queryCount: 1,
      failedQueryCount: 0,
      resultCount: 1,
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

    const result = await __test__.executeProviderTool({
      capability: "answer",
      config: {
        providers: {
          openai: {
            apiKey: "literal-key",
            options: {
              answer: {
                model: "gpt-4.1",
              },
            },
          },
        },
      } satisfies WebProviders,
      explicitProvider: "openai",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: {
        instructions: "Keep the answer concise and prefer primary sources.",
      },
      query: "What is the latest OpenAI deep research API?",
    });

    expect(openaiCtorMock).toHaveBeenCalledWith({
      apiKey: "literal-key",
    });
    expect(openaiResponsesCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
      {
        model: "gpt-4.1",
        input: "What is the latest OpenAI deep research API?",
        tools: [{ type: "web_search_preview" }],
        instructions: "Keep the answer concise and prefer primary sources.",
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.content[0]?.text).toBe(
      "OpenAI grounded answer\n\nSources:\n1. Answer Source\n   https://example.com/answer",
    );
  });
});

describe("async research providers", () => {
  it("uses Exa polling so transient errors do not create duplicate jobs", async () => {
    vi.useFakeTimers();

    exaResearchCreateMock.mockResolvedValue({ researchId: "exa-job-1" });
    exaResearchGetMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce({
        status: "completed",
        output: {
          content: "Exa research result",
        },
      });

    const promise = __test__.executeProviderTool({
      capability: "research",
      config: {
        providers: {
          exa: {
            apiKey: "literal-key",
          },
        },
      } satisfies WebProviders,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      input: "Investigate Exa research polling",
    });

    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(exaCtorMock).toHaveBeenCalledWith("literal-key", undefined);
    expect(exaResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(exaResearchGetMock).toHaveBeenCalledTimes(2);
    expect(exaResearchGetMock).toHaveBeenNthCalledWith(1, "exa-job-1", {
      events: false,
    });
    expect(result.content[0]?.text).toBe("Exa research result");
  });

  it("uses OpenAI background responses polling and preserves citations", async () => {
    vi.useFakeTimers();

    openaiResponsesCreateMock.mockResolvedValue({ id: "resp_1" });
    openaiResponsesRetrieveMock
      .mockRejectedValueOnce(new Error("fetch failed"))
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

    const promise = __test__.executeProviderTool({
      capability: "research",
      config: {
        providers: {
          openai: {
            apiKey: "literal-key",
            options: {
              research: {
                model: "o3-deep-research",
              },
            },
          },
        },
      } satisfies WebProviders,
      explicitProvider: "openai",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: {
        instructions: "Prefer primary sources.",
        max_tool_calls: 12,
      },
      input: "Investigate OpenAI deep research polling",
    });

    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(openaiCtorMock).toHaveBeenCalledWith({
      apiKey: "literal-key",
    });
    expect(openaiResponsesCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
      {
        model: "o3-deep-research",
        input: "Investigate OpenAI deep research polling",
        background: true,
        tools: [{ type: "web_search_preview" }],
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
    expect(result.content[0]?.text).toBe(
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
      .mockResolvedValueOnce({
        success: false,
        error: "fetch failed",
      })
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

    const promise = __test__.executeProviderTool({
      capability: "research",
      config: {
        providers: {
          valyu: {
            apiKey: "literal-key",
          },
        },
      } satisfies WebProviders,
      explicitProvider: "valyu",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      input: "Investigate Valyu research polling",
    });

    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(valyuCtorMock).toHaveBeenCalledWith("literal-key", undefined);
    expect(valyuDeepResearchCreateMock).toHaveBeenCalledTimes(1);
    expect(valyuDeepResearchStatusMock).toHaveBeenCalledTimes(2);
    expect(valyuDeepResearchStatusMock).toHaveBeenNthCalledWith(
      1,
      "valyu-job-1",
    );
    expect(result.content[0]?.text).toBe(
      "Valyu research result\n\nSources:\n1. Source A\n   https://example.com/a",
    );
  });
});
