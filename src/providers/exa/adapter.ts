import { orderedContents } from "../../contents.js";
import { Exa as ExaClient } from "exa-js";

import type { ContentsResponse } from "../../contents.js";
import { WebfoxError } from "../../errors.js";
import type {
  ProviderContext,
  SearchResponse,
  ToolOutput,
} from "../contract.js";
import type { Exa } from "./types.js";

import { formatJson, trimSnippet } from "../shared.js";

const exaImplementation = {
  async search(
    query: string,
    maxResults: number,
    config: Exa,
    _context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const options = {
      ...(searchOptions ?? {}),
      numResults: maxResults,
    };

    const response = await client.search(query, options as never);

    return {
      provider: "exa",
      results: (response.results ?? [])
        .slice(0, maxResults)
        .map((result: any) => ({
          title: String(result.title ?? result.url ?? "Untitled"),
          url: String(result.url ?? ""),
          snippet: trimSnippet(
            typeof result.text === "string"
              ? result.text
              : Array.isArray(result.highlights)
                ? result.highlights.join(" ")
                : typeof result.summary === "string"
                  ? result.summary
                  : "",
          ),
          score: typeof result.score === "number" ? result.score : undefined,
        })),
    };
  },

  async contents(
    urls: string[],
    config: Exa,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const response = await client.getContents(urls, options as never);

    const results = response.results ?? [];

    return {
      provider: "exa",
      answers: urls.map((url, index) => {
        const result = results[index];
        if (!result) {
          return {
            url,
            error: "No content returned for this URL.",
          };
        }

        return {
          url: typeof result.url === "string" ? result.url : url,
          ...(typeof result.text === "string" ? { content: result.text } : {}),
          ...(result.summary !== undefined ? { summary: result.summary } : {}),
          metadata: result as unknown as Record<string, unknown>,
        };
      }),
    };
  },

  async answer(
    query: string,
    config: Exa,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const client = createClient(config);
    const response = await client.answer(query, options as never);

    const lines: string[] = [];
    lines.push(
      typeof response.answer === "string"
        ? response.answer
        : formatJson(response.answer),
    );

    const citations = response.citations ?? [];
    if (citations.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, citation] of citations.entries()) {
        lines.push(
          `${index + 1}. ${String(citation.title ?? citation.url ?? "Untitled")}`,
        );
        lines.push(`   ${String(citation.url ?? "")}`);
      }
    }

    return {
      provider: "exa",
      text: lines.join("\n").trimEnd(),
      itemCount: citations.length,
    };
  },

  async research(
    input: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    context.signal?.throwIfAborted();
    context.onProgress?.("Exa is researching and synthesizing the report.");
    const client = createClient(config);
    const result = await client.search(input, {
      ...(options ?? {}),
      type: "deep-reasoning",
      outputSchema: {
        type: "text",
        description:
          "A detailed Markdown research report answering the query. Cite sources with links, distinguish evidence from uncertainty, and include a conclusion.",
      },
    });
    const content = result.output?.content;
    if (typeof content !== "string" || !content.trim())
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        "Exa returned no research report.",
      );
    const sources = result.results ?? [];
    const lines = [content.trim()];
    if (sources.length) {
      lines.push("", "Sources:");
      for (const [index, source] of sources.entries())
        lines.push(
          `${index + 1}. ${source.title || source.url}`,
          `   ${source.url}`,
        );
    }
    return {
      provider: "exa",
      text: lines.join("\n"),
      itemCount: sources.length,
    };
  },
};

function createClient(config: Exa): ExaClient {
  const apiKey = config.credentials?.api;
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new ExaClient(apiKey, config.baseUrl);
}

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Exa,
    context: ProviderContext,
  ) {
    return await exaImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async contents(
    input: import("../contract.js").ProviderRequest<"contents">,
    config: Exa,
    context: ProviderContext,
  ) {
    return orderedContents(
      await exaImplementation.contents(
        input.urls,
        config,
        context,
        input.options,
      ),
    );
  },
  async answer(
    input: import("../contract.js").ProviderRequest<"answer">,
    config: Exa,
    context: ProviderContext,
  ) {
    return await exaImplementation.answer(
      input.query,
      config,
      context,
      input.options,
    );
  },
  async research(
    input: import("../contract.js").ProviderRequest<"research">,
    config: Exa,
    context: ProviderContext,
  ) {
    return await exaImplementation.research(
      input.input,
      config,
      context,
      input.options,
    );
  },
};
