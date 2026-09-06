import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, expect, it, vi } from "vitest";
import webExtension from "../src/pi.js";
import { customConfig } from "./helpers.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  keyText: () => "ctrl+o",
}));
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
  const path = join(directory, "config.yaml");
  await writeFile(
    path,
    stringify(customConfig(), { aliasDuplicateObjects: false }),
  );
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
  const theme = {
    fg: vi.fn((_color, text) => text),
    bold: vi.fn((text) => text),
  };
  for (const tool of tools) {
    const expected = tool.name.replace("_", " ");
    const component = tool.renderCall({}, theme, {});
    expect(component.render(80).join("\n").trimEnd()).toMatch(
      new RegExp(`^${expected} \\(.+ to expand\\)$`),
    );
    expect(theme.fg).toHaveBeenCalledWith("toolTitle", expected);
    expect(theme.bold).toHaveBeenCalledWith(expected);
    expect(tool.renderCall({}, theme, { lastComponent: component })).toBe(
      component,
    );
    for (const line of component.render(6))
      expect(visibleWidth(line)).toBeLessThanOrEqual(6);
    expect(
      tool
        .renderResult(
          {
            content: [{ type: "text", text: "Results" }],
            details: { status: "ok" },
          },
          { expanded: false, isPartial: false },
          theme,
          { isError: false },
        )
        .render(80),
    ).toEqual([]);
  }
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
  const updates: any[] = [];
  const contents = await tools[1].execute(
    "urls",
    { urls: ["https://ok.test", "https://error.test"] },
    undefined,
    (update: any) => updates.push(update),
    { cwd: directory },
  );
  expect(updates[0].details.inputs[0].state).toBe("queued");
  expect(contents.details.inputs).toEqual([
    { input: "https://ok.test", state: "done" },
    { input: "https://error.test", state: "failed" },
  ]);
  expect(result.details.inputs).toEqual([
    { input: "success", state: "done" },
    { input: "fail", state: "failed" },
  ]);
  for (const index of [0, 2, 3]) {
    const updates: any[] = [];
    const completed = await tools[index].execute(
      `vertical-${index}`,
      index === 3 ? { input: "question" } : { queries: ["question"] },
      undefined,
      (update: any) => updates.push(update),
      { cwd: directory },
    );
    expect(
      updates.some((update) => update.details.inputs[0]?.state === "running"),
    ).toBe(true);
    expect(updates[0].details.inputs).toEqual([
      { input: "question", state: "queued" },
    ]);
    expect(completed.details.inputs).toEqual([
      { input: "question", state: "done" },
    ]);
    expect(
      tools[index]
        .renderResult(
          JSON.parse(JSON.stringify(completed)),
          { expanded: false, isPartial: false },
          theme,
          { isError: false },
        )
        .render(80),
    ).toEqual(["✔︎ question"]);
  }
  const restored = JSON.parse(JSON.stringify(contents));
  expect(
    tools[1]
      .renderResult(restored, { expanded: false, isPartial: false }, theme, {
        isError: true,
      })
      .render(80),
  ).toEqual(["✔︎ https://ok.test", "✘︎ https://error.test"]);
});

it("keeps unconfigured notifications generic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "web-pi-"));
  paths.push(directory);
  const path = join(directory, "config.yaml");
  await writeFile(path, "# No providers yet\n");
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
