import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initTheme,
  stopThemeWatcher,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
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

  it("summarizes single-query search results without provider noise", () => {
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

    expect(summary).toContain("✔ 3 results");
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

    expect(summary).toContain("✔ 5 results");
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

    expect(summary).toContain("✔ 4 results, ✘ 1 of 3 queries failed");
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

    expect(summary).toContain("✔ 1 result, ✘ 1 of 2 queries failed");
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

    expect(summary).toContain("✔ 1 result");
    expect(summary).not.toContain("undefined");
  });

  it("renders failed searches as one-line provider failures", () => {
    const rendered = renderComponentText(
      __test__.renderSearchToolResult(
        {
          content: [{ type: "text", text: "Exa: rate limited." }],
          details: {
            tool: "web_search",
            queryCount: 1,
            failedQueryCount: 1,
            provider: "exa",
            resultCount: 0,
          },
          isError: true,
        },
        false,
        false,
        createTheme(),
      )!,
      120,
    );

    expect(rendered.trimEnd()).toBe("✘ Exa search failed: rate limited");
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

  it("renders a single-answer excerpt in collapsed results", () => {
    const rendered = renderComponentText(
      __test__.renderProviderToolResult(
        {
          content: [
            {
              type: "text",
              text: "example.com is reserved for documentation and examples.\n\nSources:\n1. IANA\n   https://www.iana.org/help/example-domains",
            },
          ],
          details: {
            tool: "web_answer",
            provider: "gemini",
            queryCount: 1,
            failedQueryCount: 0,
          },
        },
        false,
        false,
        "web_answer failed",
        createTheme(),
      )!,
      200,
    );

    expect(rendered).toContain(
      "✔ example.com is reserved for documentation and examples.",
    );
    expect(rendered).toContain("ctrl+o to expand");
    expect(rendered).not.toContain("✔ Answer");
    expect(rendered).not.toContain("Sources");
    expect(rendered).not.toContain("…");
  });

  it("adds an ellipsis only when the answer excerpt is truncated", () => {
    const rendered = renderComponentText(
      __test__.renderProviderToolResult(
        {
          content: [
            {
              type: "text",
              text: "ACME platforms help teams route, normalize, enrich, transform, and govern operational data across migrations, analytics workflows, and compliance reporting.",
            },
          ],
          details: {
            tool: "web_answer",
            provider: "gemini",
            queryCount: 1,
            failedQueryCount: 0,
          },
        },
        false,
        false,
        "web_answer failed",
        createTheme(),
      )!,
      200,
    );

    expect(rendered).toContain("✔ ACME platforms help teams route");
    expect(rendered).toContain("operational data across m…");
    expect(rendered).not.toContain("analytics workflows");
    expect(rendered).not.toContain("...");
  });
});

describe("web_research renderer", () => {
  it("renders a compact research call header", () => {
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

    expect(rendered.startsWith('web_research "ACME platform use cases:')).toBe(
      true,
    );
    expect(rendered).toContain('web_research "');
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
          display: {
            provider: { id: "gemini", label: "Gemini" },
            outcome: { success: "research started" },
          },
        },
        false,
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain("✔ started");
    expect(rendered).toContain("ctrl+o to expand");
    expect(rendered.split("\n")[0]).toContain("✔ started");
  });

  it("keeps long research prompts compact in the call header", () => {
    const rendered = renderComponentText(
      __test__.renderResearchCallHeader(
        {
          input:
            "What is pi coding agent? Provide a concise overview of its purpose, main features, model support, extension system, and typical workflows.",
        },
        createTheme(),
      ),
      60,
    );

    expect(rendered).toContain('web_research "What is pi coding agent?');
    expect(rendered).toContain("...");
    expect(rendered).not.toContain("typical workflows.");
  });

  it("shows dispatch details and the full prompt in the expanded result", () => {
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

    expect(rendered).toContain("Web research");
    expect(rendered).toContain("Brief");
    expect(rendered).toContain(
      "ACME platform landscape: What are the main categories of products in this space, and how do they compare on positioning, capabilities, and deployment model?",
    );
    expect(rendered).toContain("Artifact");
    expect(rendered).toContain("/tmp/report.md");
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

    expect(rendered).toContain("✔ 5m · report.md");
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

    expect(rendered).toContain("Web research");
    expect(rendered).toContain("Investigate the topic");
    expect(rendered).toContain("Artifact");
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

  it("renders collapsed failed completion messages on one line", () => {
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
            completedAt: "2026-03-31T12:02:00.000Z",
            elapsedMs: 120000,
            status: "failed",
            error: "Gemini: rate limited.",
          },
        },
        { expanded: false },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain(
      "✘ Gemini research failed after 2m: rate limited",
    );
    const summaryLines = rendered
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(summaryLines).toHaveLength(1);
  });
});

