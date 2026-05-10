import OpenAI from "openai";
import { type TObject, Type } from "typebox";
import { resolveConfigValue } from "../config-values.js";
import { executeAsyncResearch } from "../execution-policy.js";
import type {
  OpenAIAnswerOptions,
  OpenAI as OpenAIConfig,
  OpenAIResearchOptions,
  OpenAISearchOptions,
  ProviderCapabilityStatus,
  ProviderContext,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { defineCapability, defineProvider } from "./definition.js";
import { getApiKeyStatus, trimSnippet } from "./shared.js";

const DEFAULT_SEARCH_MODEL = "gpt-4.1";
const DEFAULT_ANSWER_MODEL = "gpt-4.1";
const DEFAULT_RESEARCH_MODEL = "o4-mini-deep-research";

const openaiSearchOptionsSchema = Type.Object(
  {
    model: Type.Optional(
      Type.String({
        description:
          "OpenAI model to use for web search (for example 'gpt-4.1').",
      }),
    ),
    instructions: Type.Optional(
      Type.String({
        description:
          "Optional instructions that shape source selection and result style.",
      }),
    ),
  },
  { description: "OpenAI search options." },
);

const openaiSearchPromptGuidelines = [
  "Use OpenAI web search when an LLM-mediated search pass should identify likely sources from the live web.",
  "Use instructions to constrain source selection, freshness, geography, or output style only when the user explicitly needs that control.",
  "Prefer web_contents after OpenAI search when the task requires direct inspection of selected primary sources.",
] as const;

const openaiAnswerOptionsSchema = Type.Object(
  {
    model: Type.Optional(
      Type.String({
        description:
          "OpenAI model to use for grounded answers (for example 'gpt-4.1').",
      }),
    ),
    instructions: Type.Optional(
      Type.String({
        description:
          "Optional instructions that shape the answer structure, tone, and source selection.",
      }),
    ),
  },
  { description: "OpenAI answer options." },
);

const openaiResearchOptionsSchema = Type.Object(
  {
    model: Type.Optional(
      Type.String({
        description:
          "OpenAI deep research model to use (for example 'o4-mini-deep-research').",
      }),
    ),
    instructions: Type.Optional(
      Type.String({
        description:
          "Optional instructions that shape the report structure, tone, and source selection.",
      }),
    ),
    max_tool_calls: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "Maximum number of built-in tool calls the model may make during the research run.",
      }),
    ),
  },
  { description: "OpenAI deep research options." },
);

const searchResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sources"],
  properties: {
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "snippet"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
        },
      },
    },
  },
} as const;

interface OpenAIResponseLike {
  id: string;
  model: string;
  status?:
    | "completed"
    | "failed"
    | "in_progress"
    | "cancelled"
    | "queued"
    | "incomplete";
  output_text: string;
  error: { message: string } | null;
  incomplete_details: {
    reason?: "max_output_tokens" | "content_filter";
  } | null;
  output: Array<{
    type: string;
    content?: Array<{
      type: string;
      annotations?: Array<{
        type: string;
        title?: string;
        url?: string;
        start_index?: number;
        end_index?: number;
      }>;
    }>;
  }>;
}

