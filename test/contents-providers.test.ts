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
    const { ExaProvider } = await import("../src/providers/exa.js");
    const provider = new ExaProvider();
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
      undefined,
      {
        enabled: true,
        apiKey: "literal-key",
      },
      { cwd: process.cwd() },
    );

    expect(result.text).toContain(longParagraph);
    expect(result.text).toContain("   Heading");
    expect(result.text).not.toContain("short summary");
    expect((result.metadata as any)?.contentsEntries?.[0]?.body).toContain(
      longParagraph,
    );
  });

  it("requests full Parallel page contents by default and prefers full_content", async () => {
    const { ParallelProvider } = await import("../src/providers/parallel.js");
    const provider = new ParallelProvider();
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
      undefined,
      config,
      { cwd: process.cwd() },
    );

    expect(parallelExtractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        urls: ["https://parallel.ai/docs"],
        full_content: true,
        excerpts: false,
      }),
      undefined,
    );
    expect(result.text).toContain("Section 1");
    expect(result.text).toContain("Section 2");
    expect(result.text).not.toContain("short excerpt");
  });

  it("prefers Valyu content over summaries and preserves line breaks", async () => {
    const { ValyuProvider } = await import("../src/providers/valyu.js");
    const provider = new ValyuProvider();

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
      undefined,
      {
        enabled: true,
        apiKey: "literal-key",
      },
      { cwd: process.cwd() },
    );

    expect(result.text).toContain("Intro");
    expect(result.text).toContain("- Item 1");
    expect(result.text).toContain("- Item 2");
    expect(result.text).not.toContain("summary only");
    expect((result.metadata as any)?.contentsEntries?.[0]?.body).toBe(
      "Intro\n\n- Item 1\n- Item 2",
    );
  });
});
