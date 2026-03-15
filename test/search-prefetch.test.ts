import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exaCtorMock, exaSearchMock, exaGetContentsMock } = vi.hoisted(() => ({
  exaCtorMock: vi.fn(),
  exaSearchMock: vi.fn(),
  exaGetContentsMock: vi.fn(),
}));

vi.mock("exa-js", () => ({
  Exa: exaCtorMock.mockImplementation(function MockExa() {
    return {
      search: exaSearchMock,
      getContents: exaGetContentsMock,
      answer: vi.fn(),
      research: {
        create: vi.fn(),
        get: vi.fn(),
      },
    };
  }),
}));

beforeEach(async () => {
  exaCtorMock.mockClear();
  exaSearchMock.mockReset();
  exaGetContentsMock.mockReset();
  const { resetContentStore } = await import("../src/prefetch-manager.js");
  resetContentStore();
});

afterEach(async () => {
  exaCtorMock.mockClear();
  exaSearchMock.mockReset();
  exaGetContentsMock.mockReset();
  const { resetContentStore } = await import("../src/prefetch-manager.js");
  resetContentStore();
});

describe("search contents prefetch", () => {
  it("starts background contents prefetching, reuses the cached batch, and works without an explicit provider", async () => {
    const { __test__ } = await import("../src/index.js");
    const { getPrefetchStatus } = await import("../src/prefetch-manager.js");
    const config = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    } as const;

    exaSearchMock.mockResolvedValue({
      results: [
        {
          title: "Exa SDK",
          url: "https://exa.ai/sdk",
          text: "SDK docs",
        },
        {
          title: "Exa Pricing",
          url: "https://exa.ai/pricing",
          text: "Pricing docs",
        },
      ],
    });
    exaGetContentsMock.mockImplementation(async (urls: string[]) => ({
      results: urls.map((url) => ({
        title: url === "https://exa.ai/sdk" ? "Exa SDK" : "Exa Pricing",
        url,
        text: `Fetched body for ${url}`,
      })),
    }));

    const searchResult = await __test__.executeSearchTool({
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: {
        prefetch: {
          enabled: true,
          maxUrls: 2,
        },
      },
      maxResults: 2,
      queries: ["exa docs"],
    });

    const searchText = searchResult.content[0]?.text ?? "";
    expect(searchText).toContain("1. Exa SDK");
    expect(searchText).toContain(
      "Background contents prefetch started via exa for 2 URL(s). Prefetch id:",
    );
    const prefetchId =
      searchText.match(/Prefetch id: ([\w-]+)/)?.[1] ?? "missing";
    expect(prefetchId).not.toBe("missing");
    expect(exaSearchMock).toHaveBeenCalledWith("exa docs", {
      numResults: 2,
    });

    // The first explicit web_contents call piggybacks on the in-flight batch
    // prefetch promise (or reuses the cached result if the prefetch already
    // completed), so the provider receives at most a single batched contents
    // request for both URLs.
    const contentsResult = await __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      urls: ["https://exa.ai/sdk", "https://exa.ai/pricing"],
    });

    expect(exaGetContentsMock).toHaveBeenCalledTimes(1);
    expect(exaGetContentsMock).toHaveBeenCalledWith(
      ["https://exa.ai/pricing", "https://exa.ai/sdk"],
      undefined,
    );
    expect(contentsResult.content[0]?.text).toContain(
      "Fetched body for https://exa.ai/sdk",
    );
    expect(contentsResult.content[0]?.text).toContain(
      "Fetched body for https://exa.ai/pricing",
    );

    // A second web_contents call should reuse the now-cached batch even when
    // no explicit provider is supplied.
    const cachedResult = await __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: undefined,
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      urls: ["https://exa.ai/sdk", "https://exa.ai/pricing"],
    });

    expect(exaGetContentsMock).toHaveBeenCalledTimes(1); // unchanged
    expect(cachedResult.content[0]?.text).toContain(
      "Fetched body for https://exa.ai/sdk",
    );

    await vi.waitFor(async () => {
      const status = await getPrefetchStatus(prefetchId);
      expect(status).toMatchObject({
        prefetchId,
        provider: "exa",
        readyUrlCount: 2,
        totalUrlCount: 2,
        status: "ready",
      });
    });
  });

  it("falls back to a single provider batch when only part of the request is cached", async () => {
    const { __test__ } = await import("../src/index.js");
    const config = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    } as const;

    exaGetContentsMock.mockImplementation(async (urls: string[]) => ({
      results: urls.map((url) => ({
        title: url === "https://exa.ai/sdk" ? "Exa SDK" : "Exa Pricing",
        url,
        text: `Fetched body for ${url}`,
      })),
    }));

    await __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      urls: ["https://exa.ai/sdk"],
    });

    await __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      urls: ["https://exa.ai/sdk", "https://exa.ai/pricing"],
    });

    expect(exaGetContentsMock).toHaveBeenCalledTimes(2);
    expect(exaGetContentsMock.mock.calls[0]).toEqual([
      ["https://exa.ai/sdk"],
      undefined,
    ]);
    expect(exaGetContentsMock.mock.calls[1]).toEqual([
      ["https://exa.ai/sdk", "https://exa.ai/pricing"],
      undefined,
    ]);
  });
});
