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
      "../src/providers/cloudflare/definition.js"
    );
    const provider = providerHarness(cloudflareProvider);

    cloudflareMarkdownCreateMock.mockResolvedValue(
      "# Cloudflare Docs\n\nRendered content",
    );

    const result = await provider.contents(
      ["https://developers.cloudflare.com/browser-rendering/"],
      { credentials: { api: "literal-token" }, accountId: "account-id" },
      { cwd: process.cwd() },
      {
        ...{
          gotoOptions: {
            waitUntil: "networkidle0",
          },
        },
        ...{
          cacheTTL: 0,
        },
      },
    );

    expect(cloudflareCtorMock).toHaveBeenCalledWith({
      maxRetries: 0,
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
    expect(result.answers[0]).toMatchObject({
      inputIndex: 0,
      url: "https://developers.cloudflare.com/browser-rendering/",
      content: "# Cloudflare Docs\n\nRendered content",
    });
  });

  it("keeps full Exa page text instead of collapsing to a snippet", async () => {
    const { exaProvider } = await import("../src/providers/exa/definition.js");
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

  it("prefers Valyu content over summaries and preserves line breaks", async () => {
    const { valyuProvider } = await import(
      "../src/providers/valyu/definition.js"
    );
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
