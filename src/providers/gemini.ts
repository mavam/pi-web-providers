import { GoogleGenAI } from "@google/genai";
import { type TObject, Type } from "@sinclair/typebox";
import { resolveConfigValue } from "../config.js";
import { executeAsyncResearch } from "../execution-policy.js";
import { DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS } from "../execution-policy-defaults.js";
import type {
  Gemini,
  ProviderAdapter,
  ProviderCapabilityStatus,
  ProviderContext,
  ProviderRequest,
  ResearchJob,
  ResearchPollResult,
  SearchResponse,
  Tool,
  ToolOutput,
} from "../types.js";
import { buildProviderPlan } from "./framework.js";
import { literalUnion } from "./schema.js";
import { getApiKeyStatus } from "./shared.js";

const DEFAULT_SEARCH_MODEL = "gemini-2.5-flash";
const DEFAULT_ANSWER_MODEL = "gemini-2.5-flash";
const DEFAULT_RESEARCH_AGENT = "deep-research-pro-preview-12-2025";

type GeminiAdapter = ProviderAdapter<Gemini> & {
  search(
    query: string,
    maxResults: number,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse>;
  answer(
    query: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
  research(
    input: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput>;
  startResearch(
    input: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob>;
  pollResearch(
    id: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchPollResult>;
  createClient(config: Gemini): GoogleGenAI;
};

const geminiGenerationConfigSchema = Type.Object(
  {
    temperature: Type.Optional(
      Type.Number({ description: "Sampling temperature." }),
    ),
    topP: Type.Optional(Type.Number({ description: "Top-p sampling value." })),
    topK: Type.Optional(
      Type.Integer({ minimum: 0, description: "Top-k sampling value." }),
    ),
    candidateCount: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Number of candidates to generate.",
      }),
    ),
    maxOutputTokens: Type.Optional(
      Type.Integer({ minimum: 1, description: "Maximum output tokens." }),
    ),
    tool_choice: Type.Optional(
      literalUnion(["auto", "any", "none"], {
        description: "Tool choice mode for Gemini search interactions.",
      }),
    ),
  },
  { description: "Gemini generation configuration." },
);

const geminiAnswerConfigSchema = Type.Object(
  {
    labels: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description: "Request labels to attach to the Gemini call.",
      }),
    ),
    temperature: Type.Optional(
      Type.Number({ description: "Sampling temperature." }),
    ),
    topP: Type.Optional(Type.Number({ description: "Top-p sampling value." })),
    topK: Type.Optional(
      Type.Integer({ minimum: 0, description: "Top-k sampling value." }),
    ),
    candidateCount: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Number of candidates to generate.",
      }),
    ),
    maxOutputTokens: Type.Optional(
      Type.Integer({ minimum: 1, description: "Maximum output tokens." }),
    ),
  },
  { description: "Gemini generate-content config overrides." },
);

const geminiAgentConfigSchema = Type.Object(
  {
    response_length: Type.Optional(
      Type.String({ description: "Research response length hint." }),
    ),
  },
  { description: "Gemini agent configuration." },
);

const geminiSearchOptionsSchema = Type.Object(
  {
    model: Type.Optional(
      Type.String({
        description:
          "Gemini model for search (for example 'gemini-2.5-flash').",
      }),
    ),
    generation_config: Type.Optional(geminiGenerationConfigSchema),
  },
  { description: "Gemini search options." },
);

const geminiAnswerOptionsSchema = Type.Object(
  {
    model: Type.Optional(
      Type.String({
        description:
          "Gemini model for answers (for example 'gemini-2.5-flash').",
      }),
    ),
    config: Type.Optional(geminiAnswerConfigSchema),
  },
  { description: "Gemini answer options." },
);