const openaiImplementation = {
  id: "openai" as const,
  label: "OpenAI",
  docsUrl: "https://platform.openai.com/docs/guides/deep-research",

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return openaiSearchOptionsSchema;
      case "answer":
        return openaiAnswerOptionsSchema;
      case "research":
        return openaiResearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): OpenAIConfig {
    return {
      credentials: { api: "OPENAI_API_KEY" },
      options: {
        search: {
          model: DEFAULT_SEARCH_MODEL,
        },
        answer: {
          model: DEFAULT_ANSWER_MODEL,
        },
        research: {
          model: DEFAULT_RESEARCH_MODEL,
        },
      },
    };
  },

  getCapabilityStatus(
    config: OpenAIConfig | undefined,
  ): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.credentials?.api);
  },

  async search(
    query: string,
    maxResults: number,
    config: OpenAIConfig,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const client = createClient(config);
    const response = (await client.responses.create(
      buildOpenAISearchRequest(query, maxResults, config, options),
      buildRequestOptions(context.signal, context.idempotencyKey),
    )) as OpenAIResponseLike;

    return parseSearchResponse(response, maxResults);
  },

  async answer(
    query: string,
    config: OpenAIConfig,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const client = createClient(config);
    const response = (await client.responses.create(
      buildOpenAIAnswerRequest(query, config, options),
      buildRequestOptions(context.signal, context.idempotencyKey),
    )) as OpenAIResponseLike;

    return ensureCompletedResponse(response, "answer");
  },

  async research(
    input: string,
    config: OpenAIConfig,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: openaiImplementation.label,
      providerId: openaiImplementation.id,
      context,
      start: (researchContext) =>
        openaiImplementation.startResearch(
          input,
          config,
          researchContext,
          options,
        ),
      poll: (id, researchContext) =>
        openaiImplementation.pollResearch(id, config, researchContext, options),
    });
  },

  async startResearch(
    input: string,
    config: OpenAIConfig,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const client = createClient(config);
    const response = (await client.responses.create(
      buildOpenAIResearchRequest(input, config, options),
      buildRequestOptions(context.signal, context.idempotencyKey),
    )) as OpenAIResponseLike;

    return { id: response.id };
  },

  async pollResearch(
    id: string,
    config: OpenAIConfig,
    context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const client = createClient(config);
    const response = (await client.responses.retrieve(
      id,
      undefined,
      buildRequestOptions(context.signal),
    )) as OpenAIResponseLike;
    const status = response.status ?? "completed";

    if (status === "completed") {
      return {
        status: "completed",
        output: formatResponseOutput(response, "research"),
      };
    }

    if (status === "failed") {
      return {
        status: "failed",
        error: response.error?.message ?? "research failed",
      };
    }

    if (status === "cancelled") {
      return {
        status: "cancelled",
        error: "research was canceled",
      };
    }

    if (status === "incomplete") {
      return {
        status: "failed",
        error: formatIncompleteError(response, "research"),
      };
    }

    return {
      status: "in_progress",
      statusText: status,
    };
  },
};

function createClient(config: OpenAIConfig): OpenAI {
  const apiKey = resolveConfigValue(config.credentials?.api);
  if (!apiKey) {
    throw new Error("is missing an API key");
  }

  const baseUrl = resolveConfigValue(config.baseUrl);

  return new OpenAI({
    apiKey,
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });
}

function buildOpenAISearchRequest(
  query: string,
  maxResults: number,
  config: OpenAIConfig,
  options?: Record<string, unknown>,
) {
  const mergedOptions = resolveOpenAISearchOptions(config, options);

  const model = mergedOptions.model ?? DEFAULT_SEARCH_MODEL;
  const instructions = mergedOptions.instructions;

  return {
    model,
    input: [
      "Search the public web and return only the most relevant sources for the user's query.",
      `Return at most ${maxResults} sources.`,
      "Prefer official, primary, or highly reputable sources when available.",
      "Each snippet should be short, specific, and grounded in the retrieved source.",
      "Return only data matching the provided JSON schema.",
      "",
      `User query: ${query}`,
    ].join("\n"),
    tools: [{ type: "web_search_preview" as const }],
    text: {
      format: {
        type: "json_schema" as const,
        name: "openai_web_search_results",
        schema: searchResultSchema,
        strict: true,
      },
    },
    ...(instructions ? { instructions } : {}),
  };
}

function buildOpenAIAnswerRequest(
  query: string,
  config: OpenAIConfig,
  options?: Record<string, unknown>,
) {
  const mergedOptions = resolveOpenAIAnswerOptions(config, options);

  const model = mergedOptions.model ?? DEFAULT_ANSWER_MODEL;
  const instructions = mergedOptions.instructions;

  return {
    model,
    input: query,
    tools: [{ type: "web_search_preview" as const }],
    ...(instructions ? { instructions } : {}),
  };
}

