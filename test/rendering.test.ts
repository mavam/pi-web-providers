import type { Theme } from "@mariozechner/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initTheme,
  stopThemeWatcher,
} from "../node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { __test__ } from "../src/index.js";

beforeAll(() => {
  initTheme("dark", false);
});

afterAll(() => {
  stopThemeWatcher();
});

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
            "What are the main use cases of modern ACME platforms? Include automation and analytics workflows.",
          ],
          maxResults: 10,
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain(
      '"What are the main use cases of modern ACME platforms? Include automation',
    );
    expect(rendered).toContain("…");
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

  it("falls back gracefully when collapsed search details are missing", () => {
    const summary = renderComponentText(
      __test__.renderCollapsedSearchSummary(
        {} as never,
        '## Query 1: "exa sdk"\n\n1. [Exa SDK](<https://exa.ai/sdk>)\n\n## Query 2: "exa pricing"\n\nSearch failed: Exa: rate limited.',
        createTheme(),
      ),
      120,
    );

    expect(summary).toContain("2 queries, 1 result, 1 failed");
    expect(summary).not.toContain("undefined");
  });

  it("falls back gracefully for single-query collapsed search summaries", () => {
    const summary = renderComponentText(
      __test__.renderCollapsedSearchSummary(
        {} as never,
        "1. [ACME platforms](<https://example.com/>)\n   Tools for routing and transforming operational data.",
        createTheme(),
      ),
      120,
    );

    expect(summary).toContain("1 result");
    expect(summary).not.toContain("undefined");
  });
});