describe("web_research injected report renderer", () => {
  const message = {
    content: __test__.formatWebResearchReportMessage(
      "Quantum networking overview",
      "# Quantum networking overview\n\nEntanglement is neat.",
      {
        outputPath: "/tmp/project/.pi/artifacts/research/report.md",
        provider: "Gemini",
        status: "completed",
      },
    ),
    details: {
      title: "Quantum networking overview",
      outputPath: "/tmp/project/.pi/artifacts/research/report.md",
      provider: "Gemini",
      query: "Explain quantum networking",
      status: "completed",
    },
  };

  it("renders a one-line collapsed summary with the report title", () => {
    const rendered = renderComponentText(
      __test__.renderWebResearchReportMessage(
        message,
        { expanded: false },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain(
      "Injected research report: Quantum networking overview",
    );
    expect(rendered).toContain("ctrl+o to expand");
    expect(rendered).not.toContain("Entanglement is neat.");
  });

  it("renders the full report with provenance when expanded", () => {
    const rendered = renderComponentText(
      __test__.renderWebResearchReportMessage(
        message,
        { expanded: true },
        createTheme(),
      ),
      120,
    );

    expect(rendered).toContain('Saved web research report');
    expect(rendered).toContain("Quantum networking overview");
    expect(rendered).toContain("Entanglement is neat.");
  });
});

describe("web research widget", () => {
  it("summarizes running researches on a single line", () => {
    const now = Date.parse("2026-06-12T12:00:00.000Z");
    const requests = [
      {
        tool: "web_research" as const,
        id: "a",
        provider: "gemini" as const,
        input: "First brief",
        outputPath: "/tmp/a.md",
        startedAt: "2026-06-12T11:58:00.000Z",
        progress: "starting",
      },
      {
        tool: "web_research" as const,
        id: "b",
        provider: "brave" as const,
        input: "Second brief with a very long text that must not appear",
        outputPath: "/tmp/b.md",
        startedAt: "2026-06-12T11:59:15.000Z",
        progress: "queued",
      },
    ];

    const lines = __test__.buildWebResearchWidgetLines(
      requests,
      createTheme(),
      now,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2 researches running");
    expect(lines[0]).toContain("Gemini 2m0s");
    expect(lines[0]).toContain("Brave 45s");
    expect(lines[0]).toContain("/web-research");
    expect(lines[0]).not.toContain("Second brief");
  });

  it("collapses overflow beyond three jobs into a counter", () => {
    const now = Date.parse("2026-06-12T12:00:00.000Z");
    const requests = Array.from({ length: 5 }, (_, index) => ({
      tool: "web_research" as const,
      id: `job-${index}`,
      provider: "gemini" as const,
      input: `Brief ${index}`,
      outputPath: `/tmp/${index}.md`,
      startedAt: "2026-06-12T11:59:00.000Z",
    }));

    const lines = __test__.buildWebResearchWidgetLines(
      requests,
      createTheme(),
      now,
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("5 researches running");
    expect(lines[0]).toContain("+2 more");
  });
});

describe("partial tool rendering", () => {
  it("shows web_search progress updates in warning text", () => {
    const rendered = renderComponentText(
      __test__.renderSearchToolResult(
        {
          content: [{ type: "text", text: "Searching via Exa: exa sdk" }],
          details: {},
          display: {
            provider: { id: "exa", label: "Exa" },
            progress: { action: "Searching" },
          },
        },
        false,
        true,
        createTheme(),
      )!,
      120,
    );

    expect(rendered).toContain("Searching via Exa");
    expect(rendered).not.toContain("exa sdk");
  });

  it("shows provider tool progress updates from display details", () => {
    const rendered = renderComponentText(
      __test__.renderProviderToolResult(
        {
          content: [{ type: "text", text: "raw progress text" }],
          details: {},
          display: {
            provider: { id: "exa", label: "Exa" },
            progress: { action: "Fetching 2 pages" },
          },
        },
        false,
        true,
        "web_contents failed",
        createTheme(),
      )!,
      120,
    );

    expect(rendered).toContain("Fetching 2 pages via Exa");
    expect(rendered).not.toContain("raw progress text");
  });

  it("shows batched progress counts before the dim provider suffix", () => {
    const rendered = renderComponentText(
      __test__.renderProviderToolResult(
        {
          content: [
            {
              type: "text",
              text: "raw progress text",
            },
          ],
          details: {},
          display: {
            provider: { id: "exa", label: "Exa" },
            progress: { action: "Fetching 1/2 pages" },
          },
        },
        false,
        true,
        "web_contents failed",
        createTheme(),
      )!,
      120,
    );

    expect(rendered).toContain("Fetching 1/2 pages via Exa");
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

    expect(summary).toBe("2 pages");
  });

  it("summarizes contents bytes and mixed page failures", () => {
    const rendered = renderComponentText(
      __test__.renderProviderToolResult(
        {
          content: [{ type: "text", text: "contents" }],
          details: {
            tool: "web_contents",
            provider: "exa",
            itemCount: 2,
          },
          display: {
            outcome: {
              success: "7.3KB (truncated)",
              failure: "1 of 2 pages failed",
            },
          },
        },
        false,
        false,
        "web_contents failed",
        createTheme(),
      )!,
      120,
    );

    expect(rendered).toContain("✔ 7.3KB (truncated), ✘ 1 of 2 pages failed");
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

    expect(summary).toBe("2 answers, 1 of 3 questions failed");
  });

  it("normalizes research summaries without duplicating the provider", () => {
    const summary = __test__.renderCollapsedProviderToolSummary(
      {
        tool: "web_research",
        provider: "gemini",
      },
      undefined,
    );

    expect(summary).toBe("Research");
  });
});

describe("web_search markdown formatting", () => {
  it("does not repeat the query for a single search", () => {
    const rendered = __test__.formatSearchResponses([
      {
        query: "ACME product comparison",
        response: {
          provider: "brave",
          results: [
            {
              title: "ACME Product Comparison",
              url: "https://example.com/acme-product-comparison",
              snippet: "A generic comparison of fictional products.",
            },
          ],
        },
      },
    ]);

    expect(rendered).toContain(
      "1. [ACME Product Comparison](<https://example.com/acme-product-comparison>)",
    );
    expect(rendered).not.toContain("ACME product comparison");
  });

  it("formats multiple queries as H2 sections with proper spacing", () => {
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
  it("does not repeat the question for a single answer", () => {
    const rendered = __test__.formatAnswerResponses([
      {
        query: "What is Beacon Security?",
        response: {
          provider: "brave",
          text: "Beacon Security is a security data management platform.",
        },
      },
    ]);

    expect(rendered).toBe(
      "Beacon Security is a security data management platform.",
    );
  });

  it("formats multiple questions as H2 sections with proper spacing", () => {
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