function buildOpenAIResearchRequest(
  input: string,
  config: OpenAIConfig,
  options?: Record<string, unknown>,
) {
  const mergedOptions = resolveOpenAIResearchOptions(config, options);

  const model = mergedOptions.model ?? DEFAULT_RESEARCH_MODEL;
  const instructions = mergedOptions.instructions;
  const maxToolCalls = mergedOptions.max_tool_calls;

  return {
    model,
    input,
    background: true,
    tools: [{ type: "web_search_preview" as const }],
    ...(instructions ? { instructions } : {}),
    ...(maxToolCalls ? { max_tool_calls: maxToolCalls } : {}),
  };
}

function resolveOpenAISearchOptions(
  config: OpenAIConfig,
  options?: Record<string, unknown>,
): OpenAISearchOptions {
  const mergedOptions = {
    ...(config.options?.search ?? {}),
    ...(options ?? {}),
  };
  const model = readNonEmptyString(mergedOptions.model);
  const instructions = readNonEmptyString(mergedOptions.instructions);

  return {
    ...(model ? { model } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

function resolveOpenAIAnswerOptions(
  config: OpenAIConfig,
  options?: Record<string, unknown>,
): OpenAIAnswerOptions {
  const mergedOptions = {
    ...(config.options?.answer ?? {}),
    ...(options ?? {}),
  };
  const model = readNonEmptyString(mergedOptions.model);
  const instructions = readNonEmptyString(mergedOptions.instructions);

  return {
    ...(model ? { model } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

function resolveOpenAIResearchOptions(
  config: OpenAIConfig,
  options?: Record<string, unknown>,
): OpenAIResearchOptions {
  const mergedOptions = {
    ...(config.options?.research ?? {}),
    ...(options ?? {}),
  };
  const model = readNonEmptyString(mergedOptions.model);
  const instructions = readNonEmptyString(mergedOptions.instructions);
  const maxToolCalls = readPositiveInteger(mergedOptions.max_tool_calls);

  return {
    ...(model ? { model } : {}),
    ...(instructions ? { instructions } : {}),
    ...(maxToolCalls ? { max_tool_calls: maxToolCalls } : {}),
  };
}

function buildRequestOptions(
  signal: AbortSignal | undefined,
  idempotencyKey?: string,
) {
  if (!signal && !idempotencyKey) {
    return undefined;
  }

  return {
    ...(signal ? { signal } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function parseSearchResponse(
  response: OpenAIResponseLike,
  maxResults: number,
): SearchResponse {
  const status = response.status ?? "completed";

  if (status === "failed") {
    throw new Error(response.error?.message ?? "search failed");
  }

  if (status === "cancelled") {
    throw new Error("search was canceled");
  }

  if (status === "incomplete") {
    throw new Error(formatIncompleteError(response, "search"));
  }

  if (status !== "completed") {
    throw new Error(`search did not complete (status: ${status})`);
  }

  const payload = parseSearchPayload(response.output_text);
  return {
    provider: openaiImplementation.id,
    results: payload.sources.slice(0, maxResults).map((source) => ({
      title: source.title.trim(),
      url: source.url.trim(),
      snippet: trimSnippet(source.snippet),
    })),
  };
}

function ensureCompletedResponse(
  response: OpenAIResponseLike,
  operation: "answer" | "research",
): ToolOutput {
  const status = response.status ?? "completed";

  if (status === "completed") {
    return formatResponseOutput(response, operation);
  }

  if (status === "failed") {
    throw new Error(response.error?.message ?? `${operation} failed`);
  }

  if (status === "cancelled") {
    throw new Error(`${operation} was canceled`);
  }

  if (status === "incomplete") {
    throw new Error(formatIncompleteError(response, operation));
  }

  throw new Error(`${operation} did not complete (status: ${status})`);
}

function formatResponseOutput(
  response: OpenAIResponseLike,
  operation: "answer" | "research",
): ToolOutput {
  const lines: string[] = [];
  lines.push(
    response.output_text?.trim() ||
      `OpenAI ${operation} completed without textual output.`,
  );

  const citations = extractUrlCitations(response);
  if (citations.length > 0) {
    lines.push("");
    lines.push("Sources:");
    for (const [index, citation] of citations.entries()) {
      lines.push(`${index + 1}. ${citation.title}`);
      lines.push(`   ${citation.url}`);
    }
  }

  return {
    provider: openaiImplementation.id,
    text: lines.join("\n").trimEnd(),
    itemCount: citations.length,
    metadata: {
      responseId: response.id,
      model: response.model,
      citations,
    },
  };
}

function extractUrlCitations(response: OpenAIResponseLike): Array<{
  title: string;
  url: string;
  startIndex: number;
  endIndex: number;
}> {
  const citations: Array<{
    title: string;
    url: string;
    startIndex: number;
    endIndex: number;
  }> = [];
  const seen = new Set<string>();

  for (const item of response.output) {
    if (item.type !== "message" || !item.content) {
      continue;
    }

    for (const content of item.content) {
      if (content.type !== "output_text" || !content.annotations) {
        continue;
      }

      for (const annotation of content.annotations) {
        if (annotation.type !== "url_citation") {
          continue;
        }

        const title = readNonEmptyString(annotation.title);
        const url = readNonEmptyString(annotation.url);
        const startIndex = readInteger(annotation.start_index);
        const endIndex = readInteger(annotation.end_index);
        if (
          !title ||
          !url ||
          startIndex === undefined ||
          endIndex === undefined
        ) {
          continue;
        }

        const citation = {
          title,
          url,
          startIndex,
          endIndex,
        };
        const key = [
          citation.title,
          citation.url,
          String(citation.startIndex),
          String(citation.endIndex),
        ].join("::");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        citations.push(citation);
      }
    }
  }

  return citations;
}

function parseSearchPayload(text: string | undefined): {
  sources: Array<{ title: string; url: string; snippet: string }>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? "");
  } catch (error) {
    throw new Error(
      `search returned invalid JSON: ${(error as Error).message}`,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("sources" in parsed) ||
    !Array.isArray((parsed as { sources?: unknown }).sources)
  ) {
    throw new Error("search output must include a 'sources' array");
  }

  return {
    sources: (parsed as { sources: unknown[] }).sources.map((source, index) => {
      if (typeof source !== "object" || source === null) {
        throw new Error(`search source at index ${index} must be an object`);
      }

      const entry = source as Record<string, unknown>;
      const title = readNonEmptyString(entry.title);
      const url = readNonEmptyString(entry.url);
      const snippet = readNonEmptyString(entry.snippet);
      if (!title) {
        throw new Error(`search source at index ${index} is missing title`);
      }
      if (!url) {
        throw new Error(`search source at index ${index} is missing url`);
      }
      if (!snippet) {
        throw new Error(`search source at index ${index} is missing snippet`);
      }

      return { title, url, snippet };
    }),
  };
}

function formatIncompleteError(
  response: OpenAIResponseLike,
  operation: "search" | "answer" | "research",
): string {
  const reason = response.incomplete_details?.reason;
  if (reason) {
    return `${operation} ended incomplete (${reason})`;
  }
  return `${operation} ended incomplete`;
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

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

export const openaiProvider = defineProvider({
  id: "openai" as const,
  label: openaiImplementation.label,
  docsUrl: openaiImplementation.docsUrl,
  config: {
    createTemplate: () => openaiImplementation.createTemplate(),
    fields: ["credentials", "baseUrl", "options", "settings"],
    optionCapabilities: ["search", "answer", "research"],
  },
  getCapabilityStatus: (config, cwd, tool) =>
    (openaiImplementation.getCapabilityStatus as any)(
      config as OpenAI | undefined,
      cwd,
      tool,
    ),
  capabilities: {
    search: defineCapability({
      options: openaiImplementation.getToolOptionsSchema?.("search"),
      promptGuidelines: openaiSearchPromptGuidelines,
      async execute(input: any, ctx) {
        const { query, maxResults, options } = input;
        return await openaiImplementation.search!(
          query,
          maxResults,
          ctx.config as never,
          ctx,
          options,
        );
      },
    }),
    answer: defineCapability({
      options: openaiImplementation.getToolOptionsSchema?.("answer"),
      async execute(input: any, ctx) {
        return await openaiImplementation.answer!(
          input.query,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
    research: defineCapability({
      options: openaiImplementation.getToolOptionsSchema?.("research"),
      async execute(input: any, ctx) {
        return await openaiImplementation.research!(
          input.input,
          ctx.config as never,
          ctx,
          input.options,
        );
      },
    }),
  },
});
