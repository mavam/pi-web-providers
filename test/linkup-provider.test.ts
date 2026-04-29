import { afterEach, describe, expect, it, vi } from "vitest";

const { linkupCtorMock, linkupFetchMock, linkupSearchMock } = vi.hoisted(
  () => ({
    linkupCtorMock: vi.fn(),
    linkupFetchMock: vi.fn(),
    linkupSearchMock: vi.fn(),
  }),
);

vi.mock("linkup-sdk", () => ({
  LinkupClient: linkupCtorMock.mockImplementation(function MockLinkup() {
    return {
      search: linkupSearchMock,
      fetch: linkupFetchMock,
    };
  }),
}));

import { linkupProvider } from "../src/providers/linkup.js";
import { providerHarness } from "./provider-harness.js";

afterEach(() => {
  delete process.env.LINKUP_API_KEY;
  linkupCtorMock.mockClear();
  linkupSearchMock.mockReset();
  linkupFetchMock.mockReset();
});

describe("providerHarness(linkupProvider)", () => {
  it("forwards supported Linkup search options and keeps search-results output fixed", async () => {
    process.env.LINKUP_API_KEY = "test-key";

    linkupSearchMock.mockResolvedValue({
      results: [
        {
          type: "text",
          name: "Linkup Docs",
          url: "https://docs.linkup.so",
          content: "Official documentation for Linkup.",
          favicon: "https://docs.linkup.so/favicon.ico",
        },
        {
          type: "image",
          name: "Linkup logo",
          url: "https://example.com/logo.png",
        },
      ],
    });

    const response = await providerHarness(linkupProvider).search(
      "linkup sdk",
      2,
      {
        credentials: { api: "LINKUP_API_KEY" },
        baseUrl: "https://api.linkup.test/v1",
        options: {
          search: {
            includeImages: true,
            excludeDomains: ["example.com"],
          },
        },
      },
      { cwd: process.cwd() },
      {
        depth: "deep",
        includeDomains: ["docs.linkup.so"],
        fromDate: "2026-01-02T03:04:05.000Z",
        requestTimeoutMs: 5000,
      },
    );

    expect(linkupCtorMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseUrl: "https://api.linkup.test/v1",
    });
    expect(linkupSearchMock).toHaveBeenCalledWith({
      query: "linkup sdk",
      depth: "deep",
      outputType: "searchResults",
      maxResults: 2,
      includeImages: true,
      includeDomains: ["docs.linkup.so"],
      excludeDomains: ["example.com"],
      fromDate: expect.any(Date),
    });
    expect(
      (
        linkupSearchMock.mock.calls[0]?.[0] as { fromDate: Date }
      ).fromDate.toISOString(),
    ).toBe("2026-01-02T03:04:05.000Z");
    expect(response).toEqual({
      provider: "linkup",
      results: [
        {
          title: "Linkup Docs",
          url: "https://docs.linkup.so",
          snippet: "Official documentation for Linkup.",
          metadata: {
            type: "text",
            favicon: "https://docs.linkup.so/favicon.ico",
          },
        },
        {
          title: "Linkup logo",
          url: "https://example.com/logo.png",
          snippet: "",
          metadata: {
            type: "image",
          },
        },
      ],
    });
  });

  it("rejects incompatible Linkup search option overrides", async () => {
    await expect(
      providerHarness(linkupProvider).search(
        "linkup sdk",
        2,
        {
          credentials: { api: "literal-key" },
        },
        { cwd: process.cwd() },
        {
          outputType: "structured",
        },
      ),
    ).rejects.toThrow(/only supports outputType 'searchResults'/);
  });

  it("forwards Linkup fetch options per URL and preserves URL order", async () => {
    linkupFetchMock.mockImplementation(async ({ url }: { url: string }) => {
      if (url === "https://example.com/a") {
        return {
          markdown: "# Page A\n\nBody A",
        };
      }
      if (url === "https://example.com/b") {
        throw new Error("blocked by robots");
      }
      return {
        markdown: "",
      };
    });

    const response = await providerHarness(linkupProvider).contents(
      [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
      ],
      {
        credentials: { api: "literal-key" },
        options: {
          fetch: {
            includeRawHtml: true,
          },
        },
      },
      { cwd: process.cwd() },
      {
        renderJs: true,
        extractImages: true,
        retryCount: 2,
      },
    );

    expect(linkupCtorMock).toHaveBeenCalledWith({
      apiKey: "literal-key",
      baseUrl: undefined,
    });
    expect(linkupFetchMock).toHaveBeenNthCalledWith(1, {
      url: "https://example.com/a",
      renderJs: true,
      includeRawHtml: true,
      extractImages: true,
    });
    expect(linkupFetchMock).toHaveBeenNthCalledWith(2, {
      url: "https://example.com/b",
      renderJs: true,
      includeRawHtml: true,
      extractImages: true,
    });
    expect(linkupFetchMock).toHaveBeenNthCalledWith(3, {
      url: "https://example.com/c",
      renderJs: true,
      includeRawHtml: true,
      extractImages: true,
    });
    expect(response.answers).toEqual([
      {
        url: "https://example.com/a",
        content: "# Page A\n\nBody A",
      },
      {
        url: "https://example.com/b",
        error: "blocked by robots",
      },
      {
        url: "https://example.com/c",
        error: "No content returned for this URL.",
      },
    ]);
  });

  it("requires an API key", async () => {
    await expect(
      providerHarness(linkupProvider).search(
        "linkup",
        1,
        {
          credentials: { api: "LINKUP_API_KEY" },
        },
        { cwd: process.cwd() },
      ),
    ).rejects.toThrow(/missing an API key/);
  });
});
