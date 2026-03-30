import { Exa as ExaClient } from "exa-js";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import type {
  Exa,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  ToolOutput,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import {
  asJsonObject,
  formatJson,
  getApiKeyStatus,
  trimSnippet,
} from "./shared.js";

type ExaAdapter = ProviderAdapter<Exa> & {
  search(
    query: string,
    maxResults: number,
    config: Exa,
    context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
  answer(
    query: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
  startResearch(
    input: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob>;
  pollResearch(
    id: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchPollResult>;
};

export const exaAdapter: ExaAdapter = {
  id: "exa",
  label: "Exa",
  docsUrl: "https://exa.ai/docs/sdks/typescript-sdk-specification",
  tools: ["search", "contents", "answer", "research"] as const,

  createTemplate(): Exa {
    return {
      apiKey: "EXA_API_KEY",
      options: {
        type: "auto",
        contents: {
          text: true,
        },
      },
    };
  },

  getCapabilityStatus(config: Exa | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Exa) {
    return buildProviderPlan({
      request,
      config,
      providerId: exaAdapter.id,
      providerLabel: exaAdapter.label,
      handlers: {
        search: {
          deliveryMode: "silent-foreground",
          execute: (
            searchRequest,
            providerConfig: Exa,
            context: ProviderContext,
          ) =>
            exaAdapter.search(
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
            providerConfig: Exa,
            context: ProviderContext,
          ) =>
            exaAdapter.contents(
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
            providerConfig: Exa,
            context: ProviderContext,
          ) =>
            exaAdapter.answer(
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
            providerConfig: Exa,
            context: ProviderContext,
          ) =>
            exaAdapter.startResearch(
              researchRequest.input,
              providerConfig,
              context,
              researchRequest.options,
            ),
          poll: (
            researchRequest,
            providerConfig: Exa,
            id: string,
            context: ProviderContext,
          ) =>
            exaAdapter.pollResearch(
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
    config: Exa,
    _context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const providerOptions = config.options;
    const options = {
      ...(stripLocalExecutionOptions(asJsonObject(providerOptions)) ?? {}),
      ...(searchOptions ?? {}),
      numResults: maxResults,
    };

    const response = await client.search(query, options as never);

    return {
      provider: exaAdapter.id,
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
      provider: exaAdapter.id,
      answers: urls.map((url, index) => {
        const result = results[index];
        if (!result) {
          return {
            url,
            error: "No content returned for this URL.",
          };
        }

        return {
          url,
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
      provider: exaAdapter.id,
      text: lines.join("\n").trimEnd(),
      itemCount: citations.length,
    };
  },

  async startResearch(
    input: string,
    config: Exa,
    _context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = createClient(config);
    const task = await client.research.create({
      instructions: input,
      ...(options ?? {}),
    });

    return { id: task.researchId };
  },

  async pollResearch(
    id: string,
    config: Exa,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = createClient(config);
    const result = await client.research.get(id, { events: false });

    if (result.status === "completed") {
      const content = result.output?.content;
      return {
        status: "completed",
        output: {
          provider: exaAdapter.id,
          text:
            typeof content === "string"
              ? content
              : content !== undefined
                ? formatJson(content)
                : "Exa research completed without textual output.",
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
  },
};

function createClient(config: Exa): ExaClient {
  const apiKey = resolveConfigValue(config.apiKey);
  if (!apiKey) {
    throw new Error("Exa is missing an API key.");
  }

  return new ExaClient(apiKey, resolveConfigValue(config.baseUrl));
}
