import {
  query,
  type SDKResultMessage,
  type EffortLevel,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  ProviderContext,
  SearchResponse,
  ToolOutput,
} from "../contract.js";
import type { Claude } from "./types.js";

import { trimSnippet } from "../shared.js";

const SEARCH_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
        },
        required: ["title", "url", "snippet"],
      },
    },
  },
  required: ["sources"],
} as const;

const ANSWER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
        },
        required: ["title", "url"],
      },
    },
  },
  required: ["answer", "sources"],
} as const;

interface ClaudeSearchOutput {
  sources: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

interface ClaudeAnswerOutput {
  answer: string;
  sources: Array<{
    title: string;
    url: string;
  }>;
}

const claudeImplementation = {
  async search(
    queryText: string,
    maxResults: number,
    config: Claude,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const output = parseClaudeSearchOutput(
      await this.runStructuredQuery<ClaudeSearchOutput>({
        prompt: [
          "You are performing web research for another coding agent.",
          "Use the WebSearch tool to search the public web.",
          "Return only a JSON object matching the provided schema.",
          "Do not include markdown fences or extra commentary.",
          `Return at most ${maxResults} sources.`,
          "Each snippet should be short, factual, and specific to the result.",
          "Prefer primary or official sources when they are available.",
          "",
          `User query: ${queryText}`,
        ].join("\n"),
        schema: SEARCH_OUTPUT_SCHEMA,
        tools: ["WebSearch"],
        config,
        context,
        options,
      }),
    );

    return {
      provider: "claude",
      results: output.sources.slice(0, maxResults).map((source) => ({
        title: source.title.trim(),
        url: source.url.trim(),
        snippet: trimSnippet(source.snippet),
      })),
    };
  },

  async answer(
    queryText: string,
    config: Claude,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const output = parseClaudeAnswerOutput(
      await this.runStructuredQuery<ClaudeAnswerOutput>({
        prompt: [
          "Answer the user's question using current public web information.",
          "Use WebSearch to find relevant sources and WebFetch when you need to verify important details.",
          "Return only a JSON object matching the provided schema.",
          "Do not include markdown fences or extra commentary.",
          "Keep the answer concise but informative.",
          "Only cite sources you actually used.",
          "",
          `User query: ${queryText}`,
        ].join("\n"),
        schema: ANSWER_OUTPUT_SCHEMA,
        tools: ["WebSearch", "WebFetch"],
        config,
        context,
        options,
      }),
    );

    const lines: string[] = [];
    lines.push(output.answer.trim() || "No answer returned.");

    if (output.sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of output.sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        lines.push(`   ${source.url}`);
      }
    }

    return {
      provider: "claude",
      text: lines.join("\n").trimEnd(),
      itemCount: output.sources.length,
    };
  },

  async runStructuredQuery<T>({
    prompt,
    schema,
    tools,
    config,
    context,
    options,
  }: {
    prompt: string;
    schema: Record<string, unknown>;
    tools: string[];
    config: Claude;
    context: ProviderContext;
    options: Record<string, unknown> | undefined;
  }): Promise<T> {
    const abortController = new AbortController();
    if (context.signal?.aborted) {
      abortController.abort(context.signal.reason);
    }
    const onAbort = () => {
      abortController.abort(context.signal?.reason);
    };
    context.signal?.addEventListener("abort", onAbort, { once: true });

    const stream = query({
      prompt,
      options: {
        abortController,
        allowedTools: tools,
        cwd: context.cwd,
        env: {
          ...context.env,
          ...(config.credentials?.api
            ? { ANTHROPIC_API_KEY: config.credentials.api }
            : {}),
          ...(config.credentials?.oauth
            ? { CLAUDE_CODE_OAUTH_TOKEN: config.credentials.oauth }
            : {}),
        },
        ...getClaudeRuntimeOptions(options),
        outputFormat: {
          type: "json_schema",
          schema,
        },
        pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
        persistSession: false,
        permissionMode: "dontAsk",
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append:
            "Use only the provided web tools. Always produce output that matches the requested JSON schema exactly.",
        },
        tools,
      },
    });

    let finalResult: SDKResultMessage | undefined;

    try {
      for await (const message of stream) {
        if (message.type === "result") {
          finalResult = message;
        }
      }
    } finally {
      context.signal?.removeEventListener("abort", onAbort);
      stream.close();
    }

    if (!finalResult) {
      throw new Error("returned no result");
    }
    if (finalResult.subtype !== "success") {
      throw new Error(
        finalResult.errors.join("\n") ||
          `query failed (${finalResult.subtype})`,
      );
    }

    return parseStructuredOutput<T>(finalResult);
  },
};

function parseStructuredOutput<T>(result: SDKResultMessage): T {
  if (result.subtype !== "success") {
    throw new Error("query did not succeed");
  }

  if (result.structured_output !== undefined) {
    return result.structured_output as T;
  }

  if (!result.result.trim()) {
    throw new Error("returned an empty response");
  }

  try {
    return JSON.parse(result.result) as T;
  } catch {
    const match = result.result.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("returned invalid JSON output");
    }
    return JSON.parse(match[0]) as T;
  }
}

function getClaudeRuntimeOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const model = readNonEmptyString(options?.model);
  const effort: EffortLevel | undefined = readEnum(options?.effort, [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  const maxTurns = readPositiveInteger(options?.maxTurns);
  const maxThinkingTokens = readNonNegativeInteger(options?.maxThinkingTokens);
  const maxBudgetUsd = readPositiveNumber(options?.maxBudgetUsd);
  const thinking = isPlainObject(options?.thinking)
    ? options?.thinking
    : undefined;

  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(maxTurns ? { maxTurns } : {}),
    ...(maxThinkingTokens !== undefined ? { maxThinkingTokens } : {}),
    ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
    ...(thinking ? { thinking } : {}),
  };
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function readEnum<const TValue extends string>(
  value: unknown,
  values: readonly TValue[],
): TValue | undefined {
  return typeof value === "string" && values.includes(value as TValue)
    ? (value as TValue)
    : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClaudeSearchOutput(value: unknown): ClaudeSearchOutput {
  const sources = readArray(value, "sources").map((entry) => ({
    title: readString(entry, "title"),
    url: readString(entry, "url"),
    snippet: readString(entry, "snippet"),
  }));
  return { sources };
}

function parseClaudeAnswerOutput(value: unknown): ClaudeAnswerOutput {
  return {
    answer: readString(value, "answer"),
    sources: readArray(value, "sources").map((entry) => ({
      title: readString(entry, "title"),
      url: readString(entry, "url"),
    })),
  };
}

function readArray(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error(`output is missing '${key}'`);
  }
  const entry = (value as Record<string, unknown>)[key];
  if (!Array.isArray(entry)) {
    throw new Error(`output field '${key}' must be an array`);
  }
  return entry;
}

function readString(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null || !(key in value)) {
    throw new Error(`output is missing '${key}'`);
  }
  const entry = (value as Record<string, unknown>)[key];
  if (typeof entry !== "string") {
    throw new Error(`output field '${key}' must be a string`);
  }
  return entry;
}

export const adapter = {
  async search(
    input: import("../contract.js").ProviderRequest<"search">,
    config: Claude,
    context: ProviderContext,
  ) {
    return await claudeImplementation.search(
      input.query,
      input.maxResults,
      config,
      context,
      input.options,
    );
  },
  async answer(
    input: import("../contract.js").ProviderRequest<"answer">,
    config: Claude,
    context: ProviderContext,
  ) {
    return await claudeImplementation.answer(
      input.query,
      config,
      context,
      input.options,
    );
  },
};
