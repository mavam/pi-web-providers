import { describe, expect, it } from "vitest";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { __test__ } from "../src/index.js";

describe("web_search renderer", () => {
  it("shows a compact call header with query and call details", () => {
    const rendered = renderComponentText(
      __test__.renderCallHeader(
        {
          query: "latest exa typescript sdk docs",
          provider: "codex",
          maxResults: 7,
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain('web_search "latest exa typescript sdk docs"');
    expect(rendered).toContain("provider=codex maxResults=7");
  });

  it("shows an ellipsis when the query preview is truncated", () => {
    const rendered = renderComponentText(
      __test__.renderCallHeader(
        {
          query:
            "What are the main use cases of Tenzir, the security data pipeline platform? Include modern SOC and AI workflows.",
          provider: "gemini",
          maxResults: 10,
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain(
      '"What are the main use cases of Tenzir, the security data pipeline platform? Inc…"',
    );
  });

  it("collapses search results to the first line until expanded", () => {
    const summary = renderComponentText(
      __test__.renderCollapsedSearchSummary(
        {
          tool: "web_search",
          query: "exa sdk",
          provider: "exa",
          resultCount: 3,
        },
        "1. Exa TypeScript SDK\n   https://exa.ai/docs",
        createTheme(),
      ),
      120,
    );

    expect(summary).toContain("1. Exa TypeScript SDK");
    expect(summary).toContain("to expand");
    expect(summary).not.toContain("https://exa.ai/docs");
  });
});

function renderComponentText(
  component: { render(width: number): string[] },
  width: number,
): string {
  return component.render(width).join("\n");
}

function createTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}
