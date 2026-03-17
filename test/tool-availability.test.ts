import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
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

import webProvidersExtension, { __test__ } from "../src/index.js";
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
  delete process.env.EXA_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
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

describe("managed tool availability", () => {
  it("keeps tool descriptions concise and capability-specific", () => {
    const tools: Array<{
      name: string;
      description: string;
      parameters?: { properties?: Record<string, unknown> };
      renderResult?: (...args: any[]) => unknown;
    }> = [];

    webProvidersExtension({
      registerTool(tool: { name: string; description: string }) {
        tools.push(tool);
      },
      registerCommand() {},
      on() {},
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
    } as unknown as ExtensionAPI);

    const webSearch = tools.find((tool) => tool.name === "web_search");
    const webContents = tools.find((tool) => tool.name === "web_contents");
    const webAnswer = tools.find((tool) => tool.name === "web_answer");
    const webResearch = tools.find((tool) => tool.name === "web_research");

    expect(webSearch?.description).toContain(
      "Find likely sources on the public web",
    );
    expect(webSearch?.description).toContain("titles, URLs, and snippets");
    expect(webSearch?.parameters?.properties).not.toHaveProperty("query");
    expect(webSearch?.parameters?.properties).toHaveProperty("queries");
    expect(webSearch?.parameters?.properties).toHaveProperty("options");
    expect(webSearch?.parameters?.properties).not.toHaveProperty("provider");
    expect(webContents?.description).toBe(
      "Read and extract the main contents of one or more web pages.",
    );
    expect(webContents?.description).not.toContain("web_search");
    expect(webAnswer?.description).toBe(
      "Answer one or more questions using web-grounded evidence (up to 10 per call).",
    );
    expect(webAnswer?.parameters?.properties).not.toHaveProperty("query");
    expect(webAnswer?.parameters?.properties).toHaveProperty("queries");
    expect(webAnswer?.parameters?.properties).not.toHaveProperty("provider");
    expect(webResearch?.description).toBe(
      "Investigate a topic across web sources and produce a longer report.",
    );
    expect(webResearch?.parameters?.properties).not.toHaveProperty("provider");
  });

  it("only exposes the mapped available provider to internal capability resolution", () => {
    process.env.CODEX_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "codex",
      },
      providers: {
        codex: {},
        exa: {
          apiKey: "EXA_API_KEY",
        },
      },
    });

    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "search",
      ),
    ).toEqual(["codex"]);
  });

  it("only exposes tools whose mapped providers are available", () => {
    process.env.EXA_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: null,
        contents: "exa",
        answer: null,
        research: "exa",
      },
      providers: {
        exa: {
          apiKey: "EXA_API_KEY",
        },
      },
    });

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_contents", "web_research"]);
  });

  it("does not expose any managed tools when nothing is mapped", () => {
    process.env.CODEX_API_KEY = "test-key";

    expect(
      __test__.getAvailableManagedToolNames(createConfig(), process.cwd()),
    ).toEqual([]);
  });

  it("hides tools when the mapped provider is unavailable", () => {
    const config = createConfig({
      tools: {
        search: "claude",
      },
      providers: {
        claude: {},
      },
    });

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual([]);
  });

  it("does not activate unavailable tools before agent start", () => {
    process.env.CODEX_API_KEY = "test-key";
    process.env.EXA_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "codex",
        contents: "exa",
        answer: "exa",
        research: "exa",
      },
      providers: {
        codex: {},
        exa: {
          apiKey: "EXA_API_KEY",
        },
      },
    });

    const activeTools = __test__.getSyncedActiveTools(
      config,
      process.cwd(),
      ["web_search"],
      { addAvailable: false },
    );

    expect(Array.from(activeTools)).toEqual(["web_search"]);
  });

  it("shows partial foreground tool text in the pending tool box", () => {
    process.env.EXA_API_KEY = "test-key";

    const tools: Array<{
      name: string;
      description: string;
      parameters?: { properties?: Record<string, unknown> };
      renderResult?: (...args: any[]) => unknown;
    }> = [];

    webProvidersExtension({
      registerTool(tool: {
        name: string;
        description: string;
        renderResult?: (...args: any[]) => unknown;
      }) {
        tools.push(tool);
      },
      registerCommand() {},
      on() {},
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
    } as unknown as ExtensionAPI);

    const webSearch = tools.find((tool) => tool.name === "web_search");
    const webContents = tools.find((tool) => tool.name === "web_contents");

    const partialSearchRender = webSearch?.renderResult?.(
      {
        content: [{ type: "text", text: "Searching Exa for: exa sdk" }],
      },
      { expanded: false, isPartial: true },
      createTheme(),
    );
    const partialContentsRender = webContents?.renderResult?.(
      {
        content: [
          { type: "text", text: "Fetching contents from Exa for 2 URL(s)" },
        ],
      },
      { expanded: false, isPartial: true },
      createTheme(),
    );

    expect(partialSearchRender).toBeDefined();
    expect(partialContentsRender).toBeDefined();
  });

  it("clears the contents cache when saved contents-capable provider settings change", () => {
    const previous = createConfig({
      providers: {
        exa: {
          apiKey: "EXA_API_KEY",
          native: {
            type: "auto",
            contents: {
              text: true,
            },
          },
        },
      },
    });

    const next = createConfig({
      providers: {
        exa: {
          apiKey: "EXA_API_KEY",
          native: {
            type: "auto",
            contents: {
              text: false,
            },
          },
        },
      },
    });

    expect(__test__.didContentsCacheInputsChange(previous, next)).toBe(true);
  });

  it("keeps the contents cache when only non-contents providers change", () => {
    const previous = createConfig({
      providers: {
        codex: {
          native: {
            webSearchEnabled: true,
          },
        },
      },
    });

    const next = createConfig({
      providers: {
        codex: {
          native: {
            webSearchEnabled: false,
          },
        },
      },
    });

    expect(__test__.didContentsCacheInputsChange(previous, next)).toBe(false);
  });

  it("surfaces mapped Perplexity tools when Perplexity is available", () => {
    process.env.PERPLEXITY_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        answer: "perplexity",
        research: "perplexity",
      },
      providers: {
        perplexity: {
          apiKey: "PERPLEXITY_API_KEY",
        },
      },
    });

    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "answer",
      ),
    ).toEqual(["perplexity"]);
    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "research",
      ),
    ).toEqual(["perplexity"]);
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

function createTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}
