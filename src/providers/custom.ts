import { createSilentForegroundPlan } from "../provider-plans.js";
import type {
  CustomCommandConfig,
  Custom,
  Tool,
  ProviderContext,
  ProviderOperationRequest,
  ProviderStatus,
  ToolOutput,
  SearchResponse,
  ProviderAdapter,
} from "../types.js";
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

  buildPlan(request: ProviderOperationRequest, config: Custom) {
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
        return createSilentForegroundPlan({
          config,
          capability: request.capability,
          providerId: this.id,
          providerLabel: this.label,
          execute: (context: ProviderContext) =>
            this.research(request.input, request.options, config, context),
        });
      default:
        return null;
    }
  }

  async search(
    query: string,
    maxResults: number,
    options: Record<string, unknown> | undefined,
    config: Custom,
    context: ProviderContext,
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
    options: Record<string, unknown> | undefined,
    config: Custom,
    context: ProviderContext,
  ): Promise<ToolOutput> {
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

    return parseToolOutput(output, this.id);
  }

  async answer(
    query: string,
    options: Record<string, unknown> | undefined,
    config: Custom,
    context: ProviderContext,
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
    options: Record<string, unknown> | undefined,
    config: Custom,
    context: ProviderContext,
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
