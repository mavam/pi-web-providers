import Parallel from "parallel-web";
import type {
  ParallelProviderConfig,
  ProviderContext,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";
import { resolveConfigValue } from "../config.js";
import { asJsonObject, trimSnippet } from "./shared.js";

export class ParallelProvider implements WebProvider<ParallelProviderConfig> {
  readonly id = "parallel";
  readonly label = "Parallel";
  readonly docsUrl = "https://github.com/parallel-web/parallel-sdk-typescript";

  createTemplate(): ParallelProviderConfig {
    return {
      enabled: false,
      tools: {
        search: true,
        contents: true,
      },
      apiKey: "PARALLEL_API_KEY",
      defaults: {
        search: {
          mode: "agentic",
        },
        extract: {
          excerpts: true,
          full_content: false,
        },
      },
    };
  }

  getStatus(config: ParallelProviderConfig | undefined): ProviderStatus {
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
    options: Record<string, unknown> | undefined,
    config: ParallelProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const defaults = asJsonObject(config.defaults?.search);

    context.onProgress?.(`Searching Parallel for: ${query}`);
    const response = await client.beta.search({
      ...defaults,
      ...(options ?? {}),
      objective: query,
      max_results: maxResults,
    });

    return {
      provider: this.id,
      results: response.results.slice(0, maxResults).map((result) => ({
        title: result.title ?? result.url,
        url: result.url,
        snippet: trimSnippet(result.excerpts?.join(" ") ?? ""),
      })),
    };
  }

  async contents(
    urls: string[],
    options: Record<string, unknown> | undefined,
    config: ParallelProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const client = this.createClient(config);
    const defaults = asJsonObject(config.defaults?.extract);

    context.onProgress?.(
      `Fetching contents from Parallel for ${urls.length} URL(s)`,
    );
    const response = await client.beta.extract({
      ...defaults,
      ...(options ?? {}),
      urls,
    });

    const lines: string[] = [];
    for (const [index, result] of response.results.entries()) {
      lines.push(`${index + 1}. ${result.title ?? result.url}`);
      lines.push(`   ${result.url}`);

      const text = result.excerpts?.join(" ") ?? result.full_content ?? "";
      const snippet = trimSnippet(text);
      if (snippet) {
        lines.push(`   ${snippet}`);
      }
      lines.push("");
    }

    for (const error of response.errors) {
      lines.push(`Error: ${error.url}`);
      lines.push(`   ${error.error_type}`);
      if (error.content) {
        lines.push(`   ${trimSnippet(error.content)}`);
      }
      lines.push("");
    }

    const itemCount = response.results.length;
    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents found.",
      summary: `${itemCount} content result(s) via Parallel`,
      itemCount,
    };
  }

  private createClient(config: ParallelProviderConfig): Parallel {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Parallel is missing an API key.");
    }

    return new Parallel({
      apiKey,
      baseURL: resolveConfigValue(config.baseUrl),
    });
  }
}
