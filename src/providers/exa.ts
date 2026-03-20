import { Exa as ExaClient } from "exa-js";
import { resolveConfigValue } from "../config.js";
import type { ContentsResponse } from "../contents.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import {
  createBackgroundResearchPlan,
  createSilentForegroundPlan,
} from "../provider-plans.js";
import type {
  Exa,
  ProviderAdapter,
  ProviderContext,
  ProviderRequest,
  ProviderStatus,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  ToolOutput,
} from "../types.js";
import { asJsonObject, formatJson, trimSnippet } from "./shared.js";

export class ExaAdapter implements ProviderAdapter<Exa> {
  readonly id: "exa" = "exa";
  readonly label = "Exa";
  readonly docsUrl = "https://exa.ai/docs/sdks/typescript-sdk-specification";
  readonly tools = ["search", "contents", "answer", "research"] as const;

  createTemplate(): Exa {
    return {
      enabled: false,
      apiKey: "EXA_API_KEY",
      options: {
        type: "auto",
        contents: {
          text: true,
        },
      },
    };
  }

  getStatus(config: Exa | undefined): ProviderStatus {
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

  buildPlan(request: ProviderRequest, config: Exa) {
    switch (request.capability) {
      case "search":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.search(
              request.query,
              request.maxResults,
              config,
              context,
              request.options,
            ),
        });
      case "contents":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.contents(request.urls, config, context, request.options),
        });
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.answer(request.query, config, context, request.options),
        });
      case "research":
        return createBackgroundResearchPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
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
          start: (context: ProviderContext) =>
            this.startResearch(request.input, config, context, request.options),
          poll: (id: string, context: ProviderContext) =>
            this.pollResearch(id, config, context, request.options),
        });
      default:
        return null;
    }
  }

  async search(
    query: string,
    maxResults: number,
    config: Exa,
    context: ProviderContext,
    searchOptions?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = this.createClient(config);
    const providerOptions = config.options;
    const options = {
      ...(stripLocalExecutionOptions(asJsonObject(providerOptions)) ?? {}),
      ...(searchOptions ?? {}),
      numResults: maxResults,
    };

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
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const client = this.createClient(config);
    const response = await client.getContents(urls, options as never);

    const results = response.results ?? [];

    return {
      provider: this.id,
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
  }

  async answer(
    query: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const client = this.createClient(config);
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
      itemCount: citations.length,
    };
  }

  async startResearch(
    input: string,
    config: Exa,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = this.createClient(config);
    const task = await client.research.create({
      instructions: input,
      ...(options ?? {}),
    });

    return { id: task.researchId };
  }

  async pollResearch(
    id: string,
    config: Exa,
    _context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = this.createClient(config);
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

  private createClient(config: Exa): ExaClient {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Exa is missing an API key.");
    }

    return new ExaClient(apiKey, resolveConfigValue(config.baseUrl));
  }
}
