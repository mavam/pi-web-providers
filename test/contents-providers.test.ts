import { afterEach, describe, expect, it, vi } from "vitest";
import { providerHarness } from "./provider-harness.js";

const {
  cloudflareCtorMock,
  cloudflareMarkdownCreateMock,
  exaCtorMock,
  exaGetContentsMock,
  parallelCtorMock,
  parallelExtractMock,
  parallelSearchMock,
  valyuCtorMock,
  valyuContentsMock,
  valyuWaitForJobMock,
} = vi.hoisted(() => ({
  cloudflareCtorMock: vi.fn(),
  cloudflareMarkdownCreateMock: vi.fn(),
  exaCtorMock: vi.fn(),
  exaGetContentsMock: vi.fn(),
  parallelCtorMock: vi.fn(),
  parallelExtractMock: vi.fn(),
  parallelSearchMock: vi.fn(),
  valyuCtorMock: vi.fn(),
  valyuContentsMock: vi.fn(),
  valyuWaitForJobMock: vi.fn(),
}));

vi.mock("cloudflare", () => ({
  default: cloudflareCtorMock.mockImplementation(function MockCloudflare() {
    return {
      browserRendering: {
        markdown: {
          create: cloudflareMarkdownCreateMock,
        },
      },
    };
  }),
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
      search: parallelSearchMock,
      extract: parallelExtractMock,
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

afterEach(() => {
  cloudflareCtorMock.mockClear();
  cloudflareMarkdownCreateMock.mockReset();
  parallelCtorMock.mockClear();
  parallelExtractMock.mockReset();
  parallelSearchMock.mockReset();
});

describe("contents providers", () => {
  it("renders contents via Cloudflare Browser Rendering markdown", async () => {
    const { cloudflareProvider } = await import(
      "../src/providers/cloudflare.js"
    );
    const provider = providerHarness(cloudflareProvider);

    cloudflareMarkdownCreateMock.mockResolvedValue(
      "# Cloudflare Docs\n\nRendered content",
    );

    const result = await provider.contents(
      ["https://developers.cloudflare.com/browser-rendering/"],
      {
        credentials: { api: "literal-token" },
        accountId: "account-id",
        options: {
          gotoOptions: {
            waitUntil: "networkidle0",
          },
        },
      },
      { cwd: process.cwd() },
      {
        cacheTTL: 0,
      },
    );

    expect(cloudflareCtorMock).toHaveBeenCalledWith({
      apiToken: "literal-token",
    });
    expect(cloudflareMarkdownCreateMock).toHaveBeenCalledWith(
      {
        gotoOptions: {
          waitUntil: "networkidle0",
        },
        cacheTTL: 0,
        account_id: "account-id",
        url: "https://developers.cloudflare.com/browser-rendering/",
      },
      undefined,
    );
    expect(result.answers[0]).toEqual({
      url: "https://developers.cloudflare.com/browser-rendering/",
      content: "# Cloudflare Docs\n\nRendered content",
    });
  });

  it("keeps full Exa page text instead of collapsing to a snippet", async () => {
    const { exaProvider } = await import("../src/providers/exa.js");
    const provider = providerHarness(exaProvider);
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
        credentials: { api: "literal-key" },
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
    const { parallelProvider } = await import("../src/providers/parallel.js");
    const provider = providerHarness(parallelProvider);
    const config = provider.createTemplate();
    config.credentials = { api: "literal-key" };

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
        advanced_settings: {
          full_content: true,
          excerpt_settings: {
            max_chars_per_result: 0,
          },
        },
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

  it("maps Parallel search to the v1 search API and legacy modes", async () => {
    const { parallelProvider } = await import("../src/providers/parallel.js");
    const provider = providerHarness(parallelProvider);
    const config = provider.createTemplate();
    config.credentials = { api: "literal-key" };
    config.options = {
      search: {
        mode: "agentic",
      },
    };

    parallelSearchMock.mockResolvedValue({
      results: [
        {
          title: "Parallel Docs",
          url: "https://parallel.ai/docs",
          excerpts: ["SDK reference"],
        },
      ],
    });

    const result = await provider.search(
      "parallel sdk",
      3,
      config,
      { cwd: process.cwd() },
      {
        mode: "one-shot",
      },
    );

    expect(parallelSearchMock).toHaveBeenCalledWith(
      {
        search_queries: ["parallel sdk"],
        objective: "parallel sdk",
        mode: "basic",
        advanced_settings: {
          max_results: 3,
        },
      },
      undefined,
    );
    expect(result.results).toEqual([
      {
        title: "Parallel Docs",
        url: "https://parallel.ai/docs",
        snippet: "SDK reference",
      },
    ]);
  });

  it("prefers Valyu content over summaries and preserves line breaks", async () => {
    const { valyuProvider } = await import("../src/providers/valyu.js");
    const provider = providerHarness(valyuProvider);

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
        credentials: { api: "literal-key" },
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
