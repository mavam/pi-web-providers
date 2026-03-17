import { createSilentForegroundPlan } from "../provider-plans.js";
import type {
  CustomCliCommandConfig,
  CustomCliProviderConfig,
  JsonObject,
  JsonValue,
  ProviderCapability,
  ProviderContext,
  ProviderOperationRequest,
  ProviderStatus,
  ProviderToolOutput,
  SearchResponse,
  WebProvider,
} from "../types.js";
import { runCliJsonCommand } from "./cli-json.js";

export class CustomCliProvider implements WebProvider<CustomCliProviderConfig> {
  readonly id: "custom-cli" = "custom-cli";
  readonly label = "Custom CLI";
  readonly docsUrl =
    "https://github.com/mavam/pi-web-providers#custom-cli-provider";
  readonly capabilities = ["search", "contents", "answer", "research"] as const;

  createTemplate(): CustomCliProviderConfig {
    return {
      enabled: false,
    };
  }

  getStatus(
    config: CustomCliProviderConfig | undefined,
    _cwd: string,
    capability?: ProviderCapability,
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

  buildPlan(
    request: ProviderOperationRequest,
    config: CustomCliProviderConfig,
  ) {
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
    options: JsonObject | undefined,
    config: CustomCliProviderConfig,
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
    options: JsonObject | undefined,
    config: CustomCliProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
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

    return parseProviderToolOutput(output, this.id);
  }

  async answer(
    query: string,
    options: JsonObject | undefined,
    config: CustomCliProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
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

    return parseProviderToolOutput(output, this.id);
  }

  async research(
    input: string,
    options: JsonObject | undefined,
    config: CustomCliProviderConfig,
    context: ProviderContext,
  ): Promise<ProviderToolOutput> {
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

    return parseProviderToolOutput(output, this.id);
  }

  private async runCommand<TOutput>({
    capability,
    payload,
    config,
    context,
  }: {
    capability: ProviderCapability;
    payload: JsonObject;
    config: CustomCliProviderConfig;
    context: ProviderContext;
  }): Promise<TOutput> {
    const command = getCommandConfig(config, capability);
    if (!command) {
      throw new Error(
        `Custom CLI has no command configured for ${capability}.`,
      );
    }

    context.onProgress?.(`Running Custom CLI ${capability}`);
    return await runCliJsonCommand<TOutput>({
      command,
      payload: {
        ...payload,
        cwd: context.cwd,
      },
      context,
      label: `Custom CLI ${capability}`,
    });
  }
}

function getCommandConfig(
  config: CustomCliProviderConfig,
  capability: ProviderCapability,
): CustomCliCommandConfig | undefined {
  return config.native?.[capability] ?? config.defaults?.[capability];
}

function hasCommandForCapability(
  config: CustomCliProviderConfig,
  capability: ProviderCapability,
): boolean {
  return (
    normalizeConfiguredArgv(getCommandConfig(config, capability)).length > 0
  );
}

function hasAnyCommand(config: CustomCliProviderConfig): boolean {
  return (
    hasCommandForCapability(config, "search") ||
    hasCommandForCapability(config, "contents") ||
    hasCommandForCapability(config, "answer") ||
    hasCommandForCapability(config, "research")
  );
}

function normalizeConfiguredArgv(
  command: CustomCliCommandConfig | undefined,
): string[] {
  return command?.argv?.filter((entry) => entry.trim().length > 0) ?? [];
}

function parseSearchResponse(
  value: unknown,
  providerId: SearchResponse["provider"],
): SearchResponse {
  if (!isJsonObject(value)) {
    throw new Error("Custom CLI search output must be a JSON object.");
  }

  if (!Array.isArray(value.results)) {
    throw new Error("Custom CLI search output must include a 'results' array.");
  }

  return {
    provider: providerId,
    results: value.results.map((entry, index) =>
      parseSearchResult(entry, index),
    ),
  };
}

function parseSearchResult(entry: unknown, index: number) {
  if (!isJsonObject(entry)) {
    throw new Error(
      `Custom CLI search result at index ${index} must be a JSON object.`,
    );
  }

  return {
    title: readRequiredString(entry.title, `results[${index}].title`),
    url: readRequiredString(entry.url, `results[${index}].url`),
    snippet: readRequiredString(entry.snippet, `results[${index}].snippet`),
    ...(typeof entry.score === "number" ? { score: entry.score } : {}),
    ...(isJsonObject(entry.metadata) ? { metadata: entry.metadata } : {}),
  };
}

function parseProviderToolOutput(
  value: unknown,
  providerId: ProviderToolOutput["provider"],
): ProviderToolOutput {
  if (!isJsonObject(value)) {
    throw new Error("Custom CLI output must be a JSON object.");
  }

  return {
    provider: providerId,
    text: readRequiredString(value.text, "text"),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(isNonNegativeInteger(value.itemCount)
      ? { itemCount: value.itemCount }
      : {}),
    ...(isJsonObject(value.metadata) ? { metadata: value.metadata } : {}),
  };
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Custom CLI output field '${field}' must be a string.`);
  }
  return value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }

  return false;
}
