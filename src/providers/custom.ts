import { z } from "zod";
import type { ContentsAnswer, ContentsResponse } from "../contents.js";
import type {
  Custom,
  CustomCommandConfig,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { runCliJsonCommand } from "./cli-json.js";
import { buildProviderPlan } from "./framework.js";

const jsonObjectSchema = z.object({}).catchall(z.unknown());
const requiredStringSchema = z.string();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const searchResponseSchema = z.object({
  results: z.array(z.unknown()),
});
const contentsAnswersResponseSchema = z.object({
  answers: z.array(z.unknown()),
});
const legacyContentsResponseSchema = z.object({
  text: z.string(),
});
const toolOutputSchema = z.object({
  text: z.string(),
  itemCount: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

type CustomAdapter = ProviderAdapter<Custom> & {
  search(
    query: string,
    maxResults: number,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  contents(
    urls: string[],
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ContentsResponse>;
  answer(
    query: string,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
  research(
    input: string,
    config: Custom,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
};

export const customAdapter: CustomAdapter = {
  id: "custom",
  label: "Custom",
  docsUrl: "https://github.com/mavam/pi-web-providers#custom-provider",
  tools: ["search", "contents", "answer", "research"] as const,

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

  buildPlan(request: ProviderRequest, config: Custom) {
    return buildProviderPlan({
      request,
      config,
      providerId: customAdapter.id,
      providerLabel: customAdapter.label,
      handlers: {
        search: {
          deliveryMode: "silent-foreground",
          execute: (
            searchRequest,
            providerConfig: Custom,
            context: ProviderContext,
          ) =>
            customAdapter.search(
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
            providerConfig: Custom,
            context: ProviderContext,
          ) =>
            customAdapter.contents(
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
            providerConfig: Custom,
            context: ProviderContext,
          ) =>
            customAdapter.answer(
              answerRequest.query,
              providerConfig,
              context,
              answerRequest.options,
            ),
        },
        research: {
          deliveryMode: "silent-foreground",
          execute: (
            researchRequest,
            providerConfig: Custom,
            context: ProviderContext,
          ) =>
            customAdapter.research(
              researchRequest.input,
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

    return parseSearchResponse(output, customAdapter.id);
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

    return parseContentsResponse(output, customAdapter.id, urls);
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

    return parseToolOutput(output, customAdapter.id);
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

    return parseToolOutput(output, customAdapter.id);
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
  const parsed = jsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("search output must be a JSON object");
  }

  const response = searchResponseSchema.safeParse(parsed.data);
  if (!response.success) {
    throw new Error("search output must include a 'results' array");
  }

  return {
    provider: providerId,
    results: response.data.results.map((entry, index) =>
      parseSearchResult(entry, index),
    ),
  };
}

function parseSearchResult(entry: unknown, index: number) {
  const parsed = jsonObjectSchema.safeParse(entry);
  if (!parsed.success) {
    throw new Error(`search result at index ${index} must be a JSON object`);
  }

  const value = parsed.data;
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
  urls: string[],
): ContentsResponse {
  const parsed = jsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("contents output must be a JSON object");
  }

  const answersResponse = contentsAnswersResponseSchema.safeParse(parsed.data);
  if (answersResponse.success) {
    return {
      provider: providerId,
      answers: answersResponse.data.answers.map((entry, index) =>
        parseContentsAnswer(entry, index),
      ),
    };
  }

  const legacyResponse = legacyContentsResponseSchema.safeParse(parsed.data);
  if (legacyResponse.success && urls.length === 1) {
    return {
      provider: providerId,
      answers: [
        {
          url: urls[0] ?? "",
          content: legacyResponse.data.text,
        },
      ],
    };
  }

  throw new Error(
    "contents output must include an 'answers' array (or legacy 'text' for single-URL calls)",
  );
}

function parseContentsAnswer(entry: unknown, index: number): ContentsAnswer {
  const parsed = jsonObjectSchema.safeParse(entry);
  if (!parsed.success) {
    throw new Error(`contents answer at index ${index} must be a JSON object`);
  }

  const value = parsed.data;
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
  const parsed = toolOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("output must be a JSON object");
  }

  const metadata = readLenientJsonObject(parsed.data.metadata);

  return {
    provider: providerId,
    text: parsed.data.text,
    ...readOptionalNonNegativeInteger(parsed.data.itemCount),
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

  const parsed = jsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`output field '${field}' must be a JSON object`);
  }
  return parsed.data;
}

function readLenientJsonObject(
  value: unknown,
): Record<string, unknown> | undefined {
  const parsed = jsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readRequiredString(value: unknown, field: string): string {
  const parsed = requiredStringSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`output field '${field}' must be a string`);
  }
  return parsed.data;
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
  const parsed = nonNegativeIntegerSchema.safeParse(value);
  return parsed.success ? { itemCount: parsed.data } : {};
}
