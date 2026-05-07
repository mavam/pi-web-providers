import { describe, expect, it } from "vitest";
import {
  buildCollapsedProviderToolSummary,
  buildProgressDisplay,
  buildProviderToolDisplay,
  buildSearchToolDisplay,
} from "../src/tool-display.js";

describe("tool display summaries", () => {
  it("builds search display outcomes from structured facts", () => {
    expect(
      buildSearchToolDisplay({
        tool: "web_search",
        provider: "exa",
        queryCount: 3,
        failedQueryCount: 1,
        resultCount: 4,
      }),
    ).toMatchObject({
      provider: { id: "exa", label: "Exa" },
      outcome: { success: "4 results", failure: "1 of 3 queries failed" },
    });
  });

  it("builds answer summaries without rendering markdown", () => {
    expect(
      buildCollapsedProviderToolSummary(
        {
          tool: "web_answer",
          provider: "gemini",
          queryCount: 3,
          failedQueryCount: 1,
        },
        undefined,
      ),
    ).toBe("2 answers, 1 of 3 questions failed");
  });

  it("builds contents truncation summaries from metadata", () => {
    expect(
      buildProviderToolDisplay({
        capability: "contents",
        providerId: "exa",
        details: { tool: "web_contents", provider: "exa", itemCount: 2 },
        text: "contents",
        outputBytes: 7300,
        outputTruncated: true,
        failedItemCount: 1,
      }).outcome,
    ).toEqual({
      success: "7.1KB (truncated)",
      failure: "1 of 2 pages failed",
    });
  });

  it("builds progress display with provider labels", () => {
    expect(buildProgressDisplay("exa", "Fetching 1/2 pages")).toEqual({
      provider: { id: "exa", label: "Exa" },
      progress: { action: "Fetching 1/2 pages" },
    });
  });
});