describe("web_answer renderer", () => {
  it("renders a single question on the same line as the tool name", () => {
    const rendered = renderComponentText(
      __test__.renderQuestionCallHeader(
        {
          queries: ["What are common ACME platform use cases?"],
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain(
      'web_answer "What are common ACME platform use cases?"',
    );
    expect(rendered).not.toContain("provider=");
  });

  it("renders multiple questions on separate lines without provider noise", () => {
    const rendered = renderComponentText(
      __test__.renderQuestionCallHeader(
        {
          queries: [
            "What are common ACME platform use cases?",
            "How can an ACME platform help with tool migration?",
          ],
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("web_answer");
    expect(rendered).toContain("  What are common ACME platform use cases?");
    expect(rendered).toContain(
      "  How can an ACME platform help with tool migration?",
    );
    expect(rendered).not.toContain("provider=");
  });
});

describe("web_research renderer", () => {
  it("renders the research brief on its own line", () => {
    const rendered = renderComponentText(
      __test__.renderResearchCallHeader(
        {
          input:
            "ACME platform use cases: what problems do these products solve, who uses them, and in what scenarios?",
        },
        createTheme(),
      ),
      120,
    );

    expect(rendered.startsWith("web_research")).toBe(true);
    expect(rendered).toContain(
      "  ACME platform use cases: what problems do these products solve, who uses them, and in what scenarios?",
    );
    expect(rendered).not.toContain('web_research "');
    expect(rendered).not.toContain("provider=");
  });

  it("summarizes dispatched research jobs in the collapsed tool result", () => {
    const rendered = renderComponentText(
      __test__.renderWebResearchDispatchResult(
        {
          content: [{ type: "text", text: "Started web research via Gemini." }],
          details: {
            tool: "web_research",
            id: "job-1",
            provider: "gemini",
            input: "Investigate the topic",
            outputPath: "/tmp/report.md",
            startedAt: "2026-03-31T12:00:00.000Z",
          },
        },
        false,
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("Started web research via Gemini");
    expect(rendered).toContain("ctrl+o to expand");
  });

  it("shows the full research prompt in the expanded tool result", () => {
    const rendered = renderComponentText(
      __test__.renderWebResearchDispatchResult(
        {
          content: [{ type: "text", text: "Started web research via Gemini." }],
          details: {
            tool: "web_research",
            id: "job-1",
            provider: "gemini",
            input:
              "ACME platform landscape: What are the main categories of products in this space, and how do they compare on positioning, capabilities, and deployment model?",
            outputPath: "/tmp/report.md",
            startedAt: "2026-03-31T12:00:00.000Z",
          },
        },
        true,
        createTheme(),
      ),
      200,
    );

    expect(rendered).toContain(
      "ACME platform landscape: What are the main categories of products in this space, and how do they compare on positioning, capabilities, and deployment model?",
    );
    expect(rendered).not.toContain("Started web research via Gemini.");
  });

  it("renders collapsed completion messages with the saved path", () => {
    const rendered = renderComponentText(
      __test__.renderWebResearchResultMessage(
        {
          content: `# Web research report\n\n## Query\nInvestigate the topic`,
          details: {
            tool: "web_research",
            id: "job-1",
            provider: "gemini",
            input: "Investigate the topic",
            outputPath: "/tmp/project/.pi/artifacts/research/report.md",
            startedAt: "2026-03-31T12:00:00.000Z",
            completedAt: "2026-03-31T12:05:00.000Z",
            elapsedMs: 300000,
            status: "completed",
          },
        },
        { expanded: false },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("Web research completed via Gemini");
    expect(rendered).toContain("○ start: 2026-03-31T12:00:00.000Z");
    expect(rendered).toContain("◴ duration: 5m");
    expect(rendered).toContain(
      "↳ file: /tmp/project/.pi/artifacts/research/report.md",
    );
    expect(rendered).toContain("ctrl+o to expand");
    expect(rendered).not.toContain("# Web research report");
  });

  it("renders expanded successful completion messages as markdown", () => {
    const rendered = renderComponentText(
      __test__.renderWebResearchResultMessage(
        {
          content: `# Web research report\n\n## Query\nInvestigate the topic\n\n- Item one\n- Item two`,
          details: {
            tool: "web_research",
            id: "job-1",
            provider: "gemini",
            input: "Investigate the topic",
            outputPath: "/tmp/project/.pi/artifacts/research/report.md",
            startedAt: "2026-03-31T12:00:00.000Z",
            completedAt: "2026-03-31T12:05:00.000Z",
            elapsedMs: 300000,
            status: "completed",
          },
        },
        { expanded: true },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("Web research report");
    expect(rendered).toContain("Investigate the topic");
    expect(rendered).toContain("Item one");
    expect(rendered).not.toContain("○ start:");
  });

  it("renders expanded failed completion messages as plain error text", () => {
    const rendered = renderComponentText(
      __test__.renderWebResearchResultMessage(
        {
          content: `Gemini: rate limited.`,
          details: {
            tool: "web_research",
            id: "job-1",
            provider: "gemini",
            input: "Investigate the topic",
            outputPath: "/tmp/project/.pi/artifacts/research/report.md",
            startedAt: "2026-03-31T12:00:00.000Z",
            completedAt: "2026-03-31T12:05:00.000Z",
            elapsedMs: 300000,
            status: "failed",
            error: "Gemini: rate limited.",
          },
        },
        { expanded: true },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("Gemini: rate limited.");
    expect(rendered).not.toContain("○ start:");
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
        query: "site:example.com/blog acme platform",
        response: {
          provider: "gemini",
          results: [
            {
              title: "example.com",
              url: "https://example.com/",
              snippet: "Tools for routing and transforming operational data.",
            },
          ],
        },
      },
      {
        query: "site:example.com/product integrations",
        error: "Gemini search request timed out after 12s.",
      },
    ]);

    expect(rendered).toContain(
      '## Query 1: "site:example.com/blog acme platform"\n\n1. [example.com](<https://example.com/>)',
    );
    expect(rendered).toContain(
      "Tools for routing and transforming operational data.",
    );
    expect(rendered).toContain(
      '## Query 2: "site:example.com/product integrations"\n\nSearch failed: Gemini search request timed out after 12s.',
    );
  });
});

describe("web_answer markdown formatting", () => {
  it("formats each question as an H2 with proper spacing", () => {
    const rendered = __test__.formatAnswerResponses([
      {
        query: "What are the main use cases for ACME platforms?",
        response: {
          provider: "gemini",
          text: "ACME platforms help route, normalize, and enrich business data.\n\n- Reduce manual work\n- Improve reporting",
        },
      },
      {
        query: "What problems do ACME platforms solve?",
        error: "Gemini answer request timed out after 12s.",
      },
    ]);

    expect(rendered).toContain(
      '## Question 1: "What are the main use cases for ACME platforms?"\n\nACME platforms help route, normalize, and enrich business data.',
    );
    expect(rendered).toContain("- Reduce manual work");
    expect(rendered).toContain("- Improve reporting");
    expect(rendered).toContain(
      '## Question 2: "What problems do ACME platforms solve?"\n\nAnswer failed: Gemini answer request timed out after 12s.',
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
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}
