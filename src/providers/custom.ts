import type { ContentsAnswer, ContentsResponse } from "../contents.js";
import type {
  Custom,
  CustomCommandConfig,
  ProviderAdapter,
  ProviderContext,
  ProviderRequest,
  ProviderStatus,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { buildProviderPlan, silentForegroundHandler } from "./framework.js";
import { runCliJsonCommand } from "./cli-json.js";

export class CustomAdapter implements ProviderAdapter<Custom> {
  readonly id: "custom" = "custom";
  readonly label = "Custom";
  readonly docsUrl =
    "https://github.com/mavam/pi-web-providers#custom-provider";
  readonly tools = ["search", "contents", "answer", "research"] as const;

  createTemplate(): Custom {
    return {
      enabled: false,
    };
  }

  getStatus(
    config: Custom | undefined,
    _cwd: string,
    capability?: Tool,
  ): ProviderStatus {
    if (!config) {
      return { available: false, summary: "not configured" };
    }
    if (config.enabled === false) {
      return { available: false, summary: "disabled" };
    }

    if (capability) {
      return hasCommandForCapability(config, capability)
        ? { available: true, summary: "enabled" }
        : {
            available: false,
            summary: `no command configured for ${capability}`,
          };
    }

    return hasAnyCommand(config)
      ? { available: true, summary: "enabled" }
      : { available: false, summary: "no commands configured" };
  }

  buildPlan(request: ProviderRequest, config: Custom) {
    return buildProviderPlan({
      request,
      config,
      providerId: this.id,
      providerLabel: this.label,
      handlers: {
        search: silentForegroundHandler(
          (searchRequest, providerConfig: Custom, context: ProviderContext) =>
            this.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        ),
        contents: silentForegroundHandler(
          (contentsRequest, providerConfig: Custom, context: ProviderContext) =>
            this.contents(
              contentsRequest.urls,
              providerConfig,
              context,
              contentsRequest.options,
            ),
        ),
        answer: silentForegroundHandler(
          (answerRequest, providerConfig: Custom, context: ProviderContext) =>
            this.answer(
              answerRequest.query,
              providerConfig,
              context,
              answerRequest.options,
            ),
        ),
        research: silentForegroundHandler(
          (researchRequest, providerConfig: Custom, context: ProviderContext) =>
            this.research(
              researchRequest.input,
              providerConfig,
              context,
              researchRequest.options,
            ),
        ),
      },
    });
  }

  async search(
    query: string,
    maxResults: number,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const output = await this.runCommand<unknown>({
      capability: "search",
      payload: {
        capability: "search",
        query,
        maxResults,
        ...(options ? { options } : {}),
      },
      config,
      context,
    });

    return parseSearchResponse(output, this.id);
  }

  async contents(
    urls: string[],
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const output = await this.runCommand<unknown>({
      capability: "contents",
      payload: {
        capability: "contents",
        urls,
        ...(options ? { options } : {}),
      },
      config,
      context,
    });

    return parseContentsResponse(output, this.id, urls);
  }

  async answer(
    query: string,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const output = await this.runCommand<unknown>({
      capability: "answer",
      payload: {
        capability: "answer",
        query,
        ...(options ? { options } : {}),
      },
      config,
      context,
    });

    return parseToolOutput(output, this.id);
  }

  async research(
    input: string,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const output = await this.runCommand<unknown>({
      capability: "research",
      payload: {
        capability: "research",
        input,
        ...(options ? { options } : {}),
      },
      config,
      context,
    });

    return parseToolOutput(output, this.id);
  }

  private async runCommand<TOutput>({
    capability,
    payload,
    config,
    context,
  }: {
    capability: Tool;
    payload: Record<string, unknown>;
    config: Custom;
    context: ProviderContext;
  }): Promise<TOutput> {
    const command = getCommandConfig(config, capability);
    if (!command) {
      throw new Error(`Custom has no command configured for ${capability}.`);
    }

    return await runCliJsonCommand<TOutput>({
      command,
      payload: {
        ...payload,
        cwd: context.cwd,
      },
      context,
      label: `Custom ${capability}`,
    });
  }
}

function getCommandConfig(
  config: Custom,
  capability: Tool,
): CustomCommandConfig | undefined {
  return config.options?.[capability];
}

function hasCommandForCapability(config: Custom, capability: Tool): boolean {
  return (
    normalizeConfiguredArgv(getCommandConfig(config, capability)).length > 0
  );
}

function hasAnyCommand(config: Custom): boolean {
  return (
    hasCommandForCapability(config, "search") ||
    hasCommandForCapability(config, "contents") ||
    hasCommandForCapability(config, "answer") ||
    hasCommandForCapability(config, "research")
  );
}

function normalizeConfiguredArgv(
  command: CustomCommandConfig | undefined,
): string[] {
  return command?.argv?.filter((entry) => entry.trim().length > 0) ?? [];
}

function parseSearchResponse(
  value: unknown,
  providerId: SearchResponse["provider"],
): SearchResponse {
  if (!isRecord(value)) {
    throw new Error("Custom search output must be a JSON object.");
  }

  if (!Array.isArray(value.results)) {
    throw new Error("Custom search output must include a 'results' array.");
  }

  return {
    provider: providerId,
    results: value.results.map((entry, index) =>
      parseSearchResult(entry, index),
    ),
  };
}

function parseSearchResult(entry: unknown, index: number) {
  if (!isRecord(entry)) {
    throw new Error(
      `Custom search result at index ${index} must be a JSON object.`,
    );
  }

  return {
    title: readRequiredString(entry.title, `results[${index}].title`),
    url: readRequiredString(entry.url, `results[${index}].url`),
    snippet: readRequiredString(entry.snippet, `results[${index}].snippet`),
    ...(typeof entry.score === "number" ? { score: entry.score } : {}),
    ...(isRecord(entry.metadata) ? { metadata: entry.metadata } : {}),
  };
}

function parseContentsResponse(
  value: unknown,
  providerId: ContentsResponse["provider"],
  urls: string[],
): ContentsResponse {
  if (!isRecord(value)) {
    throw new Error("Custom contents output must be a JSON object.");
  }

  if (Array.isArray(value.answers)) {
    return {
      provider: providerId,
      answers: value.answers.map((entry, index) =>
        parseContentsAnswer(entry, index),
      ),
    };
  }

  if (typeof value.text === "string" && urls.length === 1) {
    return {
      provider: providerId,
      answers: [
        {
          url: urls[0] ?? "",
          content: value.text,
        },
      ],
    };
  }

  throw new Error(
    "Custom contents output must include an 'answers' array (or legacy 'text' for single-URL calls).",
  );
}

function parseContentsAnswer(entry: unknown, index: number): ContentsAnswer {
  if (!isRecord(entry)) {
    throw new Error(
      `Custom contents answer at index ${index} must be a JSON object.`,
    );
  }

  const url = readRequiredString(entry.url, `answers[${index}].url`);
  const content =
    entry.content === undefined
      ? undefined
      : readRequiredString(entry.content, `answers[${index}].content`);
  const summary = entry.summary;
  const metadata =
    entry.metadata === undefined
      ? undefined
      : readRecord(entry.metadata, `answers[${index}].metadata`);
  const error =
    entry.error === undefined
      ? undefined
      : readRequiredString(entry.error, `answers[${index}].error`);

  if (content === undefined && error === undefined) {
    throw new Error(
      `Custom contents answer at index ${index} must include 'content' or 'error'.`,
    );
  }

  return {
    url,
    ...(content !== undefined ? { content } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function parseToolOutput(
  value: unknown,
  providerId: ToolOutput["provider"],
): ToolOutput {
  if (!isRecord(value)) {
    throw new Error("Custom output must be a JSON object.");
  }

  return {
    provider: providerId,
    text: readRequiredString(value.text, "text"),
    ...(isNonNegativeInteger(value.itemCount)
      ? { itemCount: value.itemCount }
      : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Custom output field '${field}' must be a JSON object.`);
  }
  return value;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Custom output field '${field}' must be a string.`);
  }
  return value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
