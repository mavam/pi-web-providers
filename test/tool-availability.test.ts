import { afterEach, describe, expect, it } from "vitest";
import { __test__ } from "../src/index.js";
import type { WebProvidersConfig } from "../src/types.js";

afterEach(() => {
  delete process.env.EXA_API_KEY;
});

describe("managed tool availability", () => {
  it("only exposes available provider overrides to the model", () => {
    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: true,
        },
        exa: {
          enabled: false,
          apiKey: "EXA_API_KEY",
        },
      },
    };

    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "search",
      ),
    ).toEqual(["codex"]);
  });

  it("keeps web_search available via implicit Codex fallback", () => {
    const config: WebProvidersConfig = { version: 1 };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_search"]);
  });

  it("hides managed tools when no provider is available", () => {
    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: false,
        },
        exa: {
          enabled: false,
          apiKey: "EXA_API_KEY",
        },
      },
    };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual([]);
  });

  it("respects provider tool capability toggles", () => {
    process.env.EXA_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: false,
        },
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
          tools: {
            search: false,
            contents: true,
            answer: false,
            research: true,
          },
        },
      },
    };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_contents", "web_research"]);
  });
});
