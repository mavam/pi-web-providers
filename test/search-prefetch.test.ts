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
  it("starts background contents prefetching, reuses prefetched per-URL entries, and works without an explicit provider", async () => {
    const { __test__ } = await import("../src/index.js");
    const { getPrefetchStatus } = await import("../src/prefetch-manager.js");
    const config = {
      tools: {
        contents: "exa",
      },
      providers: {
        exa: {
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
    expect(searchText).toContain("1. [Exa SDK](<https://exa.ai/sdk>)");
    expect(searchText).toContain(
      "Background contents prefetch started via exa for 2 URL(s). Prefetch id:",
    );
    const prefetchId =
      searchText.match(/Prefetch id: ([\w-]+)/)?.[1] ?? "missing";
    expect(prefetchId).not.toBe("missing");
    expect(exaSearchMock).toHaveBeenCalledWith("exa docs", {
      numResults: 2,
    });

    // The first explicit web_contents call should piggyback on the in-flight
    // per-URL prefetch work (or reuse the cached entries if prefetch already
    // completed), so it does not trigger any additional provider calls.
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

    expect(exaGetContentsMock).toHaveBeenCalledTimes(2);
    expect(exaGetContentsMock.mock.calls).toEqual([
      [["https://exa.ai/sdk"], undefined],
      [["https://exa.ai/pricing"], undefined],
    ]);
    expect(contentsResult.content[0]?.text).toContain(
      "Fetched body for https://exa.ai/sdk",
    );
    expect(contentsResult.content[0]?.text).toContain(
      "Fetched body for https://exa.ai/pricing",
    );

    // A second web_contents call should be able to reuse a prefetched subset
    // even when no explicit provider is supplied.
    const cachedResult = await __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: undefined,
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      urls: ["https://exa.ai/sdk"],
    });

    expect(exaGetContentsMock).toHaveBeenCalledTimes(2); // unchanged
    expect(cachedResult.content[0]?.text).toContain(
      "Fetched body for https://exa.ai/sdk",
    );
    expect(cachedResult.content[0]?.text).not.toContain(
      "Fetched body for https://exa.ai/pricing",
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
      expect(status?.urls).toEqual([
        expect.objectContaining({
          url: "https://exa.ai/sdk",
          status: "ready",
          text: expect.stringContaining("Fetched body for https://exa.ai/sdk"),
        }),
        expect.objectContaining({
          url: "https://exa.ai/pricing",
          status: "ready",
          text: expect.stringContaining(
            "Fetched body for https://exa.ai/pricing",
          ),
        }),
      ]);
    });
  });

  it("reuses partial cache hits and fetches only the missing URLs", async () => {
    const { __test__ } = await import("../src/index.js");
    const config = {
      tools: {
        contents: "exa",
      },
      providers: {
        exa: {
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

    const result = await __test__.executeProviderTool({
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
      ["https://exa.ai/pricing"],
      undefined,
    ]);
    expect(result.content[0]?.text).toContain(
      "Fetched body for https://exa.ai/sdk",
    );
    expect(result.content[0]?.text).toContain(
      "Fetched body for https://exa.ai/pricing",
    );
  });

  it("reuses earlier live reads without refetching and re-renders them in the current request order", async () => {
    const { __test__ } = await import("../src/index.js");
    const config = {
      tools: {
        contents: "exa",
      },
      providers: {
        exa: {
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
      urls: ["https://exa.ai/sdk", "https://exa.ai/pricing"],
    });

    const cachedResult = await __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: undefined,
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      urls: ["https://exa.ai/pricing", "https://exa.ai/sdk"],
    });

    expect(exaGetContentsMock).toHaveBeenCalledTimes(1);
    expect(exaGetContentsMock.mock.calls).toEqual([
      [["https://exa.ai/pricing", "https://exa.ai/sdk"], undefined],
    ]);
    const cachedText = cachedResult.content[0]?.text ?? "";
    expect(cachedText).toContain("1. Exa Pricing");
    expect(cachedText).toContain("2. Exa SDK");
    expect(cachedText.indexOf("1. Exa Pricing")).toBeLessThan(
      cachedText.indexOf("2. Exa SDK"),
    );
    expect(cachedText).toContain("Fetched body for https://exa.ai/sdk");
    expect(cachedText).toContain("Fetched body for https://exa.ai/pricing");
  });

  it("cleans up expired cache entries automatically on the next tool call", async () => {
    vi.useFakeTimers();
    try {
      const { __test__ } = await import("../src/index.js");
      const { getPrefetchStatus } = await import("../src/prefetch-manager.js");
      const config = {
        tools: {
          contents: "exa",
        },
        providers: {
          exa: {
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
        ],
      });
      exaGetContentsMock.mockImplementation(async (urls: string[]) => ({
        results: urls.map((url) => ({
          title: "Exa SDK",
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
            maxUrls: 1,
            ttlMs: 1000,
          },
        },
        maxResults: 1,
        queries: ["exa docs"],
      });

      const prefetchId =
        (searchResult.content[0]?.text ?? "").match(
          /Prefetch id: ([\w-]+)/,
        )?.[1] ?? "missing";
      expect(prefetchId).not.toBe("missing");

      await vi.waitFor(async () => {
        expect((await getPrefetchStatus(prefetchId))?.status).toBe("ready");
      });

      vi.advanceTimersByTime(1001);

      await __test__.executeProviderTool({
        capability: "contents",
        config,
        explicitProvider: "exa",
        ctx: { cwd: process.cwd() },
        signal: undefined,
        onUpdate: undefined,
        options: undefined,
        urls: ["https://exa.ai/pricing"],
      });

      expect(await getPrefetchStatus(prefetchId)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
