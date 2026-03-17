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
  resolveProviderChoice,
  resolveProviderForCapability,
} from "../src/provider-resolution.js";
import { resetClaudeProviderCachesForTests } from "../src/providers/claude.js";
import type { WebProvidersConfig } from "../src/types.js";

const originalHome = process.env.HOME;
const cleanupDirs: string[] = [];

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "pi-web-providers-home-"));
  cleanupDirs.push(home);
  process.env.HOME = home;
});

afterEach(() => {
  delete process.env.CODEX_API_KEY;
  delete process.env.EXA_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.VALYU_API_KEY;
  execFileSyncMock.mockReset();
  resetClaudeProviderCachesForTests();
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

    const provider = resolveProviderChoice(config, "exa", process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("rejects Claude when it is explicitly selected without local auth", () => {
    const config = createConfig({
      providers: {
        claude: {},
      },
    });

    expect(() =>
      resolveProviderChoice(config, "claude", process.cwd()),
    ).toThrow(/Provider 'claude' is not available: missing Claude auth/);
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

    const provider = resolveProviderChoice(config, process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("does not fall back when search is unmapped", () => {
    process.env.CODEX_API_KEY = "test-key";

    expect(() =>
      resolveProviderChoice(createConfig(), process.cwd()),
    ).toThrow(/No provider is configured for 'search'/);
  });

  it("rejects an unavailable mapped provider", () => {
    const config = createConfig({
      tools: {
        search: "codex",
      },
      providers: {
        codex: {},
      },
    });

    expect(() => resolveProviderChoice(config, process.cwd())).toThrow(
      /Provider 'codex' is not available: missing Codex auth/,
    );
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

    const provider = resolveProviderForCapability(
      config,
      process.cwd(),
      "contents",
    );
    expect(provider.id).toBe("parallel");
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

    const provider = resolveProviderForCapability(
      config,
      "perplexity",
      process.cwd(),
      "research",
    );
    expect(provider.id).toBe("perplexity");
  });
});

function createConfig(
  overrides: Partial<WebProvidersConfig> = {},
): WebProvidersConfig {
  return {
    version: 2,
    tools: overrides.tools,
    providers: overrides.providers,
  };
}
