import { describe, expect, it, vi } from "vitest";

const {
  exaCtorMock,
  exaGetContentsMock,
  parallelCtorMock,
  parallelExtractMock,
  valyuCtorMock,
  valyuContentsMock,
  valyuWaitForJobMock,
} = vi.hoisted(() => ({
  exaCtorMock: vi.fn(),
  exaGetContentsMock: vi.fn(),
  parallelCtorMock: vi.fn(),
  parallelExtractMock: vi.fn(),
  valyuCtorMock: vi.fn(),
  valyuContentsMock: vi.fn(),
  valyuWaitForJobMock: vi.fn(),
}));

vi.mock("exa-js", () => ({
  Exa: exaCtorMock.mockImplementation(function MockExa() {
    return {
      search: vi.fn(),
      getContents: exaGetContentsMock,
      answer: vi.fn(),
      research: {
        create: vi.fn(),
        get: vi.fn(),
      },
    };
  }),
}));

vi.mock("parallel-web", () => ({
  default: parallelCtorMock.mockImplementation(function MockParallel() {
    return {
      beta: {
        search: vi.fn(),
        extract: parallelExtractMock,
      },
    };
  }),
}));

vi.mock("valyu-js", () => ({
  Valyu: valyuCtorMock.mockImplementation(function MockValyu() {
    return {
      search: vi.fn(),
      contents: valyuContentsMock,
      waitForJob: valyuWaitForJobMock,
      answer: vi.fn(),
      deepresearch: {
        create: vi.fn(),
        status: vi.fn(),
      },
    };
  }),
}));

describe("contents providers", () => {
  it("keeps full Exa page text instead of collapsing to a snippet", async () => {
    const { ExaAdapter } = await import("../src/providers/exa.js");
    const provider = new ExaAdapter();
    const longParagraph = "x".repeat(420);

    exaGetContentsMock.mockResolvedValue({
      results: [
        {
          title: "Example",
          url: "https://example.com",
          text: `Heading\n\n${longParagraph}`,
          summary: "short summary",
        },
      ],
    });

    const result = await provider.contents(
      ["https://example.com"],
      {
        enabled: true,
        apiKey: "literal-key",
      },
      { cwd: process.cwd() },
      undefined,
    );

    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]).toMatchObject({
      url: "https://example.com",
      content: `Heading\n\n${longParagraph}`,
      summary: "short summary",
      metadata: {
        title: "Example",
        url: "https://example.com",
        text: `Heading\n\n${longParagraph}`,
        summary: "short summary",
      },
    });
  });

  it("requests full Parallel page contents by default and prefers full_content", async () => {
    const { ParallelAdapter } = await import("../src/providers/parallel.js");
    const provider = new ParallelAdapter();
    const config = provider.createTemplate();
    config.enabled = true;
    config.apiKey = "literal-key";

    parallelExtractMock.mockResolvedValue({
      results: [
        {
          title: "Parallel Docs",
          url: "https://parallel.ai/docs",
          excerpts: ["short excerpt"],
          full_content: "Section 1\n\nSection 2",
        },
      ],
      errors: [],
    });

    const result = await provider.contents(
      ["https://parallel.ai/docs"],
      config,
      { cwd: process.cwd() },
      undefined,
    );

    expect(parallelExtractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: ["https://parallel.ai/docs"],
        full_content: true,
        excerpts: false,
      }),
      undefined,
    );
    expect(result.answers[0]).toMatchObject({
      url: "https://parallel.ai/docs",
      content: "Section 1\n\nSection 2",
      metadata: {
        title: "Parallel Docs",
        url: "https://parallel.ai/docs",
        excerpts: ["short excerpt"],
        full_content: "Section 1\n\nSection 2",
      },
    });
  });

  it("prefers Valyu content over summaries and preserves line breaks", async () => {
    const { ValyuAdapter } = await import("../src/providers/valyu.js");
    const provider = new ValyuAdapter();

    valyuContentsMock.mockResolvedValue({
      success: true,
      results: [
        {
          url: "https://valyu.ai/docs",
          title: "Valyu Docs",
          summary: "summary only",
          content: "Intro\n\n- Item 1\n- Item 2",
        },
      ],
    });

    const result = await provider.contents(
      ["https://valyu.ai/docs"],
      {
        enabled: true,
        apiKey: "literal-key",
      },
      { cwd: process.cwd() },
      undefined,
    );

    expect(result.answers[0]).toMatchObject({
      url: "https://valyu.ai/docs",
      content: "Intro\n\n- Item 1\n- Item 2",
      summary: "summary only",
      metadata: {
        url: "https://valyu.ai/docs",
        title: "Valyu Docs",
        summary: "summary only",
        content: "Intro\n\n- Item 1\n- Item 2",
      },
    });
  });
});
