import { Exa } from "exa-js";
import { resolveConfigValue } from "../config.js";
import type {
  ExaProviderConfig,
  ProviderContext,
  ProviderResearchJob,
  ProviderResearchPollResult,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";
import { asJsonObject, formatJson, trimSnippet } from "./shared.js";

export class ExaProvider implements WebProvider<ExaProviderConfig> {
  readonly id = "exa";
  readonly label = "Exa";
  readonly docsUrl = "https://exa.ai/docs/sdks/typescript-sdk-specification";

  createTemplate(): ExaProviderConfig {
    return {
      enabled: false,
      tools: {
        search: true,
        contents: true,
        answer: true,
        research: true,
      },
      apiKey: "EXA_API_KEY",
      defaults: {
        type: "auto",
        contents: {
          text: true,
        },
      },
    };
  }

  getStatus(config: ExaProviderConfig | undefined): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      return { available: false, summary: "missing apiKey" };
    }
    return { available: true, summary: "enabled" };
  }

  async search(
    query: string,
    maxResults: number,
    searchOptions: Record<string, unknown> | undefined,
    config: ExaProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }

    const client = new Exa(apiKey, config.baseUrl);
    const options = {
      ...asJsonObject(config.defaults),
      ...(searchOptions ?? {}),
      numResults: maxResults,
    };

    context.onProgress?.(`Searching Exa for: ${query}`);
    const response = await client.search(query, options as never);

    return {
      provider: this.id,
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
  }

  async contents(
    urls: string[],
    options: Record<string, unknown> | undefined,
    config: ExaProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }

    const client = new Exa(apiKey, config.baseUrl);
    context.onProgress?.(
      `Fetching contents from Exa for ${urls.length} URL(s)`,
    );
    const response = await client.getContents(urls, options as never);

    const lines: string[] = [];
    for (const [index, result] of (response.results ?? []).entries()) {
      lines.push(
        `${index + 1}. ${String(result.title ?? result.url ?? "Untitled")}`,
      );
      lines.push(`   ${String(result.url ?? "")}`);

      const summary =
        typeof result.summary === "string"
          ? result.summary
          : result.summary
            ? formatJson(result.summary)
            : undefined;
      const text =
        typeof result.text === "string"
          ? result.text
          : Array.isArray(result.highlights)
            ? result.highlights.join(" ")
            : "";
      const body = trimSnippet(summary ?? text);
      if (body) {
        lines.push(`   ${body}`);
      }
      lines.push("");
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents found.",
      summary: `${response.results?.length ?? 0} content result(s) via Exa`,
      itemCount: response.results?.length ?? 0,
    };
  }

  async answer(
    query: string,
    options: Record<string, unknown> | undefined,
    config: ExaProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }

    const client = new Exa(apiKey, config.baseUrl);
    context.onProgress?.(`Getting Exa answer for: ${query}`);
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
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      summary: `Answer via Exa with ${citations.length} source(s)`,
      itemCount: citations.length,
    };
  }

  async startResearch(
    input: string,
    options: Record<string, unknown> | undefined,
    config: ExaProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderResearchJob> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }

    const client = new Exa(apiKey, config.baseUrl);
    context.onProgress?.("Creating Exa research task");
    const task = await client.research.create({
      instructions: input,
      ...(options ?? {}),
    });

    return { id: task.researchId };
  }

  async pollResearch(
    id: string,
    _options: Record<string, unknown> | undefined,
    config: ExaProviderConfig,
    _context: ProviderContext,
  ): Promise<ProviderResearchPollResult> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }

    const client = new Exa(apiKey, config.baseUrl);
    const result = await client.research.get(id, { events: false });

    if (result.status === "completed") {
      const content = result.output?.content;
      return {
        status: "completed",
        output: {
          provider: this.id,
          text:
            typeof content === "string"
              ? content
              : content !== undefined
                ? formatJson(content)
                : "Exa research completed without textual output.",
          summary: "Research via Exa",
        },
      };
    }

    if (result.status === "failed") {
      return {
        status: "failed",
        error: result.error ?? "Exa research failed.",
      };
    }

    if (result.status === "canceled") {
      return {
        status: "cancelled",
        error: "Exa research was canceled.",
      };
    }

    return { status: "in_progress" };
  }
}
