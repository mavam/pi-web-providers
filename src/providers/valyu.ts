import { Valyu as ValyuClient } from "valyu-js";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderRequest,
  ProviderStatus,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  ToolOutput,
  Valyu,
} from "../types.js";
import {
  backgroundResearchHandler,
  buildProviderPlan,
  silentForegroundHandler,
} from "./framework.js";
import { asJsonObject, formatJson, trimSnippet } from "./shared.js";

export class ValyuAdapter implements ProviderAdapter<Valyu> {
  readonly id: "valyu" = "valyu";
  readonly label = "Valyu";
  readonly docsUrl = "https://docs.valyu.ai/sdk/typescript-sdk";
  readonly tools = ["search", "contents", "answer", "research"] as const;

  createTemplate(): Valyu {
    return {
      enabled: false,
      apiKey: "VALYU_API_KEY",
      options: {
        searchType: "all",
        responseLength: "short",
      },
    };
  }

  getStatus(config: Valyu | undefined): ProviderStatus {
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

  buildPlan(request: ProviderRequest, config: Valyu) {
    return buildProviderPlan({
      request,
      config,
      providerId: this.id,
      providerLabel: this.label,
      handlers: {
        search: silentForegroundHandler(
          (searchRequest, providerConfig: Valyu, context: ProviderContext) =>
            this.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        ),
        contents: silentForegroundHandler(
          (contentsRequest, providerConfig: Valyu, context: ProviderContext) =>
            this.contents(
              contentsRequest.urls,
              providerConfig,
              context,
              contentsRequest.options,
            ),
        ),
        answer: silentForegroundHandler(
          (answerRequest, providerConfig: Valyu, context: ProviderContext) =>
            this.answer(
              answerRequest.query,
              providerConfig,
              context,
              answerRequest.options,
            ),
        ),
        research: backgroundResearchHandler({
          traits: {
            executionSupport: {
              requestTimeoutMs: false,
              retryCount: true,
              retryDelayMs: true,
              pollIntervalMs: true,
              timeoutMs: true,
              maxConsecutivePollErrors: true,
              resumeId: true,
            },
            researchLifecycle: {
              supportsStartRetries: false,
              supportsRequestTimeouts: false,
            },
          },
          start: (
            researchRequest,
            providerConfig: Valyu,
            context: ProviderContext,
          ) =>
            this.startResearch(
              researchRequest.input,
              providerConfig,
              context,
              researchRequest.options,
            ),
          poll: (
            researchRequest,
            providerConfig: Valyu,
            id: string,
            context: ProviderContext,
          ) =>
            this.pollResearch(
              id,
              providerConfig,
              context,
              researchRequest.options,
            ),
        }),
      },
    });
  }

  async search(
    query: string,
    maxResults: number,
    config: Valyu,
    context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const providerOptions = config.options;
    const options = {
      ...(stripLocalExecutionOptions(asJsonObject(providerOptions)) ?? {}),
      ...(searchOptions ?? {}),
      maxNumResults: maxResults,
    };

    const response = await client.search(query, options as never);
    if (!response.success) {
      throw new Error(response.error || "Valyu search failed.");
    }

    return {
      provider: this.id,
      results: (response.results ?? []).slice(0, maxResults).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: trimSnippet(
          result.description ??
            (typeof result.content === "string" ? result.content : ""),
        ),
        score: result.relevance_score,
      })),
    };
  }

  async contents(
    urls: string[],
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = this.createClient(config);
    const response = await client.contents(urls, options as never);
    const finalResponse =
      "jobId" in response
        ? await client.waitForJob(response.jobId, {})
        : response;

    if (!finalResponse.success) {
      throw new Error(finalResponse.error || "Valyu contents failed.");
    }

    const resultsByUrl = new Map(
      (finalResponse.results ?? []).map(
        (result) => [result.url, result] as const,
      ),
    );

    return {
      provider: this.id,
      answers: urls.map((url) => {
        const result = resultsByUrl.get(url);
        if (!result) {
          return {
            url,
            error: "No content returned for this URL.",
          };
        }

        return result.status === "failed"
          ? {
              url,
              error: result.error ?? formatJson(result),
            }
          : {
              url,
              ...(typeof result.content === "string" ||
              typeof result.content === "number"
                ? { content: String(result.content) }
                : {}),
              ...(result.summary !== undefined
                ? { summary: result.summary }
                : {}),
              metadata: result as unknown as Record<string, unknown>,
            };
      }),
    };
  }

  async answer(
    query: string,
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const client = this.createClient(config);
    const response = await client.answer(query, {
      ...(options ?? {}),
      streaming: false,
    } as never);

    if (!("success" in response) || !response.success) {
      throw new Error(
        "error" in response && typeof response.error === "string"
          ? response.error
          : "Valyu answer failed.",
      );
    }

    const lines: string[] = [];
    const contents =
      typeof response.contents === "string"
        ? response.contents
        : formatJson(response.contents);
    lines.push(contents);

    const sources = response.search_results ?? [];
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, result] of sources.entries()) {
        lines.push(`${index + 1}. ${result.title}`);
        lines.push(`   ${result.url}`);
      }
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      itemCount: sources.length,
    };
  }

  async startResearch(
    input: string,
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = this.createClient(config);
    const task = await client.deepresearch.create({
      input,
      ...(options ?? {}),
    } as never);

    if (!task.success || !task.deepresearch_id) {
      throw new Error(task.error || "Valyu deep research creation failed.");
    }

    return { id: task.deepresearch_id };
  }

  async pollResearch(
    id: string,
    config: Valyu,
    context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = this.createClient(config);
    const result = await client.deepresearch.status(id);

    if (!result.success) {
      throw new Error(result.error || "Valyu deep research failed.");
    }

    if (result.status === "completed") {
      const lines: string[] = [];
      lines.push(
        typeof result.output === "string"
          ? result.output
          : result.output
            ? formatJson(result.output)
            : "Valyu deep research completed without textual output.",
      );

      const sources = result.sources ?? [];
      if (sources.length > 0) {
        lines.push("");
        lines.push("Sources:");
        for (const [index, source] of sources.entries()) {
          lines.push(`${index + 1}. ${source.title}`);
          lines.push(`   ${source.url}`);
        }
      }

      return {
        status: "completed",
        output: {
          provider: this.id,
          text: lines.join("\n").trimEnd(),
          itemCount: sources.length,
        },
      };
    }

    if (result.status === "failed") {
      return {
        status: "failed",
        error: result.error || "Valyu deep research failed.",
      };
    }

    if (result.status === "cancelled") {
      return {
        status: "cancelled",
        error: result.error || "Valyu deep research was canceled.",
      };
    }

    return { status: "in_progress" };
  }

  private createClient(config: Valyu): ValyuClient {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }

    return new ValyuClient(apiKey, resolveConfigValue(config.baseUrl));
  }
}