const geminiResearchOptionsSchema = Type.Object(
  {
    agent_config: Type.Optional(geminiAgentConfigSchema),
    store: Type.Optional(
      Type.Boolean({
        description: "Store the interaction for later retrieval.",
      }),
    ),
    response_format: Type.Optional(
      Type.Object(
        {
          type: Type.Optional(
            Type.String({ description: "Requested response format type." }),
          ),
        },
        { description: "Response format overrides." },
      ),
    ),
    response_modalities: Type.Optional(
      Type.Array(Type.String(), {
        description: "Response modalities to request from Gemini.",
      }),
    ),
    system_instruction: Type.Optional(
      Type.String({
        description: "System instruction for the research agent.",
      }),
    ),
    tools: Type.Optional(
      Type.Array(
        Type.Object(
          {
            urlContext: Type.Optional(
              Type.Object({}, { description: "Enable URL context." }),
            ),
            googleSearch: Type.Optional(
              Type.Object({}, { description: "Enable Google Search." }),
            ),
          },
          { description: "Gemini tool configuration." },
        ),
        { description: "Tools available to the Gemini research run." },
      ),
    ),
  },
  { description: "Gemini research options." },
);

export const geminiAdapter: GeminiAdapter = {
  id: "gemini",
  label: "Gemini",
  docsUrl: "https://github.com/googleapis/js-genai",
  tools: ["search", "answer", "research"] as const,

  getToolOptionsSchema(capability: Tool): TObject | undefined {
    switch (capability) {
      case "search":
        return geminiSearchOptionsSchema;
      case "answer":
        return geminiAnswerOptionsSchema;
      case "research":
        return geminiResearchOptionsSchema;
      default:
        return undefined;
    }
  },

  createTemplate(): Gemini {
    return {
      apiKey: "GOOGLE_API_KEY",
      options: {
        searchModel: DEFAULT_SEARCH_MODEL,
        answerModel: DEFAULT_ANSWER_MODEL,
        researchAgent: DEFAULT_RESEARCH_AGENT,
      },
    };
  },

  getCapabilityStatus(config: Gemini | undefined): ProviderCapabilityStatus {
    return getApiKeyStatus(config?.apiKey);
  },

  buildPlan(request: ProviderRequest, config: Gemini) {
    return buildProviderPlan({
      request,
      config,
      providerId: this.id,
      providerLabel: this.label,
      resolvePlanConfig: (providerConfig) => ({
        settings: providerConfig.settings,
      }),
      handlers: {
        search: {
          execute: (
            searchRequest,
            providerConfig: Gemini,
            context: ProviderContext,
          ) =>
            this.search(
              searchRequest.query,
              searchRequest.maxResults,
              providerConfig,
              context,
              searchRequest.options,
            ),
        },
        answer: {
          execute: (
            answerRequest,
            providerConfig: Gemini,
            context: ProviderContext,
          ) =>
            this.answer(
              answerRequest.query,
              providerConfig,
              context,
              answerRequest.options,
            ),
        },
        research: {
          execute: (
            researchRequest,
            providerConfig: Gemini,
            context: ProviderContext,
          ) =>
            this.research(
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
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<SearchResponse> {
    const ai = this.createClient(config);
    const providerOptions = getGeminiOptions(config);
    const request = buildGeminiSearchRequest(
      query,
      providerOptions?.searchModel ?? DEFAULT_SEARCH_MODEL,
      options,
    );

    const interaction = await createSearchInteraction(
      ai,
      request,
      context.signal,
    );

    const results = await Promise.all(
      extractGoogleSearchResults(interaction.outputs)
        .slice(0, maxResults)
        .map(async (result) => {
          const resolvedUrl = await resolveGoogleSearchUrl(
            result.url,
            context.signal,
          );
          return {
            title: result.title ?? resolvedUrl ?? result.url ?? "Untitled",
            url: resolvedUrl ?? result.url ?? "",
            snippet: "",
          };
        }),
    );

    return {
      provider: this.id,
      results,
    };
  },

  async answer(
    query: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    const ai = this.createClient(config);
    const providerOptions = getGeminiOptions(config);
    const request = buildGeminiGenerateContentRequest({
      defaultModel: providerOptions?.answerModel ?? DEFAULT_ANSWER_MODEL,
      prompt: query,
      options,
      toolConfig: { googleSearch: {} },
    });

    const response = await ai.models.generateContent({
      model: request.model,
      contents: request.contents,
      config: addAbortSignalToGeminiConfig(request.config, context.signal),
    });

    const lines: string[] = [];
    lines.push(response.text?.trim() || "No answer returned.");

    const sources = extractGroundingSources(
      response.candidates?.[0]?.groundingMetadata?.groundingChunks,
    );
    if (sources.length > 0) {
      lines.push("");
      lines.push("Sources:");
      for (const [index, source] of sources.entries()) {
        lines.push(`${index + 1}. ${source.title}`);
        if (source.url) {
          lines.push(`   ${source.url}`);
        }
      }
    }

    return {
      provider: this.id,
      text: lines.join("\n").trimEnd(),
      itemCount: sources.length,
    };
  },

  async research(
    input: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ToolOutput> {
    return await executeAsyncResearch({
      providerLabel: this.label,
      providerId: this.id,
      context,
      maxConsecutivePollErrors:
        DEFAULT_GEMINI_RESEARCH_MAX_CONSECUTIVE_POLL_ERRORS,
      start: (researchContext) =>
        this.startResearch(input, config, researchContext, options),
      poll: (id, researchContext) =>
        this.pollResearch(id, config, researchContext, options),
    });
  },

  async startResearch(
    input: string,
    config: Gemini,
    context: ProviderContext,
    options?: Record<string, unknown>,
  ): Promise<ResearchJob> {
    const ai = this.createClient(config);
    const requestOptions = getGeminiResearchRequestOptions(options);
    const interaction = await ai.interactions.create(
      {
        ...requestOptions,
        input,
        agent:
          getGeminiOptions(config)?.researchAgent ?? DEFAULT_RESEARCH_AGENT,
        background: true,
      },
      buildGeminiRequestOptions(context.signal, context.idempotencyKey),
    );

    return { id: interaction.id };
  },

  async pollResearch(
    id: string,
    config: Gemini,
    context: ProviderContext,
    _options?: Record<string, unknown>,
  ): Promise<ResearchPollResult> {
    const ai = this.createClient(config);
    const interaction = await runWithoutGeminiInteractionsWarning(() =>
      ai.interactions.get(
        id,
        undefined,
        buildGeminiRequestOptions(context.signal),
      ),
    );

    const status = readNonEmptyString(interaction.status) ?? "unknown";

    if (status === "completed") {
      const text = formatInteractionOutputs(interaction.outputs);
      return {
        status: "completed",
        output: {
          provider: this.id,
          text: text || "Gemini research completed without textual output.",
        },
      };
    }

    if (status === "failed") {
      return {
        status: "failed",
        error: "research failed",
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
        error: "research ended incomplete",
      };
    }

    if (status === "requires_action") {
      return {
        status: "failed",
        error: describeGeminiRequiredAction(interaction.outputs),
      };
    }

    return status === "in_progress"
      ? { status: "in_progress" }
      : { status: "in_progress", statusText: status };
  },

  createClient(config: Gemini): GoogleGenAI {
    const apiKey = resolveConfigValue(config.apiKey);
    if (!apiKey) {
      throw new Error("is missing an API key");
    }

    return new GoogleGenAI({
      apiKey,
      apiVersion: getGeminiOptions(config)?.apiVersion,
    });
  },
};

function buildGeminiRequestOptions(
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

function addAbortSignalToGeminiConfig(
  config: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
): Record<string, unknown> | undefined {
  if (!signal) {
    return config;
  }

  return {
    ...(config ?? {}),
    abortSignal: signal,
  };
}

function extractGoogleSearchResults(
  outputs: unknown,
): Array<{ title?: string; url?: string; rendered_content?: string }> {
  const seen = new Set<string>();
  const results: Array<{
    title?: string;
    url?: string;
    rendered_content?: string;
  }> = [];

  if (!Array.isArray(outputs)) {
    return results;
  }

  for (const output of outputs) {
    if (typeof output !== "object" || output === null) {
      continue;
    }

    const content = output as { type?: unknown; result?: unknown };
    if (content.type !== "google_search_result") {
      continue;
    }

    const items = Array.isArray(content.result) ? content.result : [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const normalizedResults = normalizeGoogleSearchResult(
        item as Record<string, unknown>,
      );
      for (const normalized of normalizedResults) {
        if (!normalized.title && !normalized.url) {
          continue;
        }

        const key = [
          normalized.title?.trim().toLowerCase() ?? "",
          normalized.url?.trim().toLowerCase() ?? "",
        ].join("::");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push(normalized);
      }
    }
  }

  return results;
}

function normalizeGoogleSearchResult(record: Record<string, unknown>): Array<{
  title?: string;
  url?: string;
  rendered_content?: string;
}> {
  const renderedContent =
    readNonEmptyString(record.rendered_content) ??
    readNonEmptyString(record.renderedContent);
  const suggestionResults = extractSearchResultsFromSuggestions(record);
  const fallback = extractSearchResultsFromHtml(renderedContent)[0] ?? {};
  const primary = {
    title:
      readNonEmptyString(record.title) ??
      readNonEmptyString(record.name) ??
      readNonEmptyString(record.headline) ??
      fallback.title,
    url:
      readNonEmptyString(record.url) ??
      readNonEmptyString(record.uri) ??
      readNonEmptyString(record.link) ??
      readNonEmptyString(record.href) ??
      fallback.url,
    rendered_content: renderedContent,
  };

  if (primary.title || primary.url) {
    return [primary, ...suggestionResults];
  }

  return suggestionResults;
}

function extractSearchResultsFromSuggestions(
  record: Record<string, unknown>,
): Array<{ title?: string; url?: string; rendered_content?: string }> {
  const fragments = [
    readNonEmptyString(record.search_suggestions),
    readNonEmptyString(record.searchSuggestions),
  ].filter((value): value is string => value !== undefined);

  return fragments.flatMap((fragment) =>
    extractSearchResultsFromHtml(fragment).map((result) => ({
      ...result,
      rendered_content: fragment,
    })),
  );
}

function extractSearchResultsFromHtml(
  fragment: string | undefined,
): Array<{ title?: string; url?: string }> {
  if (!fragment) {
    return [];
  }

  const results: Array<{ title?: string; url?: string }> = [];

  for (const match of fragment.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseHtmlAttributes(match[1] ?? "");
    const result = {
      title:
        cleanExtractedHtmlText(match[2]) ??
        normalizeHtmlAttributeValue(attrs.title) ??
        normalizeHtmlAttributeValue(attrs["aria-label"]) ??
        normalizeHtmlAttributeValue(attrs["data-title"]),
      url:
        normalizeSearchUrl(attrs.href) ??
        normalizeSearchUrl(attrs["data-href"]) ??
        normalizeSearchUrl(attrs["data-url"]) ??
        normalizeSearchUrl(attrs.url),
    };

    if (result.title || result.url) {
      results.push(result);
    }
  }

  if (results.length > 0) {
    return results;
  }

  const attrs = parseHtmlAttributes(fragment);
  const fallback = {
    title:
      normalizeHtmlAttributeValue(attrs.title) ??
      normalizeHtmlAttributeValue(attrs["aria-label"]) ??
      normalizeHtmlAttributeValue(attrs["data-title"]),
    url:
      normalizeSearchUrl(attrs.href) ??
      normalizeSearchUrl(attrs["data-href"]) ??
      normalizeSearchUrl(attrs["data-url"]) ??
      normalizeSearchUrl(attrs.url),
  };

  if (fallback.title || fallback.url) {
    return [fallback];
  }

  return [];
}

function extractSearchResultFromRenderedContent(
  renderedContent: string | undefined,
): { title?: string; url?: string } {
  const [result] = extractSearchResultsFromHtml(renderedContent);
  if (!result) {
    return {};
  }
  return result;
}

function parseHtmlAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const match of fragment.matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(['"])([\s\S]*?)\2/g,
  )) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[3]);
  }

  return attributes;
}

function cleanExtractedHtmlText(html: string | undefined): string | undefined {
  if (!html) {
    return undefined;
  }

  const text = decodeHtmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

  return text || undefined;
}

function normalizeHtmlAttributeValue(
  value: string | undefined,
): string | undefined {
  return readNonEmptyString(value);
}

function normalizeSearchUrl(value: string | undefined): string | undefined {
  const url = normalizeHtmlAttributeValue(value);
  if (!url || url.startsWith("#") || /^javascript:/i.test(url)) {
    return undefined;
  }
  return url;
}

function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (_match, entity: string) => decodeHtmlEntity(entity),
  );
}

function decodeHtmlEntity(entity: string): string {
  const normalized = entity.toLowerCase();
  if (normalized === "amp") return "&";
  if (normalized === "lt") return "<";
  if (normalized === "gt") return ">";
  if (normalized === "quot") return '"';
  if (normalized === "apos" || normalized === "#39") return "'";
  if (normalized === "nbsp") return " ";

  const isHex = normalized.startsWith("#x");
  const isNumeric = normalized.startsWith("#");
  if (!isNumeric) {
    return `&${entity};`;
  }

  const value = Number.parseInt(
    normalized.slice(isHex ? 2 : 1),
    isHex ? 16 : 10,
  );
  return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
}

function extractGroundingSources(
  chunks: unknown,
): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url: string }> = [];
  const maxSources = 5;

  if (!Array.isArray(chunks)) {
    return sources;
  }

  for (const chunk of chunks) {
    const web =
      typeof chunk === "object" &&
      chunk !== null &&
      "web" in chunk &&
      typeof chunk.web === "object" &&
      chunk.web !== null
        ? (chunk.web as Record<string, unknown>)
        : undefined;
    if (!web) continue;

    const rawUrl = typeof web.uri === "string" ? web.uri : "";
    const title = formatGroundingSourceTitle(
      typeof web.title === "string" ? web.title : rawUrl,
      rawUrl,
    );
    const url = formatGroundingSourceUrl(rawUrl);
    const key = [title.toLowerCase(), url.toLowerCase()].join("::");
    if (seen.has(key)) continue;
    seen.add(key);

    sources.push({
      title,
      url,
    });

    if (sources.length >= maxSources) {
      break;
    }
  }

  return sources;
}

function formatInteractionOutputs(outputs: unknown): string {
  const lines: string[] = [];

  if (!Array.isArray(outputs)) {
    return "";
  }

  for (const output of outputs) {
    if (
      typeof output === "object" &&
      output !== null &&
      "type" in output &&
      output.type === "text" &&
      "text" in output &&
      typeof output.text === "string"
    ) {
      const text = output.text.trim();
      if (text) {
        lines.push(text);
      }
    }
  }

  return lines.join("\n\n").trim();
}

function formatGroundingSourceTitle(
  title: string | undefined,
  url: string,
): string {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  return "Untitled";
}

function formatGroundingSourceUrl(url: string): string {
  if (!url) {
    return "";
  }

  if (isGoogleGroundingRedirect(url)) {
    return "";
  }

  return url;
}

function isGoogleGroundingRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "vertexaisearch.cloud.google.com" &&
      parsed.pathname.startsWith("/grounding-api-redirect/")
    );
  } catch {
    return false;
  }
}

