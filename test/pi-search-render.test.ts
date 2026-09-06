import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  setCapabilities,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchDocument } from "../src/domain.js";
import { renderTextDocument } from "../src/render.js";
import { renderWebResult } from "../src/pi-render.js";
import { renderSearchResult } from "../src/pi-search-render.js";

const capabilities = getCapabilities();
beforeEach(() => setCapabilities({ ...capabilities, hyperlinks: true }));
afterEach(() => setCapabilities(capabilities));
function theme() {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    underline: vi.fn((text: string) => text),
  } as unknown as Theme;
}
function document(): SearchDocument {
  return {
    schemaVersion: 1,
    capability: "search",
    provider: "exa",
    status: "ok",
    results: [
      {
        input: "TypeScript release notes",
        ok: true,
        value: {
          results: [
            {
              title: "packages/documentation/example.md",
              url: "https://example.com/packages",
              snippet:
                "# packages/documentation/… — Branch: v2 --- title: Example --- ## Notes\n**bold** `code` [link](https://not-a-result.test) <b>html</b> &amp;",
            },
          ],
        },
      },
    ],
  };
}

describe("plain-text search result rendering", () => {
  it("keeps source Markdown literal and leaves model-facing content unchanged", () => {
    const doc = document();
    const content = renderTextDocument(doc);
    const result = {
      content: [{ type: "text", text: content }],
      details: {
        webInputStatus: true,
        capability: "search",
        inputs: [{ input: doc.results[0].input, state: "done" }],
        result: doc,
      },
    };
    const original = JSON.stringify(result);
    const th = theme();
    const restored = JSON.parse(original);
    const lines = renderWebResult(
      restored,
      { expanded: true, isPartial: false },
      th,
      false,
    ).render(200);
    const text = stripVTControlCharacters(lines.join("\n"));
    expect(text).toContain("1. packages/documentation/example.md");
    expect(text).toContain("# packages/documentation/");
    expect(text).toContain(
      "**bold** `code` [link](https://not-a-result.test) <b>html</b> &amp;",
    );
    expect(th.fg).not.toHaveBeenCalledWith("mdHeading", expect.anything());
    expect(lines.join("\n")).toContain(
      "\x1b]8;;https://example.com/packages\x1b\\",
    );
    expect(lines.join("\n")).not.toContain("\x1b]8;;https://not-a-result.test");
    expect(JSON.stringify(restored)).toBe(original);
    expect(
      renderWebResult(
        restored,
        { expanded: false, isPartial: false },
        th,
        false,
      )
        .render(100)
        .map(stripVTControlCharacters),
    ).toEqual(["✔︎ TypeScript release notes"]);
  });

  it("formats query headings, empty results, and partial failures explicitly", () => {
    const doc = document();
    doc.status = "partial";
    doc.results.push(
      {
        input: "# Missing",
        ok: false,
        error: { code: "PROVIDER_FAILURE", message: "**not bold**" },
      },
      { input: "Empty", ok: true, value: { results: [] } },
    );
    const th = theme();
    const text = stripVTControlCharacters(
      renderSearchResult({ result: doc }, "unused", th).render(200).join("\n"),
    );
    expect(text).toContain("1. TypeScript release notes");
    expect(text).toContain("2. # Missing");
    expect(text).toContain("Error: **not bold**");
    expect(text).toContain("3. Empty");
    expect(text).toContain("No results found.");
    expect(th.fg).toHaveBeenCalledWith("mdHeading", "2. # Missing");
    expect(th.fg).toHaveBeenCalledWith("error", "Error: **not bold**");
  });

  it("wraps and indents Unicode titles, URLs, and snippets within the available width", () => {
    const doc = document();
    const entry = doc.results[0];
    if (!entry.ok) throw new Error("fixture");
    entry.value.results = Array.from({ length: 10 }, () => ({
      title: "日本語 title ".repeat(5),
      url: "https://example.com/" + "日本語".repeat(15),
      snippet: "# Literal snippet ".repeat(20),
    }));
    const component = renderSearchResult({ result: doc }, "unused", theme());
    for (const width of [1, 2, 6, 30, 80])
      for (const line of component.render(width))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    const lines = component.render(80).map(stripVTControlCharacters);
    expect(lines.some((line) => line.startsWith("10. 日本語"))).toBe(true);
    expect(lines.some((line) => line.startsWith("    https://"))).toBe(true);
    expect(component.render(0)).toEqual([]);
  });

  it("does not turn unsafe URLs or source terminal controls into terminal commands", () => {
    const doc = document();
    const entry = doc.results[0];
    if (!entry.ok) throw new Error("fixture");
    entry.value.results = [
      {
        title: "\x1b[31mRed\x1b[0m",
        url: "javascript:alert(1)",
        snippet: "before\x1b]8;;https://evil.test\x1b\\after\x1b]8;;\x1b\\\x07",
      },
      { title: "Bad URL", url: "https://example.com/\x07", snippet: "text" },
    ];
    const text = renderSearchResult({ result: doc }, "unused", theme())
      .render(100)
      .join("\n");
    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("\x07");
    expect(text).toContain("1. Red");
    expect(text).toContain("beforeafter");
  });

  it("retains readable URLs when terminal hyperlinks are unavailable", () => {
    setCapabilities({ ...capabilities, hyperlinks: false });
    const text = renderSearchResult({ result: document() }, "unused", theme())
      .render(200)
      .join("\n");
    expect(text).toContain("https://example.com/packages");
    expect(text).not.toContain("\x1b]8");
  });

  it("renders truncated and legacy search output literally without loading full-result files", () => {
    const result = {
      content: [
        {
          type: "text",
          text: "# literal snippet\n   https://example.com/\nFull results: /not-loaded/result.json",
        },
      ],
      details: { fullOutputPath: "/not-loaded/result.json" },
    };
    const lines = renderWebResult(
      result,
      { expanded: true, isPartial: false },
      theme(),
      false,
      "search",
    ).render(100);
    expect(stripVTControlCharacters(lines.join("\n"))).toContain(
      "# literal snippet",
    );
    expect(stripVTControlCharacters(lines.join("\n"))).toContain(
      "/not-loaded/result.json",
    );
    expect(lines.join("\n")).toContain("\x1b]8;;https://example.com/\x1b\\");
    expect(
      renderSearchResult(
        { result: { capability: "search", results: [null] } },
        "safe fallback",
        theme(),
      )
        .render(100)
        .join("\n"),
    ).toContain("safe fallback");
  });
});
