import type { TObject } from "typebox";
import type { ContentsAnswer, ContentsResponse } from "../contents.js";
import type {
  Custom,
  CustomCommandConfig,
  ProviderCapabilityStatus,
  ProviderContext,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { runCliJsonCommand } from "./cli-json.js";

import { defineCapability, defineProvider } from "./definition.js";

const customImplementation = {
  id: "custom" as const,
  label: "Custom",
  docsUrl: "https://github.com/mavam/pi-web-providers#custom-provider",

  getToolOptionsSchema(_capability: Tool): TObject | undefined {
    return undefined;
  },

  createTemplate(): Custom {
    return {};
  },

  getCapabilityStatus(
    config: Custom | undefined,
    _cwd: string,
    capability?: Tool,
  ): ProviderCapabilityStatus {
    if (capability) {
      return hasCommandForCapability(config, capability)
        ? { state: "ready" }
        : { state: "missing_command" };
    }

    return hasAnyCommand(config)
      ? { state: "ready" }
      : { state: "missing_command" };
  },

  async search(
    query: string,
    maxResults: number,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const output = await runCommand<unknown>({
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

    return parseSearchResponse(output, customImplementation.id);
  },

  async contents(
    urls: string[],
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse> {
    const output = await runCommand<unknown>({
      capability: "contents",
      payload: {
        capability: "contents",
        urls,
        ...(options ? { options } : {}),
      },
      config,
      context,
    });

    return parseContentsResponse(output, customImplementation.id);
  },

  async answer(
    query: string,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const output = await runCommand<unknown>({
      capability: "answer",
      payload: {
        capability: "answer",
        query,
        ...(options ? { options } : {}),
      },
      config,
      context,
    });

    return parseToolOutput(output, customImplementation.id);
  },

  async research(
    input: string,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const output = await runCommand<unknown>({
      capability: "research",
      payload: {
        capability: "research",
        input,
        ...(options ? { options } : {}),
      },
      config,
      context,
    });

    return parseToolOutput(output, customImplementation.id);
  },
};

async function runCommand<TOutput>({
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
    throw new Error(`has no command configured for ${capability}`);
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

function getCommandConfig(
  config: Custom | undefined,
  capability: Tool,
): CustomCommandConfig | undefined {
  return config?.options?.[capability];
}

function hasCommandForCapability(
  config: Custom | undefined,
  capability: Tool,
): boolean {
  return (
    normalizeConfiguredArgv(getCommandConfig(config, capability)).length > 0
  );
}

function hasAnyCommand(config: Custom | undefined): boolean {
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
  const response = requireObject(value, "search output must be a JSON object");
  if (!Array.isArray(response.results)) {
    throw new Error("search output must include a 'results' array");
  }

  return {
    provider: providerId,
    results: response.results.map((entry, index) =>
      parseSearchResult(entry, index),
    ),
  };
}

function parseSearchResult(entry: unknown, index: number) {
  const value = requireObject(
    entry,
    `search result at index ${index} must be a JSON object`,
  );
  const metadata = readLenientJsonObject(value.metadata);
  return {
    title: readRequiredString(value.title, `results[${index}].title`),
    url: readRequiredString(value.url, `results[${index}].url`),
    snippet: readRequiredString(value.snippet, `results[${index}].snippet`),
    ...(typeof value.score === "number" ? { score: value.score } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function parseContentsResponse(
  value: unknown,
  providerId: ContentsResponse["provider"],
): ContentsResponse {
  const response = requireObject(
    value,
    "contents output must be a JSON object",
  );
  if (!Array.isArray(response.answers)) {
    throw new Error("contents output must include an 'answers' array");
  }

  return {
    provider: providerId,
    answers: response.answers.map((entry, index) =>
      parseContentsAnswer(entry, index),
    ),
  };
}

function parseContentsAnswer(entry: unknown, index: number): ContentsAnswer {
  const value = requireObject(
    entry,
    `contents answer at index ${index} must be a JSON object`,
  );
  const url = readRequiredString(value.url, `answers[${index}].url`);
  const content = readOptionalString(
    value.content,
    `answers[${index}].content`,
  );
  const summary = value.summary;
  const metadata = readRequiredJsonObject(
    value.metadata,
    `answers[${index}].metadata`,
  );
  const error = readOptionalString(value.error, `answers[${index}].error`);

  if (content === undefined && error === undefined) {
    throw new Error(
      `contents answer at index ${index} must include 'content' or 'error'`,
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
  const output = requireObject(value, "output must be a JSON object");
  const metadata = readLenientJsonObject(output.metadata);

  return {
    provider: providerId,
    text: readRequiredString(output.text, "text"),
    ...readOptionalNonNegativeInteger(output.itemCount),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function readRequiredJsonObject(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireObject(value, `output field '${field}' must be a JSON object`);
}

function readLenientJsonObject(
  value: unknown,
): Record<string, unknown> | undefined {
  return isJsonObject(value) ? value : undefined;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`output field '${field}' must be a string`);
  }
  return value;
}

function readOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredString(value, field);
}

function readOptionalNonNegativeInteger(
  value: unknown,
): { itemCount: number } | Record<string, never> {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? { itemCount: value }
    : {};
}

function requireObject(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new Error(message);
  }
  return value;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const customProvider = defineProvider({
  id: "custom" as const,
  label: customImplementation.label,
  docsUrl: customImplementation.docsUrl,
  config: {
    createTemplate: () => customImplementation.createTemplate(),
    fields: ["customOptions", "settings"],
  },
  getCapabilityStatus: (config, cwd, tool) =>
    (customImplementation.getCapabilityStatus as any)(
      config as Custom | undefined,
      cwd,
      tool,
    ),
  capabilities: {
    search: defineCapability({
      options: customImplementation.getToolOptionsSchema?.("search"),
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await customImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    contents: defineCapability({
      options: customImplementation.getToolOptionsSchema?.("contents"),
      async execute(input: any, ctx) {
        return await customImplementation.contents!(
          input.urls,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    answer: defineCapability({
      options: customImplementation.getToolOptionsSchema?.("answer"),
      async execute(input: any, ctx) {
        return await customImplementation.answer!(
          input.query,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    research: defineCapability({
      options: customImplementation.getToolOptionsSchema?.("research"),
      async execute(input: any, ctx) {
        return await customImplementation.research!(
          input.input,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
