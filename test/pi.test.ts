import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import webMuxExtension from "../src/pi.js";
import { customConfig } from "./helpers.js";
const paths: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("uses application inspection and execution and marks partial tool results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "web-mux-pi-"));
  paths.push(directory);
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(customConfig()));
  vi.stubEnv("WEB_MUX_CONFIG", path);
  const tools: any[] = [];
  const events: Record<string, (...args: any[]) => any> = {};
  webMuxExtension({
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
  const result = await tools[0].execute(
    "id",
    { queries: ["success", "fail"] },
    undefined,
    undefined,
    { cwd: directory },
  );
  expect(result.content[0].text).toContain("Result for success");
  expect(events.tool_result({ details: result.details })).toEqual({
    isError: true,
  });
});
