import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Box,
  visibleWidth,
  getKeybindings,
  setKeybindings,
  KeybindingsManager as TuiKeybindingsManager,
  TUI_KEYBINDINGS,
} from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebCall, renderWebResult } from "../src/pi-render.js";
import type { Capability } from "../src/domain.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  getMarkdownTheme: () =>
    Object.fromEntries(
      [
        "heading",
        "link",
        "linkUrl",
        "code",
        "codeBlock",
        "codeBlockBorder",
        "quote",
        "quoteBorder",
        "hr",
        "listBullet",
        "bold",
        "italic",
        "strikethrough",
        "underline",
      ].map((key) => [key, (text: string) => text]),
    ),
}));

const originalKeybindings = getKeybindings();
function appKeybindings(binding: string | string[] = "ctrl+o") {
  return new TuiKeybindingsManager(
    { ...TUI_KEYBINDINGS, "app.tools.expand": { defaultKeys: "ctrl+o" } },
    { "app.tools.expand": binding } as ConstructorParameters<
      typeof TuiKeybindingsManager
    >[1],
  );
}
beforeEach(() => setKeybindings(appKeybindings()));
afterEach(() => {
  setKeybindings(originalKeybindings);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function theme() {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
  } as unknown as Theme;
}
function result(
  capability: Capability,
  inputs: { input: string; state: string }[],
) {
  return {
    content: [
      {
        type: "text",
        text: "# Heading\n\n**Bold** result\n\n- Item\n\n```js\nconst x = 1;\n```",
      },
    ],
    details: { webInputStatus: true, capability, inputs },
  };
}
const collapsed = { expanded: false, isPartial: false };
const expanded = { expanded: true, isPartial: false };

describe("vertical web rendering", () => {
  it.each([
    [
      "search",
      { queries: ["Node.js release notes"], maxResults: 5 },
      "web search limit=5",
    ],
    ["contents", { urls: ["https://example.com"] }, "web contents"],
    ["answer", { queries: ["What is MCP?"] }, "web answer"],
    ["research", { input: "Compare Node.js and Bun" }, "web research"],
  ] as const)(
    "keeps %s inputs out of the header",
    (capability, args, expected) => {
      const call = new WebCall(capability);
      const th = theme();
      call.update(args, th, false);
      expect(call.render(120)).toEqual([`${expected} (ctrl+o to expand)`]);
      expect(th.bold).toHaveBeenCalledWith(`web ${capability}`);
      if (capability === "search")
        expect(th.fg).toHaveBeenCalledWith("dim", " limit=5");
      call.update(args, th, true);
      expect(call.render(120)).toEqual([expected]);
    },
  );

  it.each(["search", "contents", "answer", "research"] as const)(
    "renders one status row per %s input",
    (capability) => {
      const th = theme();
      const doc = result(capability, [
        { input: "https://example.com", state: "done" },
        { input: "https://example.org", state: "running" },
      ]);
      expect(renderWebResult(doc, collapsed, th, false).render(120)).toEqual([
        "✔︎ https://example.com",
        "▶︎ https://example.org",
      ]);
      expect(th.fg).toHaveBeenCalledWith("success", "✔︎");
      expect(th.fg).toHaveBeenCalledWith("accent", "https://example.com");
    },
  );

  it("shows explicit provider choices in a gray header, with full details on expansion", () => {
    const call = new WebCall("search");
    const th = theme();
    const args = {
      queries: ["not in header"],
      maxResults: 2,
      options: {
        type: "neural",
        contents: { text: true },
        includeDomains: ["example.com", "docs.example.com"],
      },
    };
    const parameters =
      ' limit=2 type=neural contents.text=true includeDomains=["example.com","docs.example.com"]';
    call.update(args, th, false);
    expect(call.render(200)).toEqual([
      `web search${parameters} (ctrl+o to expand)`,
    ]);
    expect(th.fg).toHaveBeenCalledWith("dim", parameters);
    for (const key of ["limit", "type", "contents.text", "includeDomains"])
      expect(th.bold).toHaveBeenCalledWith(key);
    expect(th.bold).not.toHaveBeenCalledWith("neural");
    expect(call.render(60)).toHaveLength(1);
    expect(call.render(60)[0]).toContain("ctrl+o to expand");
    expect(call.render(60)[0]).not.toContain("docs.example.com");
    call.update(args, th, true);
    expect(call.render(60).length).toBeGreaterThan(1);
    expect(call.render(60).join("\n")).toContain("docs.example.com");
    for (const width of [1, 6, 20, 80])
      for (const line of call.render(width))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    call.update({}, th, false);
    expect(call.render(200)).toEqual(["web search (ctrl+o to expand)"]);
  });

  it("uses the active shortcut and native hint colors, including remaps and disabled bindings", () => {
    const call = new WebCall("answer");
    const th = theme();
    call.update({}, th, false);
    setKeybindings(appKeybindings("ctrl+shift+o"));
    expect(call.render(100)).toEqual(["web answer (ctrl+shift+o to expand)"]);
    expect(th.fg).toHaveBeenCalledWith("dim", "ctrl+shift+o");
    expect(th.fg).toHaveBeenCalledWith("muted", " to expand)");
    setKeybindings(appKeybindings([]));
    expect(call.render(100)).toEqual(["web answer"]);
  });

  it.each(["ctrl+o", "ctrl+shift+o", []] as const)(
    "resolves configured shortcuts when native bundles see a TUI-only singleton: %j",
    (binding) => {
      setKeybindings(new TuiKeybindingsManager(TUI_KEYBINDINGS));
      const directory = mkdtempSync(join(tmpdir(), "webfox-keys-"));
      vi.stubEnv("PI_CODING_AGENT_DIR", directory);
      try {
        writeFileSync(
          join(directory, "keybindings.json"),
          JSON.stringify({ "app.tools.expand": binding }),
        );
        const call = new WebCall("search");
        call.update({}, theme(), false);
        expect(call.render(100)).toEqual([
          typeof binding === "string"
            ? `web search (${binding} to expand)`
            : "web search",
        ]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

  it("uses default shortcuts for missing configuration and honors legacy bindings", () => {
    setKeybindings(new TuiKeybindingsManager(TUI_KEYBINDINGS));
    const directory = mkdtempSync(join(tmpdir(), "webfox-keys-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", directory);
    try {
      const call = new WebCall("contents");
      call.update({}, theme(), false);
      expect(call.render(100)).toEqual(["web contents (ctrl+o to expand)"]);
      const path = join(directory, "keybindings.json");
      writeFileSync(path, "not json");
      expect(call.render(100)).toEqual(["web contents (ctrl+o to expand)"]);
      writeFileSync(
        path,
        JSON.stringify({ expandTools: ["ctrl+shift+o", "ctrl+e"] }),
      );
      expect(call.render(100)).toEqual([
        "web contents (ctrl+shift+o/ctrl+e to expand)",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves shell backgrounds through clipped headers, hints, and status rows", () => {
    const th = {
      fg: (_color: string, text: string) => `\x1b[34m${text}\x1b[39m`,
      bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
    } as Theme;
    const call = new WebCall("search");
    call.update(
      { options: { includeDomains: ["example.com".repeat(30)] } },
      th,
      false,
    );
    const statuses = renderWebResult(
      result("contents", [
        { input: "https://example.com/".repeat(30), state: "done" },
      ]),
      collapsed,
      th,
      false,
    );
    for (const background of [41, 42, 43]) {
      const box = new Box(0, 0, (text) => `\x1b[${background}m${text}\x1b[49m`);
      box.addChild(call);
      box.addChild(statuses);
      const lines = box.render(65);
      expect(stripVTControlCharacters(lines[0])).toContain(
        "... (ctrl+o to expand)",
      );
      for (const line of lines) {
        expect(line.startsWith(`\x1b[${background}m`)).toBe(true);
        expect(line.endsWith("\x1b[49m")).toBe(true);
        expect(line.slice(0, -5)).not.toMatch(/\x1b\[(?:0|49)m/);
        expect(visibleWidth(line)).toBeLessThanOrEqual(65);
      }
    }
  });

  it("uses text-style glyphs for all terminal states and preserves duplicates", () => {
    const doc = result(
      "search",
      ["queued", "running", "done", "failed", "cancelled"].map((state) => ({
        input: "same",
        state,
      })),
    );
    const th = theme();
    expect(renderWebResult(doc, collapsed, th, false).render(80)).toEqual([
      "● same",
      "▶︎ same",
      "✔︎ same",
      "✘︎ same",
      "■ same",
    ]);
    for (const [color, glyph] of [
      ["dim", "●"],
      ["warning", "▶︎"],
      ["success", "✔︎"],
      ["error", "✘︎"],
      ["dim", "■"],
    ])
      expect(th.fg).toHaveBeenCalledWith(color, glyph);
    expect(th.fg).toHaveBeenCalledWith("accent", "same");
  });

  it.each(["contents", "answer", "research"] as const)(
    "renders native Markdown for %s only after expansion",
    (capability) => {
      const doc = result(capability, [{ input: "Question", state: "done" }]);
      expect(
        renderWebResult(doc, collapsed, theme(), false).render(80),
      ).toEqual(["✔︎ Question"]);
      const text = stripVTControlCharacters(
        renderWebResult(doc, expanded, theme(), false).render(80).join("\n"),
      );
      expect(text).toContain("Heading");
      expect(text).toContain("Bold");
      expect(text).toContain("const x = 1;");
      expect(text).not.toContain("# Heading");
      expect(text).not.toContain("**Bold**");
      // Native Markdown retains themed fence borders and indents code blocks.
      expect(text).toContain("  const x = 1;");
      expect(doc.content[0].text).toContain("**Bold**");
      expect(
        renderWebResult(
          doc,
          { expanded: true, isPartial: true },
          theme(),
          false,
        )
          .render(80)
          .join("\n"),
      ).not.toContain("Heading");
    },
  );

  it("supports persisted URL status rows from older sessions", () => {
    const doc = {
      content: [],
      details: {
        webContentsStatus: true,
        urls: [{ url: "https://example.com", state: "done" }],
      },
    };
    expect(renderWebResult(doc, collapsed, theme(), false).render(80)).toEqual([
      "✔︎ https://example.com",
    ]);
  });

  it("clips each collapsed input and reveals long inputs when expanded", () => {
    const doc = result("research", [
      { input: "🔎 日本語 ".repeat(30) + "end", state: "running" },
    ]);
    const small = renderWebResult(doc, collapsed, theme(), false);
    expect(small.render(40)).toHaveLength(1);
    const full = renderWebResult(
      doc,
      { expanded: true, isPartial: true },
      theme(),
      false,
    );
    expect(full.render(40).length).toBeGreaterThan(1);
    expect(full.render(40).join("\n")).toContain("end");
    for (const component of [small, full]) {
      for (const width of [1, 6, 20, 80]) {
        for (const line of component.render(width))
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      expect(component.render(0)).toEqual([]);
    }
  });

  it("escapes control characters and removes terminal sequences in inputs", () => {
    const input = 'hello\n"quoted"\t\u001b[31mred\u001b[0m\u0007';
    const doc = result("search", [{ input, state: "done" }]);
    expect(renderWebResult(doc, collapsed, theme(), false).render(120)).toEqual(
      ['✔︎ hello\\n\\"quoted\\"\\tred\\u0007'],
    );
  });

  it.each([undefined, null, {}, { queries: null }, { queries: [null, 42] }])(
    "tolerates incomplete call arguments: %j",
    (args) => {
      const call = new WebCall("search");
      call.update(args, theme(), false);
      expect(call.render(80)).toEqual(["web search (ctrl+o to expand)"]);
      for (const width of [1, 6, 20]) {
        for (const line of call.render(width))
          expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
      expect(call.render(0)).toEqual([]);
    },
  );

  it("keeps errors without status details visible and formats expanded legacy results", () => {
    const error = {
      content: [
        { type: "text", text: "Exa needs a credential.\nMore details" },
      ],
    };
    expect(renderWebResult(error, collapsed, theme(), true).render(80)).toEqual(
      ["✘︎ Exa needs a credential."],
    );
    const progressTheme = theme();
    expect(
      renderWebResult(
        { content: [{ type: "text", text: "Working…" }] },
        { expanded: false, isPartial: true },
        progressTheme,
        false,
      ).render(80),
    ).toEqual(["▶︎ Working…"]);
    expect(progressTheme.fg).toHaveBeenCalledWith("warning", "▶︎");
    expect(progressTheme.fg).toHaveBeenCalledWith("muted", "Working…");
    const legacy = { content: [{ type: "text", text: "# Legacy heading" }] };
    expect(
      renderWebResult(legacy, collapsed, theme(), false).render(80),
    ).toEqual([]);
    const text = renderWebResult(legacy, expanded, theme(), false)
      .render(80)
      .join("\n");
    expect(text).toContain("Legacy heading");
    expect(text).not.toContain("# Legacy heading");
  });
});
