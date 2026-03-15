import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
    expect(webSearch?.parameters?.properties).toHaveProperty("options");
    expect(webContents?.description).toBe(
      "Read and extract the main contents of one or more web pages.",
    );
    expect(webContents?.description).not.toContain("web_search");
    expect(webAnswer?.description).toBe(
      "Answer a question using web-grounded evidence.",
    );
    expect(webResearch?.description).toBe(
      "Investigate a topic across web sources and produce a longer report.",
    );
  });

  it("only exposes available provider overrides to the model", () => {
    process.env.CODEX_API_KEY = "test-key";

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
    process.env.CODEX_API_KEY = "test-key";

    const config: WebProvidersConfig = { version: 1 };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_search"]);
  });

  it("does not expose Claude-managed tools via implicit fallback", () => {
    mockClaudeAvailable();

    const config: WebProvidersConfig = { version: 1 };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual([]);
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

  it("hides Claude-managed tools when Claude auth is missing", () => {
    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        claude: {
          enabled: true,
        },
        codex: {
          enabled: false,
        },
      },
    };

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual([]);
  });

  it("hides the implicit Codex fallback when Codex auth is missing", () => {
    const config: WebProvidersConfig = { version: 1 };

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

  it("does not activate unavailable tools before agent start", () => {
    process.env.CODEX_API_KEY = "test-key";
    process.env.EXA_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        codex: {
          enabled: true,
        },
        exa: {
          enabled: true,
          apiKey: "EXA_API_KEY",
          tools: {
            search: false,
            contents: true,
            answer: true,
            research: true,
          },
        },
      },
    };

    const activeTools = __test__.getSyncedActiveTools(
      config,
      process.cwd(),
      ["web_search"],
      { addAvailable: false },
    );

    expect(Array.from(activeTools)).toEqual(["web_search"]);
  });

  it("surfaces Perplexity overrides when Perplexity is available", () => {
    process.env.PERPLEXITY_API_KEY = "test-key";

    const config: WebProvidersConfig = {
      version: 1,
      providers: {
        perplexity: {
          enabled: true,
          apiKey: "PERPLEXITY_API_KEY",
        },
      },
    };

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

function mockClaudeAvailable(): void {
  execFileSyncMock.mockImplementation((_command, args: string[]) => {
    if (args.includes("auth") && args.includes("status")) {
      return '{"loggedIn":true,"authMethod":"claude.ai"}';
    }
    throw new Error(`Unexpected Claude command: ${args.join(" ")}`);
  });
}
