import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exaCtorMock, exaGetContentsMock } = vi.hoisted(() => ({
  exaCtorMock: vi.fn(),
  exaGetContentsMock: vi.fn(),
}));

vi.mock("exa-js", () => ({
  Exa: exaCtorMock.mockImplementation(function MockExa() {
    return {
      search: vi.fn(),
      getContents: exaGetContentsMock,
      answer: vi.fn(),
      research: {
        create: vi.fn(),
        get: vi.fn(),
      },
    };
  }),
}));

const originalHome = process.env.HOME;
const cleanupDirs: string[] = [];

beforeEach(async () => {
  const home = mkdtempSync(join(tmpdir(), "pi-web-providers-home-"));
  cleanupDirs.push(home);
  process.env.HOME = home;
  exaCtorMock.mockClear();
  exaGetContentsMock.mockReset();
  const { resetContentStore } = await import("../src/prefetch-manager.js");
  resetContentStore();
});

afterEach(async () => {
  exaCtorMock.mockClear();
  exaGetContentsMock.mockReset();
  const { resetContentStore } = await import("../src/prefetch-manager.js");
  resetContentStore();
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

describe("session cache reset", () => {
  it("clears the in-memory contents cache on session start", async () => {
    const { default: webProvidersExtension, __test__ } = await import(
      "../src/index.js"
    );

    const handlers = new Map<string, Function>();
    webProvidersExtension({
      registerTool() {},
      registerCommand() {},
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
    } as unknown as ExtensionAPI);

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
        title: "Exa SDK",
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

    expect(exaGetContentsMock).toHaveBeenCalledTimes(1);

    const sessionStart = handlers.get("session_start");
    expect(sessionStart).toBeTypeOf("function");
    await sessionStart?.({}, { cwd: process.cwd() });

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

    expect(exaGetContentsMock).toHaveBeenCalledTimes(2);
  });

  it("does not let an in-flight contents request repopulate the cache after session start", async () => {
    const { default: webProvidersExtension, __test__ } = await import(
      "../src/index.js"
    );

    const handlers = new Map<string, Function>();
    webProvidersExtension({
      registerTool() {},
      registerCommand() {},
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
      getActiveTools() {
        return [];
      },
      setActiveTools() {},
    } as unknown as ExtensionAPI);

    const config = {
      version: 1,
      providers: {
        exa: {
          enabled: true,
          apiKey: "literal-key",
        },
      },
    } as const;

    let resolveFirstCall:
      | ((value: {
          results: Array<{ title: string; url: string; text: string }>;
        }) => void)
      | undefined;
    const firstCall = new Promise<{
      results: Array<{ title: string; url: string; text: string }>;
    }>((resolve) => {
      resolveFirstCall = resolve;
    });

    exaGetContentsMock
      .mockImplementationOnce(() => firstCall)
      .mockImplementationOnce(async (urls: string[]) => ({
        results: urls.map((url) => ({
          title: "Exa SDK",
          url,
          text: `Fresh body for ${url}`,
        })),
      }));

    const inFlightRequest = __test__.executeProviderTool({
      capability: "contents",
      config,
      explicitProvider: "exa",
      ctx: { cwd: process.cwd() },
      signal: undefined,
      onUpdate: undefined,
      options: undefined,
      urls: ["https://exa.ai/sdk"],
    });

    await vi.waitFor(() => {
      expect(exaGetContentsMock).toHaveBeenCalledTimes(1);
    });

    const sessionStart = handlers.get("session_start");
    expect(sessionStart).toBeTypeOf("function");
    await sessionStart?.({}, { cwd: process.cwd() });

    resolveFirstCall?.({
      results: [
        {
          title: "Exa SDK",
          url: "https://exa.ai/sdk",
          text: "Stale body from the previous session",
        },
      ],
    });

    await expect(inFlightRequest).resolves.toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining("Stale body from the previous session"),
        },
      ],
    });

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

    expect(exaGetContentsMock).toHaveBeenCalledTimes(2);
  });
});
