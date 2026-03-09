import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveProviderChoice,
  resolveProviderForCapability,
} from "../src/provider-resolution.js";
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
  delete process.env.PARALLEL_API_KEY;
  delete process.env.VALYU_API_KEY;
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

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
        },
      },
    };

    const provider = resolveProviderChoice(config, "exa", process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("rejects Claude when it is explicitly enabled without local auth", () => {
    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        claude: {
          enabled: true,
        },
      },
    };

    expect(() =>
      resolveProviderChoice(config, "claude", process.cwd()),
    ).toThrow(/Provider 'claude' is not available: missing Claude auth/);
  });

  it("prefers explicitly enabled providers in alphabetical order", () => {
    process.env.EXA_API_KEY = "test-key";
    process.env.GOOGLE_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: false,
        },
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
        },
        gemini: {
          enabled: true,
          apiKey: "GOOGLE_API_KEY",
        },
        valyu: {
          enabled: true,
          apiKey: "VALYU_API_KEY",
        },
      },
    };

    const provider = resolveProviderChoice(config, undefined, process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("falls back to implicit Codex search when no provider is explicitly enabled", () => {
    process.env.CODEX_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        exa: {
          enabled: false,
          apiKey: "EXA_API_KEY",
        },
      },
    };

    const provider = resolveProviderChoice(config, undefined, process.cwd());
    expect(provider.id).toBe("codex");
  });

  it("allows explicit Codex search without a config file entry", () => {
    process.env.CODEX_API_KEY = "test-key";

    const provider = resolveProviderChoice(
      { version: 1 },
      "codex",
      process.cwd(),
    );
    expect(provider.id).toBe("codex");
  });

  it("respects an explicitly enabled non-Codex provider over the implicit Codex fallback", () => {
    process.env.CODEX_API_KEY = "test-key";
    process.env.EXA_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
        },
      },
    };

    const provider = resolveProviderChoice(config, undefined, process.cwd());
    expect(provider.id).toBe("exa");
  });

  it("rejects Codex fallback when the CLI has no configured auth", () => {
    expect(() =>
      resolveProviderChoice({ version: 1 }, undefined, process.cwd()),
    ).toThrow(/No provider is configured for 'search'/);
  });

  it("skips providers that have the requested tool disabled", () => {
    process.env.EXA_API_KEY = "test-key";
    process.env.PARALLEL_API_KEY = "test-key";
    process.env.VALYU_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
          tools: {
            contents: false,
          },
        },
        parallel: {
          enabled: true,
          apiKey: "PARALLEL_API_KEY",
          tools: {
            contents: true,
          },
        },
        valyu: {
          enabled: true,
          apiKey: "VALYU_API_KEY",
          tools: {
            contents: true,
          },
        },
      },
    };

    const provider = resolveProviderForCapability(
      config,
      undefined,
      process.cwd(),
      "contents",
    );
    expect(provider.id).toBe("parallel");
  });
});