async function createSearchInteraction(
  ai: GoogleGenAI,
  request: {
    model: string;
    input: string;
    tools: Array<{ type: "google_search" }>;
    generation_config?: Record<string, unknown>;
  },
  signal: AbortSignal | undefined,
) {
  const forcedRequest = {
    ...request,
    ...(request.generation_config
      ? {
          generation_config: {
            ...request.generation_config,
            tool_choice: "any" as const,
          },
        }
      : {
          generation_config: {
            tool_choice: "any" as const,
          },
        }),
  };

  try {
    return await runWithoutGeminiInteractionsWarning(() =>
      ai.interactions.create(forcedRequest, buildGeminiRequestOptions(signal)),
    );
  } catch (error) {
    if (!isBuiltInToolChoiceError(error)) {
      throw error;
    }

    const fallbackGenerationConfig = stripToolChoice(request.generation_config);
    return runWithoutGeminiInteractionsWarning(() =>
      ai.interactions.create(
        {
          ...request,
          ...(fallbackGenerationConfig
            ? { generation_config: fallbackGenerationConfig }
            : {}),
        },
        buildGeminiRequestOptions(signal),
      ),
    );
  }
}

// TODO: Remove this suppression when @google/genai provides a way to silence
// the experimental-interactions warning natively.
const GEMINI_INTERACTIONS_WARNING =
  /GoogleGenAI\.interactions: Interactions usage is experimental and may change in future versions\.?/;
