import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { WebCall, renderWebResult } from "../src/pi-render.js";
import type { Capability } from "../src/domain.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  keyText: () => "ctrl+o",
}));

function setup(capability: Capability, args: unknown, expanded = true) {
  const theme = {
    fg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
  };
  const call = new WebCall(capability);
  call.update(args, theme as unknown as Theme, expanded);
  return { call, theme };
}

describe("web result rendering", () => {
  const theme = {
    fg: (_color: string, text: string) => text,
  } as unknown as Theme;
  const result = {
    content: [{ type: "text", text: "First result\nSecond result" }],
    details: { status: "ok" },
  };
  it("renders stable URL rows with status glyphs while keeping page bodies collapsed", () => {
    const urls = ["queued", "running", "done", "failed", "cancelled"].map(
      (state) => ({ url: "https://example.test/" + state, state }),
    );
    const contents = { ...result, details: { webContentsStatus: true, urls } };
    const component = renderWebResult(
      contents,
      { expanded: false, isPartial: false },
      theme,
      false,
    );
    expect(component.render(80)).toEqual([
      "○ https://example.test/queued",
      "◌ https://example.test/running",
      "✓ https://example.test/done",
      "✗ https://example.test/failed",
      "− https://example.test/cancelled",
    ]);
    for (const line of component.render(12))
      expect(visibleWidth(line)).toBeLessThanOrEqual(12);
    expect(
      renderWebResult(
        contents,
        { expanded: true, isPartial: false },
        theme,
        false,
      )
        .render(80)
        .join("\n"),
    ).toContain("First result");
    expect(
      renderWebResult(
        contents,
        { expanded: true, isPartial: true },
        theme,
        false,
      ).render(80),
    ).toHaveLength(5);
  });
  it("hides successful bodies until expanded without changing the result", () => {
    expect(
      renderWebResult(
        result,
        { expanded: false, isPartial: false },
        theme,
        false,
      ).render(80),
    ).toEqual([]);
    expect(
      renderWebResult(
        result,
        { expanded: true, isPartial: false },
        theme,
        false,
      )
        .render(80)
        .map((line) => line.trimEnd()),
    ).toEqual(["First result", "Second result"]);
    expect(result.content[0].text).toBe("First result\nSecond result");
  });
  it("keeps errors and partial failures visible when collapsed", () => {
    const error = {
      content: [
        { type: "text", text: "Exa needs a credential.\nMore details" },
      ],
    };
    expect(
      renderWebResult(
        error,
        { expanded: false, isPartial: false },
        theme,
        true,
      ).render(80),
    ).toEqual(["✗ Exa needs a credential."]);
    const partial = { ...result, details: { status: "partial" } };
    expect(
      renderWebResult(
        partial,
        { expanded: false, isPartial: false },
        theme,
        false,
      ).render(80)[0],
    ).toContain("inputs failed");
  });
  it("shows bounded progress and preserves full expanded progress", () => {
    const progress = {
      content: [
        { type: "text", text: "Working ".repeat(100) + "\nMore progress" },
      ],
    };
    const component = renderWebResult(
      progress,
      { expanded: false, isPartial: true },
      theme,
      false,
    );
    expect(component.render(40)).toHaveLength(1);
    expect(visibleWidth(component.render(40)[0])).toBeLessThanOrEqual(40);
    expect(component.render(0)).toEqual([]);
    expect(
      renderWebResult(
        progress,
        { expanded: true, isPartial: true },
        theme,
        false,
      )
        .render(80)
        .join("\n"),
    ).toContain("More progress");
  });
});

describe("web call rendering", () => {
  it.each([
    [
      "search",
      { queries: ["Node.js release notes"], maxResults: 5 },
      'web search "Node.js release notes" limit 5',
    ],
    [
      "contents",
      { urls: ["https://example.com/docs"] },
      "web contents https://example.com/docs",
    ],
    [
      "answer",
      { queries: ["What is MCP?", "What is A2A?"] },
      'web answer "What is MCP?" "What is A2A?"',
    ],
    [
      "research",
      { input: "Compare Node.js and Bun" },
      'web research "Compare Node.js and Bun"',
    ],
  ] as const)("shows readable inputs for %s", (capability, args, expected) => {
    const { call, theme } = setup(capability, args);
    expect(call.render(120)).toEqual([expected]);
    expect(theme.bold).toHaveBeenCalledWith(`web ${capability}`);
    expect(theme.fg).toHaveBeenCalledWith("accent", expect.any(String));
    if (capability === "search")
      expect(theme.fg).toHaveBeenCalledWith("warning", "5");
  });

  it("uses argument semantics, not URL-looking text, to choose quotation", () => {
    expect(
      setup("search", { queries: ["https://example.com"] }).call.render(80),
    ).toEqual(['web search "https://example.com"']);
    expect(setup("contents", { urls: ["https://"] }).call.render(80)).toEqual([
      "web contents https://",
    ]);
  });

  it.each([undefined, null, {}, { queries: null }, { queries: [null, 42] }])(
    "tolerates incomplete arguments: %j",
    (args) => {
      expect(setup("search", args).call.render(80)).toEqual(["web search"]);
    },
  );

  it("escapes control characters and removes terminal sequences", () => {
    const input = 'hello\n"quoted"\t\u001b[31mred\u001b[0m\u0007';
    const { call } = setup("search", { queries: [input] });
    expect(call.render(120)).toEqual([
      'web search "hello\\n\\"quoted\\"\\tred\\u0007"',
    ]);
  });

  it("clips collapsed previews with a hint and reveals inputs when expanded", () => {
    const args = { queries: ["Long query ".repeat(25), "Second query"] };
    const { call, theme } = setup("search", args, false);
    const collapsed = call.render(80);
    expect(collapsed).toHaveLength(1);
    expect(stripVTControlCharacters(collapsed[0])).toContain("to expand");
    call.update(args, theme as unknown as Theme, true);
    const expanded = call.render(80);
    expect(expanded.length).toBeGreaterThan(1);
    expect(expanded.join("\n")).toContain('"Second query"');
    for (const width of [1, 6, 20, 80]) {
      for (const line of call.render(width))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    expect(call.render(0)).toEqual([]);
  });

  it("fits Unicode previews and updates themes without stale styles", () => {
    const { call } = setup(
      "search",
      { queries: ["🔎 日本語 ".repeat(40)] },
      false,
    );
    for (const width of [1, 6, 20, 80]) {
      for (const line of call.render(width))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    const fg = vi.fn(
      (_color: string, text: string) => `\u001b[34m${text}\u001b[0m`,
    );
    call.update(
      { queries: ["new"] },
      { fg, bold: (text: string) => text } as unknown as Theme,
      false,
    );
    call.invalidate();
    const line = call.render(80)[0];
    expect(line).toContain("\u001b[34m");
    expect(stripVTControlCharacters(line)).toMatch(
      /^web search "new" \(.+ to expand\)$/,
    );
  });
});
