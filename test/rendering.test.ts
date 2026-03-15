import type { Theme } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { __test__ } from "../src/index.js";

describe("web_search renderer", () => {
  it("shows a compact call header with a single query and call details", () => {
    const rendered = renderComponentText(
      __test__.renderCallHeader(
        {
          queries: ["latest exa typescript sdk docs"],
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

  it("shows an ellipsis when the single-query preview is truncated", () => {
    const rendered = renderComponentText(
      __test__.renderCallHeader(
        {
          queries: [
            "What are the main use cases of Tenzir, the security data pipeline platform? Include modern SOC and AI workflows.",
          ],
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

  it("shows each query on its own line for multi-query search calls", () => {
    const rendered = renderComponentText(
      __test__.renderCallHeader(
        {
          queries: ["exa sdk", "exa pricing", "exa api"],
          provider: "exa",
          maxResults: 4,
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("web_search");
    expect(rendered).toContain("  exa sdk");
    expect(rendered).toContain("  exa pricing");
    expect(rendered).toContain("  exa api");
    expect(rendered).not.toContain("3 queries");
    expect(rendered).toContain("provider=exa maxResults=4");
  });

  it("collapses search results to the first line until expanded", () => {
    const summary = renderComponentText(
      __test__.renderCollapsedSearchSummary(
        {
          tool: "web_search",
          queryCount: 1,
          failedQueryCount: 0,
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

  it("summarizes multi-query search results by query and result count", () => {
    const summary = renderComponentText(
      __test__.renderCollapsedSearchSummary(
        {
          tool: "web_search",
          queryCount: 2,
          failedQueryCount: 0,
          provider: "exa",
          resultCount: 5,
        },
        'Query 1: "exa sdk"\n1. Exa TypeScript SDK',
        createTheme(),
      ),
      120,
    );

    expect(summary).toContain("2 queries, 5 results via exa");
    expect(summary).toContain("to expand");
  });

  it("includes failed query counts in the multi-query summary", () => {
    const summary = renderComponentText(
      __test__.renderCollapsedSearchSummary(
        {
          tool: "web_search",
          queryCount: 3,
          failedQueryCount: 1,
          provider: "exa",
          resultCount: 4,
        },
        'Query 1: "exa sdk"\n1. Exa TypeScript SDK',
        createTheme(),
      ),
      120,
    );

    expect(summary).toContain("3 queries, 4 results via exa, 1 failed");
    expect(summary).toContain("to expand");
  });
});

describe("web_answer renderer", () => {
  it("renders a single question on its own line below the tool name", () => {
    const rendered = renderComponentText(
      __test__.renderQuestionCallHeader(
        {
          queries: ["What are common Tenzir use cases?"],
          provider: "gemini",
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("web_answer");
    expect(rendered).toContain("  What are common Tenzir use cases?");
    expect(rendered).toContain("provider=gemini");
    expect(rendered).not.toContain(
      'web_answer "What are common Tenzir use cases?"',
    );
  });

  it("renders multiple questions on separate lines", () => {
    const rendered = renderComponentText(
      __test__.renderQuestionCallHeader(
        {
          queries: [
            "What are common Tenzir use cases?",
            "How does Tenzir help with SIEM migration?",
          ],
          provider: "gemini",
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("web_answer");
    expect(rendered).toContain("  What are common Tenzir use cases?");
    expect(rendered).toContain("  How does Tenzir help with SIEM migration?");
    expect(rendered).toContain("provider=gemini");
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
