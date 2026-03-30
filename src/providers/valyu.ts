import { Valyu as ValyuClient } from "valyu-js";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  ToolOutput,
  Valyu,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import {
  asJsonObject,
  formatJson,
  getApiKeyStatus,
  trimSnippet,
} from "./shared.js";

type ValyuAdapter = ProviderAdapter<Valyu> & {
  search(
    query: string,
    maxResults: number,
    config: Valyu,
    context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
  answer(
    query: string,
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
  startResearch(
    input: string,
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob>;
  pollResearch(
    id: string,
    config: Valyu,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchPollResult>;
};

export const valyuAdapter: ValyuAdapter = {
  id: "valyu",
  label: "Valyu",
  docsUrl: "https://docs.valyu.ai/sdk/typescript-sdk",
  tools: ["search", "contents", "answer", "research"] as const,

  createTemplate(): Valyu {
    return {
      apiKey: "VALYU_API_KEY",
      options: {
        searchType: "all",
        responseLength: "short",
      },
    };
  },

  getCapabilityStatus(config: Valyu | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Valyu) {
    return buildProviderPlan({
      request,
      config,
      providerId: valyuAdapter.id,
      providerLabel: valyuAdapter.label,
      handlers: {
        search: {
          deliveryMode: "silent-foreground",
          execute: (
            searchRequest,
            providerConfig: Valyu,
            context: ProviderContext,
          ) =>
            valyuAdapter.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        },
        contents: {
          deliveryMode: "silent-foreground",
          execute: (
            contentsRequest,
            providerConfig: Valyu,
            context: ProviderContext,
          ) =>
            valyuAdapter.contents(
              contentsRequest.urls,
              providerConfig,
              context,
              contentsRequest.options,
            ),
        },
        answer: {
          deliveryMode: "silent-foreground",
          execute: (
            answerRequest,
            providerConfig: Valyu,
            context: ProviderContext,
          ) =>
            valyuAdapter.answer(
              answerRequest.query,
              providerConfig,
              context,
              answerRequest.options,
            ),
        },
        research: {
          deliveryMode: "background-research",
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
            valyuAdapter.startResearch(
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
            valyuAdapter.pollResearch(
              id,
              providerConfig,
              context,
              researchRequest.options,
            ),
        },
      },
    });
  },

  async search(
    query: string,
    maxResults: number,
    config: Valyu,
    _context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const options = {
      ...(stripLocalExecutionOptions(asJsonObject(config.options)) ?? {}),
      ...(searchOptions ?? {}),
      maxNumResults: maxResults,
    };

    const response = await client.search(query, options as never);
    if (!response.success) {
      throw new Error(response.error || "search failed");
    }

    return {
      provider: valyuAdapter.id,
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
  },

  async contents(
    urls: string[],
    config: Valyu,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = createClient(config);
    const response = await client.contents(urls, options as never);
    const finalResponse =
      "jobId" in response
        ? await client.waitForJob(response.jobId, {})
        : response;

    if (!finalResponse.success) {
      throw new Error(finalResponse.error || "contents failed");
    }

    const resultsByUrl = new Map(
      (finalResponse.results ?? []).map(
        (result) => [result.url, result] as const,
      ),
    );

    return {
      provider: valyuAdapter.id,
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
  },

  async answer(
    query: string,
    config: Valyu,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const client = createClient(config);
    const response = await client.answer(query, {
      ...(options ?? {}),
      streaming: false,
    } as never);

    if (!("success" in response) || !response.success) {
      throw new Error(
        "error" in response && typeof response.error === "string"
          ? response.error
          : "answer failed",
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
      provider: valyuAdapter.id,
      text: lines.join("\n").trimEnd(),
      itemCount: sources.length,
    };
  },

  async startResearch(
    input: string,
    config: Valyu,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = createClient(config);
    const task = await client.deepresearch.create({
      input,
      ...(options ?? {}),
    } as never);

    if (!task.success || !task.deepresearch_id) {
      throw new Error(task.error || "deep research creation failed");
    }

    return { id: task.deepresearch_id };
  },

  async pollResearch(
    id: string,
    config: Valyu,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = createClient(config);
    const result = await client.deepresearch.status(id);

    if (!result.success) {
      throw new Error(result.error || "deep research failed");
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
          provider: valyuAdapter.id,
          text: lines.join("\n").trimEnd(),
          itemCount: sources.length,
        },
      };
    }

    if (result.status === "failed") {
      return {
        status: "failed",
        error: result.error || "research failed",
      };
    }

    if (result.status === "cancelled") {
      return {
        status: "cancelled",
        error: result.error || "research was canceled",
      };
    }

    return { status: "in_progress" };
  },
};

function createClient(config: Valyu): ValyuClient {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  return new ValyuClient(apiKey, resolveConfigValue(config.baseUrl));
}
