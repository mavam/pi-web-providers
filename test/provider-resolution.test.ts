import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

import {
  getEffectiveProviderConfig,
  resolveProviderForTool,
  resolveSearchProvider,
} from "../src/provider-resolution.js";
import type { WebProviders } from "../src/types.js";

const originalHome = process.env.HOME;
const cleanupDirs: string[] = [];

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "pi-web-providers-home-"));
  cleanupDirs.push(home);
  process.env.HOME = home;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CODEX_API_KEY;
  delete process.env.EXA_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LINKUP_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.TAVILY_API_KEY;
  delete process.env.VALYU_API_KEY;
});

afterEach(() => {
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CODEX_API_KEY;
  delete process.env.EXA_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LINKUP_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.TAVILY_API_KEY;
  delete process.env.VALYU_API_KEY;
  execFileSyncMock.mockReset();
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("provider resolution", () => {
  it("uses the explicit provider when it is configured", () => {
    process.env.EXA_API_KEY = "test-key";

    const config = createConfig({
      providers: {
        exa: {
          apiKey: "EXA_API_KEY",
        },
      },
    });

    const provider = resolveSearchProvider(config, process.cwd(), "exa");
    expect(provider.id).toBe("exa");
  });

  it("does not preflight Claude auth when it is explicitly selected", () => {
    const config = createConfig({
      providers: {
        claude: {},
      },
    });

    const provider = resolveSearchProvider(config, process.cwd(), "claude");
    expect(provider.id).toBe("claude");
  });

  it("uses the mapped search provider", () => {
    process.env.EXA_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "exa",
      },
      providers: {
        exa: {
          apiKey: "EXA_API_KEY",
        },
      },
    });

    const provider = resolveSearchProvider(config, process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("does not fall back when search is unmapped", () => {
    process.env.CODEX_API_KEY = "test-key";

    expect(() => resolveSearchProvider(createConfig(), process.cwd())).toThrow(
      /No provider is configured for 'search'/,
    );
  });

  it("does not preflight Codex auth for a mapped provider", () => {
    const config = createConfig({
      tools: {
        search: "codex",
      },
      providers: {
        codex: {},
      },
    });

    const provider = resolveSearchProvider(config, process.cwd());
    expect(provider.id).toBe("codex");
  });

  it("uses the mapped contents provider", () => {
    process.env.PARALLEL_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        contents: "parallel",
      },
      providers: {
        parallel: {
          apiKey: "PARALLEL_API_KEY",
        },
      },
    });

    const provider = resolveProviderForTool(config, process.cwd(), "contents");
    expect(provider.id).toBe("parallel");
  });

  it("uses the mapped Serper provider for search", () => {
    process.env.SERPER_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "serper",
      },
      providers: {
        serper: {
          apiKey: "SERPER_API_KEY",
        },
      },
    });

    expect(resolveSearchProvider(config, process.cwd()).id).toBe("serper");
  });

  it("uses the mapped Tavily provider for search and contents", () => {
    process.env.TAVILY_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "tavily",
        contents: "tavily",
      },
      providers: {
        tavily: {
          apiKey: "TAVILY_API_KEY",
        },
      },
    });

    expect(resolveSearchProvider(config, process.cwd()).id).toBe("tavily");
    expect(resolveProviderForTool(config, process.cwd(), "contents").id).toBe(
      "tavily",
    );
  });

  it("uses the mapped Linkup provider for search and contents", () => {
    process.env.LINKUP_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "linkup",
        contents: "linkup",
      },
      providers: {
        linkup: {
          apiKey: "LINKUP_API_KEY",
        },
      },
    });

    expect(resolveSearchProvider(config, process.cwd()).id).toBe("linkup");
    expect(resolveProviderForTool(config, process.cwd(), "contents").id).toBe(
      "linkup",
    );
  });

  it("rejects Cloudflare contents when the account id is missing", () => {
    process.env.CLOUDFLARE_API_TOKEN = "test-token";

    const config = createConfig({
      tools: {
        contents: "cloudflare",
      },
      providers: {
        cloudflare: {
          apiToken: "CLOUDFLARE_API_TOKEN",
        },
      },
    });

    expect(() =>
      resolveProviderForTool(config, process.cwd(), "contents"),
    ).toThrow(/Provider 'cloudflare' is not available: missing account ID/);
  });

  it("rejects Custom when the mapped capability has no command configured", () => {
    const config = createConfig({
      tools: {
        search: "custom",
      },
      providers: {
        custom: {
          options: {
            answer: {
              argv: [process.execPath, "./answer-wrapper.mjs"],
            },
          },
        },
      },
    });

    expect(() =>
      resolveProviderForTool(config, process.cwd(), "search"),
    ).toThrow(
      /Provider 'custom' is not available: no command configured for search/,
    );
  });

  it("treats Perplexity research as a direct explicit-provider selection", () => {
    process.env.PERPLEXITY_API_KEY = "test-key";

    const config = createConfig({
      providers: {
        perplexity: {
          apiKey: "PERPLEXITY_API_KEY",
        },
      },
    });

    const provider = resolveProviderForTool(
      config,
      process.cwd(),
      "research",
      "perplexity",
    );
    expect(provider.id).toBe("perplexity");
  });

  it("merges shared settings into the effective provider settings", () => {
    const config = createConfig({
      settings: {
        requestTimeoutMs: 30000,
        retryCount: 3,
        retryDelayMs: 2000,
        researchTimeoutMs: 1800000,
      },
      providers: {
        exa: {
          settings: {
            retryCount: 5,
          },
        },
      },
    });

    expect(getEffectiveProviderConfig(config, "exa")?.settings).toEqual({
      requestTimeoutMs: 30000,
      retryCount: 5,
      retryDelayMs: 2000,
      researchTimeoutMs: 1800000,
    });
  });
});

function createConfig(overrides: Partial<WebProviders> = {}): WebProviders {
  return {
    tools: overrides.tools,
    settings: overrides.settings,
    providers: overrides.providers,
  };
}
