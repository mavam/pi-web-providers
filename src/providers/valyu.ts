import { Valyu } from "valyu-js";
import { resolveConfigValue } from "../config.js";
import { stripLocalExecutionOptions } from "../execution-policy.js";
import {
  createBackgroundResearchPlan,
  createSilentForegroundPlan,
} from "../provider-plans.js";
import type {
  JsonValue,
  ProviderContentsMetadataEntry,
  ProviderContext,
  ProviderOperationRequest,
  ProviderResearchJob,
  ProviderResearchPollResult,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  ValyuProviderConfig,
  WebProvider,
} from "../types.js";
import {
  asJsonObject,
  formatJson,
  normalizeContentText,
  pushIndentedBlock,
  trimSnippet,
} from "./shared.js";

export class ValyuProvider implements WebProvider<ValyuProviderConfig> {
  readonly id: "valyu" = "valyu";
  readonly label = "Valyu";
  readonly docsUrl = "https://docs.valyu.ai/sdk/typescript-sdk";
  readonly capabilities = ["search", "contents", "answer", "research"] as const;

  createTemplate(): ValyuProviderConfig {
    return {
      enabled: false,
      apiKey: "VALYU_API_KEY",
      native: {
        searchType: "all",
        responseLength: "short",
      },
    };
  }

  getStatus(config: ValyuProviderConfig | undefined): ProviderStatus {
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

  buildPlan(request: ProviderOperationRequest, config: ValyuProviderConfig) {
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
              request.options,
              config,
              context,
            ),
        });
      case "contents":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.contents(request.urls, request.options, config, context),
        });
      case "answer":
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.answer(request.query, request.options, config, context),
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
            this.startResearch(request.input, request.options, config, context),
          poll: (id: string, context: ProviderContext) =>
            this.pollResearch(id, request.options, config, context),
        });
      default:
        return null;
    }
  }

  async search(
    query: string,
    maxResults: number,
    searchOptions: Record<string, unknown> | undefined,
    config: ValyuProviderConfig,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }

    const client = new Valyu(apiKey, config.baseUrl);
    const native = config.native ?? config.defaults;
    const options = {
      ...(stripLocalExecutionOptions(asJsonObject(native)) ?? {}),
      ...(searchOptions ?? {}),
      maxNumResults: maxResults,
    };

    context.onProgress?.(`Searching Valyu for: ${query}`);
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
    options: Record<string, unknown> | undefined,
    config: ValyuProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }

    const client = new Valyu(apiKey, config.baseUrl);
    context.onProgress?.(
      `Fetching contents from Valyu for ${urls.length} URL(s)`,
    );
    const response = await client.contents(urls, options as never);
    const finalResponse =
      "jobId" in response
        ? await client.waitForJob(response.jobId, {
            onProgress: (status) =>
              context.onProgress?.(
                `Fetching contents from Valyu: ${status.urlsProcessed}/${status.urlsTotal} processed`,
              ),
          })
        : response;

    if (!finalResponse.success) {
      throw new Error(finalResponse.error || "Valyu contents failed.");
    }

    const results = finalResponse.results ?? [];
    const lines: string[] = [];
    const contentsEntries: ProviderContentsMetadataEntry[] =
      results.flatMap<ProviderContentsMetadataEntry>((result, index) => {
        const entryLines = [`${index + 1}. ${result.url}`];
        if (result.status === "failed") {
          const body = normalizeContentText(`Failed: ${result.error}`);
          pushIndentedBlock(entryLines, body);
          lines.push(...entryLines, "");
          return [
            {
              url: result.url,
              title: result.url,
              body,
              status: "failed",
            },
          ];
        }

        const contentText =
          typeof result.content === "string" ||
          typeof result.content === "number"
            ? String(result.content)
            : result.content
              ? formatJson(result.content)
              : typeof result.summary === "string"
                ? result.summary
                : result.summary
                  ? formatJson(result.summary)
                  : "";
        const body = normalizeContentText(contentText);
        if (result.title) {
          entryLines.push(`   ${result.title}`);
        }
        pushIndentedBlock(entryLines, body);
        lines.push(...entryLines, "");
        return [
          {
            url: result.url,
            title: result.title,
            body,
            summary: "1 content result via Valyu",
            status: "ready",
          },
        ];
      });

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd() || "No contents found.",
      summary: `${results.length} content result(s) via Valyu`,
      itemCount: results.length,
      metadata: {
        contentsEntries: contentsEntries as unknown as JsonValue,
      },
    };
  }

  async answer(
    query: string,
    options: Record<string, unknown> | undefined,
    config: ValyuProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }

    const client = new Valyu(apiKey, config.baseUrl);
    context.onProgress?.(`Getting Valyu answer for: ${query}`);
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
      summary: `Answer via Valyu with ${sources.length} source(s)`,
      itemCount: sources.length,
    };
  }

  async startResearch(
    input: string,
    options: Record<string, unknown> | undefined,
    config: ValyuProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderResearchJob> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }

    const client = new Valyu(apiKey, config.baseUrl);
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
    _options: Record<string, unknown> | undefined,
    config: ValyuProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderResearchPollResult> {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("Valyu is missing an API key.");
    }

    const client = new Valyu(apiKey, config.baseUrl);
    const result = await client.deepresearch.status(id);

    if (!result.success) {
      throw new Error(result.error || "Valyu deep research failed.");
    }

    const progress = result.progress;
    if (progress) {
      context.onProgress?.(
        `Researching via Valyu: step ${progress.current_step}/${progress.total_steps}`,
      );
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
          summary: `Research via Valyu with ${sources.length} source(s)`,
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
}