let geminiWarningSuppressionDepth = 0;
let originalGeminiConsoleWarn: typeof console.warn | undefined;
let originalGeminiStderrWrite: typeof process.stderr.write | undefined;

async function runWithoutGeminiInteractionsWarning<T>(
  operation: () => Promise<T>,
): Promise<T> {
  installGeminiWarningSuppression();
  try {
    return await operation();
  } finally {
    uninstallGeminiWarningSuppression();
  }
}

function installGeminiWarningSuppression(): void {
  geminiWarningSuppressionDepth += 1;
  if (geminiWarningSuppressionDepth !== 1) {
    return;
  }

  originalGeminiConsoleWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (matchesGeminiInteractionsWarning(args)) {
      return;
    }
    originalGeminiConsoleWarn?.(...args);
  };

  originalGeminiStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
    if (matchesGeminiInteractionsWarning([chunk])) {
      const callback = args.find(
        (arg): arg is (error?: Error | null) => void =>
          typeof arg === "function",
      );
      callback?.(null);
      return true;
    }
    return (
      originalGeminiStderrWrite?.(
        chunk as never,
        ...(args as Parameters<typeof process.stderr.write>[1][]),
      ) ?? true
    );
  }) as typeof process.stderr.write;
}

function uninstallGeminiWarningSuppression(): void {
  geminiWarningSuppressionDepth = Math.max(
    0,
    geminiWarningSuppressionDepth - 1,
  );
  if (geminiWarningSuppressionDepth !== 0) {
    return;
  }

  if (originalGeminiConsoleWarn) {
    console.warn = originalGeminiConsoleWarn;
    originalGeminiConsoleWarn = undefined;
  }
  if (originalGeminiStderrWrite) {
    process.stderr.write = originalGeminiStderrWrite;
    originalGeminiStderrWrite = undefined;
  }
}

