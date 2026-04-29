import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import type { WebProviders } from "../src/types.js";

const originalHome = process.env.HOME;
const cleanupDirs: string[] = [];

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "pi-web-providers-home-"));
  cleanupDirs.push(home);
  process.env.HOME = home;
  delete process.env.CODEX_API_KEY;
  delete process.env.EXA_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LINKUP_API_KEY;
  delete process.env.OLLAMA_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.PARALLEL_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.TAVILY_API_KEY;
  delete process.env.VALYU_API_KEY;
});

afterEach(() => {
  delete process.env.EXA_API_KEY;
  delete process.env.CODEX_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.LINKUP_API_KEY;
  delete process.env.OLLAMA_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.SERPER_API_KEY;
  delete process.env.TAVILY_API_KEY;
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

describe("managed tool availability", () => {
  it("keeps tool descriptions concise and capability-specific", async () => {
    process.env.EXA_API_KEY = "test-key";
    writeConfig({
      tools: {
        search: "exa",
        contents: "exa",
        answer: "exa",
        research: "exa",
      },
      providers: {
        exa: {
          credentials: { api: "EXA_API_KEY" },
        },
      },
    });
    const tools: Array<{
      name: string;
      description: string;
      parameters?: {
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
      };
      renderResult?: (...args: any[]) => unknown;
    }> = [];

    const handlers = new Map<string, Function>();

    webProvidersExtension({
      registerTool(tool: { name: string; description: string }) {
        tools.push(tool);
      },
      registerCommand() {},
      registerMessageRenderer() {},
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
    } as unknown as ExtensionAPI);

    await handlers.get("session_start")?.(
      {},
      {
        cwd: process.cwd(),
        hasUI: false,
        ui: {
          setWidget() {},
        },
      },
    );

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
    expect(webContents?.description).toContain(
      "Read and extract the main contents of one or more web pages.",
    );
    expect(webContents?.description).toContain("use separate sibling calls");
    expect(webAnswer?.description).toBe(
      "Answer one or more simple factual questions using web-grounded evidence (up to 10 per call). Prefer web_search plus web_contents when source selection matters, and web_research for multi-step investigations.",
    );
    expect(webAnswer?.parameters?.properties).not.toHaveProperty("query");
    expect(webAnswer?.parameters?.properties).toHaveProperty("queries");
    expect(webAnswer?.parameters?.properties).not.toHaveProperty("provider");
    expect(webResearch?.description).toContain(
      "Start a long-running web research job.",
    );
    expect(webResearch?.description).toContain(
      "Returns immediately with a dispatch notice",
    );
    expect(webResearch?.parameters?.properties).not.toHaveProperty("provider");
  });

  it("registers provider-bound search schemas from configuration", async () => {
    process.env.OLLAMA_API_KEY = "test-key";
    writeConfig({
      tools: {
        search: "ollama",
      },
      providers: {
        ollama: {
          credentials: { api: "OLLAMA_API_KEY" },
        },
      },
    });

    let tools = await captureRegisteredTools();
    let webSearch = tools.find((tool) => tool.name === "web_search");

    expect(webSearch?.parameters?.additionalProperties).toBe(false);
    expect(webSearch?.parameters?.properties).not.toHaveProperty("options");
    expect(
      (webSearch?.parameters?.properties?.maxResults as { maximum?: number })
        ?.maximum,
    ).toBe(10);

    process.env.EXA_API_KEY = "test-key";
    writeConfig({
      tools: {
        search: "exa",
      },
      providers: {
        exa: {
          credentials: { api: "EXA_API_KEY" },
        },
      },
    });

    tools = await captureRegisteredTools();
    webSearch = tools.find((tool) => tool.name === "web_search");

    expect(webSearch?.parameters?.additionalProperties).toBe(false);
    expect(webSearch?.parameters?.properties).toHaveProperty("options");
    const exaOptions = webSearch?.parameters?.properties?.options as {
      additionalProperties?: boolean;
      properties?: Record<string, { additionalProperties?: boolean }>;
    };
    expect(exaOptions.additionalProperties).toBe(false);
    expect(exaOptions.properties).not.toHaveProperty("provider");
    expect(exaOptions.properties).not.toHaveProperty("runtime");
    expect(exaOptions.properties?.userLocation?.additionalProperties).toBe(
      false,
    );
    expect(JSON.stringify(exaOptions)).toContain("includeDomains");
    expect(JSON.stringify(exaOptions)).not.toContain("gl");
    expect(
      (webSearch?.parameters?.properties?.maxResults as { maximum?: number })
        ?.maximum,
    ).toBe(20);
  });

  it("treats mapped Codex search as available without preflighting auth", () => {
    const config = createConfig({
      tools: {
        search: "codex",
      },
      providers: {
        codex: {},
        exa: {
          credentials: { api: "EXA_API_KEY" },
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
        contents: "exa",
        research: "exa",
      },
      providers: {
        exa: {
          credentials: { api: "EXA_API_KEY" },
        },
      },
    });

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_contents", "web_research"]);
  });

  it("does not expose any managed tools when nothing is mapped", () => {
    expect(
      __test__.getAvailableManagedToolNames(createConfig(), process.cwd()),
    ).toEqual([]);
  });

  it("treats mapped Claude search as available without preflighting auth", () => {
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
    ).toEqual(["web_search"]);
  });

  it("hides Custom tools when the mapped capability has no command configured", () => {
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

    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual([]);
  });

  it("lists providers whose capabilities are ready, including auth-less Claude and Codex search", () => {
    const config = createConfig({
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

    expect(
      __test__.getEnabledCompatibleProvidersForTool(
        config,
        process.cwd(),
        "search",
      ),
    ).toEqual(["claude", "codex"]);
    expect(
      __test__.getEnabledCompatibleProvidersForTool(
        config,
        process.cwd(),
        "answer",
      ),
    ).toEqual(["claude", "custom"]);
  });

  it("does not activate unavailable tools before agent start", () => {
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
          credentials: { api: "EXA_API_KEY" },
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

  it("shows a concise config error and removes managed tools on startup", async () => {
    const agentDir = join(process.env.HOME!, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "web-providers.json"),
      JSON.stringify({
        tools: {
          search: "wat",
        },
      }),
    );

    const handlers = new Map<string, Function>();
    const sendMessage = vi.fn();
    const setActiveTools = vi.fn();

    webProvidersExtension({
      registerTool() {},
      registerCommand() {},
      registerMessageRenderer() {},
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
      sendMessage,
      getActiveTools() {
        return ["web_search", "shell"];
      },
      setActiveTools,
    } as unknown as ExtensionAPI);

    const beforeAgentStart = handlers.get("before_agent_start");
    expect(beforeAgentStart).toBeTypeOf("function");

    await expect(
      beforeAgentStart?.(
        {},
        {
          cwd: process.cwd(),
          hasUI: true,
          ui: {
            notify() {},
            setWidget() {},
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledWith({
      customType: "web-providers-config-error",
      content: expect.stringContaining("web-providers config error:"),
      display: true,
    });
    expect(sendMessage.mock.calls[0]?.[0]?.content).toContain(
      "~/.pi/agent/web-providers.json",
    );
    expect(sendMessage.mock.calls[0]?.[0]?.content).not.toContain(
      "parseOptionalLiteral",
    );
    expect(setActiveTools).toHaveBeenCalledWith(["shell"]);
  });

  it("shows partial foreground tool text in the pending tool box", async () => {
    process.env.EXA_API_KEY = "test-key";
    writeConfig({
      tools: {
        search: "exa",
        contents: "exa",
      },
      providers: {
        exa: {
          credentials: { api: "EXA_API_KEY" },
        },
      },
    });

    const tools: Array<{
      name: string;
      description: string;
      parameters?: {
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
      };
      renderResult?: (...args: any[]) => unknown;
    }> = [];

    const handlers = new Map<string, Function>();

    webProvidersExtension({
      registerTool(tool: {
        name: string;
        description: string;
        renderResult?: (...args: any[]) => unknown;
      }) {
        tools.push(tool);
      },
      registerCommand() {},
      registerMessageRenderer() {},
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
    } as unknown as ExtensionAPI);

    await handlers.get("session_start")?.(
      {},
      {
        cwd: process.cwd(),
        hasUI: false,
        ui: {
          setWidget() {},
        },
      },
    );

    const webSearch = tools.find((tool) => tool.name === "web_search");
    const webContents = tools.find((tool) => tool.name === "web_contents");

    const partialSearchRender = webSearch?.renderResult?.(
      {
        content: [{ type: "text", text: "Searching via Exa: exa sdk" }],
      },
      { expanded: false, isPartial: true },
      createTheme(),
    );
    const partialContentsRender = webContents?.renderResult?.(
      {
        content: [
          { type: "text", text: "Fetching contents via Exa for 2 URL(s)" },
        ],
      },
      { expanded: false, isPartial: true },
      createTheme(),
    );

    expect(partialSearchRender).toBeDefined();
    expect(partialContentsRender).toBeDefined();
  });

  it("clears the contents cache when provider config changes", () => {
    const previous = createConfig({
      providers: {
        exa: {
          credentials: { api: "EXA_API_KEY" },
          options: {
            search: {
              type: "auto",
              contents: {
                text: true,
              },
            },
          },
        },
      },
    });

    const next = createConfig({
      providers: {
        exa: {
          credentials: { api: "EXA_API_KEY" },
          options: {
            search: {
              type: "keyword",
              contents: {
                text: false,
              },
            },
          },
        },
      },
    });

    expect(__test__.didContentsCacheInputsChange(previous, next)).toBe(true);
  });
  it("clears the contents cache when saved contents extraction settings change", () => {
    const previous = createConfig({
      providers: {
        parallel: {
          credentials: { api: "PARALLEL_API_KEY" },
          options: {
            extract: {
              full_content: true,
            },
          },
        },
      },
    });

    const next = createConfig({
      providers: {
        parallel: {
          credentials: { api: "PARALLEL_API_KEY" },
          options: {
            extract: {
              full_content: false,
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
          options: {
            webSearchEnabled: true,
          },
        },
      },
    });

    const next = createConfig({
      providers: {
        codex: {
          options: {
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
          credentials: { api: "PERPLEXITY_API_KEY" },
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

  it("surfaces mapped Serper search when Serper is available", () => {
    process.env.SERPER_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "serper",
      },
      providers: {
        serper: {
          credentials: { api: "SERPER_API_KEY" },
        },
      },
    });

    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "search",
      ),
    ).toEqual(["serper"]);
    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "contents",
      ),
    ).toEqual([]);
    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_search"]);
  });

  it("surfaces mapped Tavily tools when Tavily is available", () => {
    process.env.TAVILY_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "tavily",
        contents: "tavily",
      },
      providers: {
        tavily: {
          credentials: { api: "TAVILY_API_KEY" },
        },
      },
    });

    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "search",
      ),
    ).toEqual(["tavily"]);
    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "contents",
      ),
    ).toEqual(["tavily"]);
    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_search", "web_contents"]);
  });

  it("surfaces mapped Linkup tools when Linkup is available", () => {
    process.env.LINKUP_API_KEY = "test-key";

    const config = createConfig({
      tools: {
        search: "linkup",
        contents: "linkup",
      },
      providers: {
        linkup: {
          credentials: { api: "LINKUP_API_KEY" },
        },
      },
    });

    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "search",
      ),
    ).toEqual(["linkup"]);
    expect(
      __test__.getAvailableProviderIdsForCapability(
        config,
        process.cwd(),
        "contents",
      ),
    ).toEqual(["linkup"]);
    expect(
      __test__.getAvailableManagedToolNames(config, process.cwd()),
    ).toEqual(["web_search", "web_contents"]);
  });
});

function createConfig(overrides: Partial<WebProviders> = {}): WebProviders {
  return {
    tools: overrides.tools,
    providers: overrides.providers,
  };
}

function writeConfig(config: WebProviders): void {
  const agentDir = join(process.env.HOME!, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "web-providers.json"), JSON.stringify(config));
}

async function captureRegisteredTools(): Promise<
  Array<{
    name: string;
    description: string;
    parameters?: {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    renderResult?: (...args: any[]) => unknown;
  }>
> {
  const tools: Array<{
    name: string;
    description: string;
    parameters?: {
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
    renderResult?: (...args: any[]) => unknown;
  }> = [];
  const handlers = new Map<string, Function>();

  webProvidersExtension({
    registerTool(tool: {
      name: string;
      description: string;
      parameters?: {
        additionalProperties?: boolean;
        properties?: Record<string, unknown>;
      };
      renderResult?: (...args: any[]) => unknown;
    }) {
      tools.push(tool);
    },
    registerCommand() {},
    registerMessageRenderer() {},
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    getActiveTools() {
      return [];
    },
    setActiveTools() {},
  } as unknown as ExtensionAPI);

  await handlers.get("session_start")?.(
    {},
    {
      cwd: process.cwd(),
      hasUI: false,
      ui: {
        setWidget() {},
      },
    },
  );

  return tools;
}

function createTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}
