import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import webMuxExtension from "../src/pi.js";

const fixture = resolve("test/fixtures/custom-provider.mjs");

afterEach(() => {
  delete process.env.WEB_MUX_CONFIG;
});

describe("pi extension", () => {
  it("warns when no default provider binds any tools", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-mux-pi-empty-"));
    const path = join(directory, "config.json");
    await writeFile(path, "{}");
    process.env.WEB_MUX_CONFIG = path;

    const tools: any[] = [];
    let sessionStart: ((event: unknown, context: any) => void) | undefined;
    await webMuxExtension({
      registerTool: (tool: any) => tools.push(tool),
      on: (event: string, handler: typeof sessionStart) => {
        expect(event).toBe("session_start");
        sessionStart = handler;
      },
    } as any);

    const notify = vi.fn();
    expect(tools).toEqual([]);
    expect(sessionStart).toBeTypeOf("function");
    sessionStart?.({}, { ui: { notify } });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("web config init"),
      "warning",
    );
  });

  it("registers only four bound web tools and executes through the library", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-mux-pi-"));
    const path = join(directory, "config.json");
    const command = { argv: [process.execPath, fixture] };
    await writeFile(
      path,
      JSON.stringify({
        defaults: {
          search: { provider: "custom" },
          contents: { provider: "custom" },
          answer: { provider: "custom" },
          research: { provider: "custom" },
        },
        providers: {
          custom: {
            commands: {
              search: command,
              contents: command,
              answer: command,
              research: command,
            },
          },
        },
      }),
    );
    process.env.WEB_MUX_CONFIG = path;

    const tools: any[] = [];
    const pi = { registerTool: (tool: any) => tools.push(tool) };
    await webMuxExtension(pi as any);
    expect(tools.map((tool) => tool.name)).toEqual([
      "web_search",
      "web_contents",
      "web_answer",
      "web_research",
    ]);
    expect(Object.keys(pi)).toEqual(["registerTool"]);

    const updates: any[] = [];
    const result = await tools[0].execute(
      "call-1",
      { queries: ["pi"] },
      undefined,
      (update: any) => updates.push(update),
      { cwd: process.cwd() },
    );
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Result for pi");
    expect(updates[0].content[0].text).toContain("custom search progress");
  });

  it("exposes the bound provider's exact option schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "web-mux-pi-schema-"));
    const path = join(directory, "config.json");
    await writeFile(
      path,
      JSON.stringify({
        defaults: { search: { provider: "openai" } },
        providers: {
          openai: { credentials: { api: { env: "OPENAI_API_KEY" } } },
        },
      }),
    );
    process.env.WEB_MUX_CONFIG = path;
    const tools: any[] = [];
    await webMuxExtension({
      registerTool: (tool: any) => tools.push(tool),
    } as any);
    expect(tools).toHaveLength(1);
    expect(tools[0].parameters.properties.options.properties).toHaveProperty(
      "searchContextSize",
    );
    expect(tools[0].parameters.properties.options.additionalProperties).toBe(
      false,
    );
  });
});