function matchesGeminiInteractionsWarning(parts: unknown[]): boolean {
  const text = parts
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part instanceof Uint8Array) {
        return Buffer.from(part).toString("utf8");
      }
      return "";
    })
    .join(" ");

  return GEMINI_INTERACTIONS_WARNING.test(text);
}

function isBuiltInToolChoiceError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes(
      "Function calling config is set without function_declarations",
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message.includes(
      "Function calling config is set without function_declarations",
    );
  }

  return false;
}

async function resolveGoogleSearchUrl(
  url: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (!url) {
    return undefined;
  }

  if (!isGoogleGroundingRedirect(url)) {
    return url;
  }

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal,
    });
    return response.headers.get("location") || url;
  } catch {
    return url;
  }
}

function buildGeminiSearchRequest(
  query: string,
  defaultModel: string,
  options: Record<string, unknown> | undefined,
): {
  model: string;
  input: string;
  tools: Array<{ type: "google_search" }>;
  generation_config?: Record<string, unknown>;
} {
  return {
    model: readNonEmptyString(options?.model) ?? defaultModel,
    input: query,
    tools: [{ type: "google_search" }],
    ...(isPlainObject(options?.generation_config)
      ? { generation_config: options.generation_config }
      : {}),
  };
}

function buildGeminiGenerateContentRequest({
  defaultModel,
  prompt,
  options,
  toolConfig,
}: {
  defaultModel: string;
  prompt: string;
  options: Record<string, unknown> | undefined;
  toolConfig: { googleSearch: {} };
}): {
  model: string;
  contents: string;
  config: Record<string, unknown>;
} {
  const requestOptions = isPlainObject(options) ? options : {};
  const explicitConfig = isPlainObject(requestOptions.config)
    ? requestOptions.config
    : {};

  return {
    model: readNonEmptyString(requestOptions.model) ?? defaultModel,
    contents: prompt,
    config: {
      ...explicitConfig,
      tools: [toolConfig],
    },
  };
}

function describeGeminiRequiredAction(outputs: unknown): string {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return "research requires additional action";
  }

  const firstOutput = outputs.find(
    (value) => typeof value === "object" && value !== null,
  ) as Record<string, unknown> | undefined;
  const type = readNonEmptyString(firstOutput?.type);

  if (!type) {
    return "research requires additional action";
  }

  return `research requires additional action (${type})`;
}

function getGeminiResearchRequestOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!isPlainObject(options)) {
    return {};
  }

  return { ...options };
}

function stripToolChoice(
  generationConfig: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!generationConfig || !Object.hasOwn(generationConfig, "tool_choice")) {
    return generationConfig;
  }

  const { tool_choice: _ignored, ...rest } = generationConfig;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getGeminiOptions(config: Gemini) {
  return config.options;
}

function getGeminiExecutionPolicyDefaults(config: Gemini) {
  return config.settings;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}
