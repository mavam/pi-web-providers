import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import webExtension from "../src/pi.js";
import { customConfig } from "./helpers.js";
const paths: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("uses application inspection and execution and marks partial tool results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webfox-pi-"));
  paths.push(directory);
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(customConfig()));
  vi.stubEnv("WEBFOX_CONFIG", path);
  const tools: any[] = [];
  const events: Record<string, (...args: any[]) => any> = {};
  webExtension({
    registerTool: (tool: any) => tools.push(tool),
    on: (name: string, handler: any) => {
      events[name] = handler;
    },
  } as any);
  expect(tools.map((tool) => tool.name)).toEqual([
    "web_search",
    "web_contents",
    "web_answer",
    "web_research",
  ]);
  expect(tools.map((tool) => tool.label)).toEqual([
    "Web Search",
    "Web Contents",
    "Web Answer",
    "Web Research",
  ]);
  expect(JSON.stringify(tools)).not.toMatch(/fox|mux/i);
  const result = await tools[0].execute(
    "id",
    { queries: ["success", "fail"] },
    undefined,
    undefined,
    { cwd: directory },
  );
  expect(result.content[0].text).toContain("Result for success");
  expect(result.details.webProviderResult).toBe(true);
  expect(
    events.tool_result({ details: { status: "partial" } }),
  ).toBeUndefined();
  expect(events.tool_result({ details: result.details })).toEqual({
    isError: true,
  });
});

it("keeps unconfigured notifications generic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "web-pi-"));
  paths.push(directory);
  const path = join(directory, "config.json");
  await writeFile(path, "{}");
  vi.stubEnv("WEBFOX_CONFIG", path);
  const notify = vi.fn();
  const registerTool = vi.fn();
  const events: Record<string, (...args: any[]) => any> = {};
  webExtension({
    registerTool,
    on: (name: string, handler: any) => {
      events[name] = handler;
    },
  } as any);
  expect(registerTool).not.toHaveBeenCalled();
  events.session_start({}, { hasUI: false, ui: { notify } });
  expect(notify).not.toHaveBeenCalled();
  events.session_start({}, { hasUI: true, ui: { notify } });
  expect(notify).toHaveBeenCalledWith(
    "Web registered no tools. Select a default provider in the shared configuration, then restart pi.",
    "warning",
  );
  expect(JSON.stringify(notify.mock.calls)).not.toMatch(/fox|mux/i);
});
