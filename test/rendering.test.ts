import type { Theme } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { __test__ } from "../src/index.js";

describe("web_search renderer", () => {
  it("shows a compact single-query header and hides default details", () => {
    const rendered = renderComponentText(
      __test__.renderCallHeader(
        {
          queries: ["latest exa typescript sdk docs"],
          maxResults: 5,
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain('web_search "latest exa typescript sdk docs"');
    expect(rendered).not.toContain("provider=");
    expect(rendered).not.toContain("maxResults=");
    expect(rendered).not.toContain("(max");
  });

  it("shows non-default maxResults as a compact header suffix", () => {
    const rendered = renderComponentText(
      __test__.renderCallHeader(
        {
          queries: ["latest exa typescript sdk docs"],
          maxResults: 7,
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain(
      'web_search "latest exa typescript sdk docs" (max 7)',
    );
    expect(rendered).not.toContain("provider=");
    expect(rendered).not.toContain("maxResults=");
  });

  it("shows an ellipsis when the single-query preview is truncated", () => {
    const rendered = renderComponentText(
      __test__.renderCallHeader(
        {
          queries: [
            "What are the main use cases of Tenzir, the security data pipeline platform? Include modern SOC and AI workflows.",
          ],
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
          maxResults: 4,
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("web_search (max 4)");
    expect(rendered).toContain("  exa sdk");
    expect(rendered).toContain("  exa pricing");
    expect(rendered).toContain("  exa api");
    expect(rendered).not.toContain("provider=");
    expect(rendered).not.toContain("maxResults=");
  });

  it("summarizes single-query search results with the resolved provider", () => {
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

    expect(summary).toContain("3 results via Exa");
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

    expect(summary).toContain("2 queries, 5 results via Exa");
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

    expect(summary).toContain("3 queries, 4 results via Exa, 1 failed");
    expect(summary).toContain("to expand");
  });
});

describe("web_answer renderer", () => {
  it("renders a single question on the same line as the tool name", () => {
    const rendered = renderComponentText(
      __test__.renderQuestionCallHeader(
        {
          queries: ["What are common Tenzir use cases?"],
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain(
      'web_answer "What are common Tenzir use cases?"',
    );
    expect(rendered).not.toContain("provider=");
  });

  it("renders multiple questions on separate lines without provider noise", () => {
    const rendered = renderComponentText(
      __test__.renderQuestionCallHeader(
        {
          queries: [
            "What are common Tenzir use cases?",
            "How does Tenzir help with SIEM migration?",
          ],
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("web_answer");
    expect(rendered).toContain("  What are common Tenzir use cases?");
    expect(rendered).toContain("  How does Tenzir help with SIEM migration?");
    expect(rendered).not.toContain("provider=");
  });
});

describe("web_research renderer", () => {
  it("renders the research brief on its own line", () => {
    const rendered = renderComponentText(
      __test__.renderResearchCallHeader(
        {
          input:
            "Tenzir use cases: what problems does Tenzir solve, who uses it, and in what scenarios?",
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered.startsWith("web_research")).toBe(true);
    expect(rendered).toContain(
      "  Tenzir use cases: what problems does Tenzir solve, who uses it, and in what scenarios?",
    );
    expect(rendered).not.toContain('web_research "');
    expect(rendered).not.toContain("provider=");
  });
});

describe("partial tool rendering", () => {
  it("shows web_search progress updates in warning text", () => {
    const rendered = renderComponentText(
      __test__.renderSearchToolResult(
        {
          content: [{ type: "text", text: "Searching via Exa: exa sdk" }],
          details: {},
        },
        false,
        true,
        createTheme(),
      )!,
      120,
    );

    expect(rendered).toContain("Searching via Exa: exa sdk");
  });

  it("shows provider tool progress updates in warning text", () => {
    const rendered = renderComponentText(
      __test__.renderProviderToolResult(
        {
          content: [
            { type: "text", text: "Fetching contents via Exa for 2 URL(s)" },
          ],
          details: {},
        },
        false,
        true,
        "web_contents failed",
        createTheme(),
      )!,
      120,
    );

    expect(rendered).toContain("Fetching contents via Exa for 2 URL(s)");
  });
});

describe("provider tool summaries", () => {
  it("uses shorter collapsed wording for contents summaries", () => {
    const summary = __test__.renderCollapsedProviderToolSummary(
      {
        tool: "web_contents",
        provider: "gemini",
        itemCount: 2,
      },
      undefined,
    );

    expect(summary).toBe("2 pages via Gemini");
  });

  it("keeps the dedicated multi-question answer summary format", () => {
    const summary = __test__.renderCollapsedProviderToolSummary(
      {
        tool: "web_answer",
        provider: "gemini",
        queryCount: 3,
        failedQueryCount: 1,
      },
      undefined,
    );

    expect(summary).toBe("3 questions via Gemini, 1 failed");
  });

  it("normalizes research summaries without duplicating the provider", () => {
    const summary = __test__.renderCollapsedProviderToolSummary(
      {
        tool: "web_research",
        provider: "gemini",
      },
      undefined,
    );

    expect(summary).toBe("Research via Gemini");
  });
});

describe("web_search markdown formatting", () => {
  it("formats each query as an H2 with proper spacing", () => {
    const rendered = __test__.formatSearchResponses([
      {
        query: "site:tenzir.com/blog Tenzir use cases",
        response: {
          provider: "gemini",
          results: [
            {
              title: "tenzir.com",
              url: "https://tenzir.com/",
              snippet: "Security data pipelines for detection and response.",
            },
          ],
        },
      },
      {
        query: "site:tenzir.com/product integrations",
        error: "Gemini search request timed out after 12s.",
      },
    ]);

    expect(rendered).toContain(
      '## Query 1: "site:tenzir.com/blog Tenzir use cases"\n\n1. [tenzir.com](<https://tenzir.com/>)',
    );
    expect(rendered).toContain(
      "Security data pipelines for detection and response.",
    );
    expect(rendered).toContain(
      '## Query 2: "site:tenzir.com/product integrations"\n\nSearch failed: Gemini search request timed out after 12s.',
    );
  });
});

describe("web_answer markdown formatting", () => {
  it("formats each question as an H2 with proper spacing", () => {
    const rendered = __test__.formatAnswerResponses([
      {
        query: "What are the main use cases for Tenzir?",
        response: {
          provider: "gemini",
          text: "Tenzir helps route, normalize, and enrich security data.\n\n- Reduce SIEM cost\n- Improve detections",
        },
      },
      {
        query: "What problems does Tenzir solve?",
        error: "Gemini answer request timed out after 12s.",
      },
    ]);

    expect(rendered).toContain(
      '## Question 1: "What are the main use cases for Tenzir?"\n\nTenzir helps route, normalize, and enrich security data.',
    );
    expect(rendered).toContain("- Reduce SIEM cost");
    expect(rendered).toContain(
      '## Question 2: "What problems does Tenzir solve?"\n\nAnswer failed: Gemini answer request timed out after 12s.',
    );
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
